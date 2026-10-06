/**
 * A Mate's changes (SPEC §3.2a, `@t3tools/shared/hqChanges`): the repositories HQ keeps for an
 * application and the changes Mates deliver into them, the replacement of a pull request.
 *
 * A Mate works only in the application HQ holds it in: it names a repository by its name, and HQ
 * finds it there. Whether it may is `can` (`permissions.ts`), asked here and
 * nowhere else — a Mate's writes over the org as every write is decided (`mateApp`, `mateChange`:
 * `roles.ts` `confirmingRefusal`), its fetches
 * over the org's view as every read is decided (`roles.ts` `view`, `mateFetch`); a person's reads
 * and comments in `personApp`. Every
 * write is fenced by the leader.
 *
 * @module changes
 */
import { rasterContentType, type RasterContentType } from "@t3tools/shared/hqAttachments";
import type { GitError, HqGit, Repo } from "@t3tools/hq-git";
import {
  type AttachmentResponse,
  ATTACHMENT_MAX_BYTES,
  type ChangeDetailResponse,
  type ChangeDetailQuery,
  type ChangesSnapshot,
  COMPARE_COMMITS_MAX,
  type CompareQuery,
  type CompareResponse,
  type HqChange,
  type HqChangeComment,
  type HqRepo,
  CHANGE_LIST_SETTLED,
  MERGE_REFUSALS,
  MATE_CHANGES_PER_REPO,
  type MateChanges,
  type OpenChangeResponse,
  type RepoListEntry,
  Sha,
  attachmentPath,
  mergeSubject,
} from "@t3tools/shared/hqChanges";
import {
  RECIPE_REPO,
  RECIPE_TIER_PATHS,
  type RecipeTier,
  type RecipeTierResponse,
  hasServices,
} from "@t3tools/shared/hqRecipe";
import { type Decision, REASONS } from "@t3tools/shared/zeropsPermissions";
import { type Facts, can } from "./permissions.ts";
import {
  SOURCE_FILE_MAX_BYTES,
  type RepositoryQuery,
  type RepositorySource,
} from "@t3tools/shared/hqGit";
import { readReleaseVersion } from "./releaseVersion.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { firstCodeMergeOf } from "./firstCodeMerge.ts";
import { readChangeNavigationSource, type ChangeNavigationSource } from "./changeNavigation.ts";
import { appendEvent, releaseRevisions } from "./gitEvents.ts";
import { GitHost, type PushedChange, mainOf } from "./gitHost.ts";
import { heldOf } from "./held.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { madeRepo } from "./reconcile.ts";
import { appTarget } from "./offers.ts";
import { Roles, confirmingRefusal, decidedFresh } from "./roles.ts";
import { addRollout } from "./rollouts.ts";
import { squashesOnMain } from "./squashes.ts";
import type { ZeropsError } from "./zerops/api.ts";

export class ChangeRefused extends Schema.TaggedError<ChangeRefused>()("ChangeRefused", {
  code: Schema.Literals([
    "forbidden",
    "project_not_found",
    "app_not_found",
    "repo_not_found",
    "change_not_found",
    "attachment_not_found",
    "commit_not_found",
    "conflict",
    "invalid",
    "too_large",
  ]),
  /** Why: a permission's reason (`zeropsPermissions.ts`) or one of the changes' own. */
  reason: Schema.Literals([
    ...REASONS,
    ...MERGE_REFUSALS,
    "app_not_found",
    "repo_not_found",
    "change_not_found",
    "attachment_not_found",
    "commit_not_found",
    "not_raster",
    "recipe_too_large",
  ]),
}) {}

const isSha = Schema.is(Sha);
const isChangeRefused = Schema.is(ChangeRefused);

/** The verbs a Mate does in its application, beside editing its change and fetching. */
export type MateVerb = "ensure_repo" | "open_change";

type MateError = ChangeRefused | NotLeader | SqlError | ZeropsError;

type ReadError = ChangeRefused | SqlError | ZeropsError;

export class Changes extends Context.Service<
  Changes,
  {
    /**
     * The application the Mate of `projectId` does `verb` in: the one HQ holds it in, as `can`
     * decides it over the org as a write is decided (`roles.ts` `confirmingRefusal`).
     */
    readonly mateApp: (projectId: string, verb: MateVerb) => Effect.Effect<string, MateError>;
    /**
     * The application the Mate of `projectId` fetches a repository of `repoAppId` in, as `can`'s
     * `fetch_repo` decides it over the org's view (`roles.ts` `view`).
     */
    readonly mateFetch: (
      projectId: string,
      repoAppId: string,
    ) => Effect.Effect<string, ChangeRefused | SqlError | ZeropsError>;
    /**
     * The application's recipe repository (`hqRecipe.ts` `RECIPE_REPO`), made if new, as Core makes
     * it with the application, and on first need for one made before.
     */
    readonly ensureGroupRepo: (
      appId: string,
    ) => Effect.Effect<HqRepo, NotLeader | SqlError | GitError>;
    /**
     * A deleted application's repositories, gone from disk (`Structure.deleteApp` drops HQ's record
     * of them first): what `list` no longer names is neither reconciled nor bundled again.
     */
    readonly removeAppRepos: (appId: string) => Effect.Effect<void, NotLeader | GitError>;
    /**
     * A tier of the application's recipe as `main` holds it, bounded — what every reader of a tier
     * reads, a person's, a Mate's, a deploy's: `absent` without the repository, the file, or a
     * service in it.
     */
    readonly recipeTier: (
      appId: string,
      tier: RecipeTier,
    ) => Effect.Effect<RecipeTierResponse, ChangeRefused | NotLeader | SqlError | GitError>;
    /** A tier, read by whoever may read the application's changes (`read_change`). */
    readonly readRecipe: (
      userId: string,
      appId: string,
      tier: RecipeTier,
    ) => Effect.Effect<RecipeTierResponse, ReadError | NotLeader | GitError>;
    /** A tier of the Mate's own application's recipe, read as it fetches (`fetch_repo`). */
    readonly mateRecipe: (
      projectId: string,
      tier: RecipeTier,
    ) => Effect.Effect<RecipeTierResponse, ReadError | NotLeader | GitError>;
    /**
     * The repository `name` in the Mate's application, made if new: `main` begins with HQ's commit.
     * The recipe's (`RECIPE_REPO`) is Core's, whichever Mate asks for it first.
     */
    readonly ensureRepo: (
      projectId: string,
      name: string,
    ) => Effect.Effect<HqRepo, MateError | GitError>;
    /** The Mate's open change in `repo`, or the next number opened with `title`. */
    readonly openChange: (
      projectId: string,
      repo: string,
      title: string,
      tree?: string,
    ) => Effect.Effect<OpenChangeResponse, MateError | GitError>;
    /** The Mate's open change `number` in `repo`, retitled, described, or both. */
    readonly editChange: (
      projectId: string,
      repo: string,
      number: number,
      edit: { readonly title?: string; readonly body?: string },
    ) => Effect.Effect<HqChange, MateError>;
    /**
     * What the Mate's own state carries of its changes: the application HQ holds it in, by id and
     * name, and there its latest changes per repository, newest first.
     */
    readonly mateChanges: (projectId: string) => Effect.Effect<MateChanges, SqlError>;
    /** A picture for the Mate's open change: a raster, kept for its description to show. */
    readonly attach: (
      projectId: string,
      repo: string,
      number: number,
      content: Uint8Array,
    ) => Effect.Effect<AttachmentResponse, MateError>;
    /**
     * An application's changes as a person reads them: its open ones and its latest
     * {@link CHANGE_LIST_SETTLED} merged or closed ones, newest first.
     */
    readonly listChanges: (
      userId: string,
      appId: string,
    ) => Effect.Effect<ReadonlyArray<HqChange>, ReadError>;
    /** The application's repositories, its recipe's too, by name, as `RepoListEntry`. */
    readonly listRepos: (
      userId: string,
      appId: string,
    ) => Effect.Effect<ReadonlyArray<RepoListEntry>, ReadError>;
    /** Checks a person's source read or topic-branch push against the app's current projects. */
    readonly personGit: (
      userId: string,
      appId: string,
      write?: boolean,
    ) => Effect.Effect<void, ReadError>;
    /** A bounded source tree or file at one commit, after the person's source-read permission. */
    readonly repositorySource: (
      userId: string,
      appId: string,
      repo: string,
      query: RepositoryQuery,
    ) => Effect.Effect<RepositorySource, ReadError | NotLeader | GitError>;
    /**
     * What lies between two of a repository's commits, git's `base..head` (`CompareQuery`), each
     * commit with the change whose merge it is; `commit_not_found` for either end the repository
     * lacks.
     */
    readonly compare: (
      userId: string,
      appId: string,
      repo: string,
      query: CompareQuery,
    ) => Effect.Effect<CompareResponse, ReadError | NotLeader | GitError>;
    /** A change and what its review reads, from git. */
    readonly changeDetail: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      query?: ChangeDetailQuery,
    ) => Effect.Effect<ChangeDetailResponse, ReadError | NotLeader | GitError>;
    /** What people said about a change, oldest first. */
    readonly listComments: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
    ) => Effect.Effect<ReadonlyArray<HqChangeComment>, ReadError>;
    readonly postComment: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      body: string,
    ) => Effect.Effect<HqChangeComment, ReadError | NotLeader>;
    /**
     * The change squashed into `main` (`hqChanges.ts` `MergeChangeRequest`), if its head is still
     * `expectedHead`: one merge of a repository at a time, from `main` as the last one left it.
     */
    readonly mergeChange: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      expectedHead: string,
    ) => Effect.Effect<HqChange, ReadError | NotLeader | GitError>;
    /** The change closed without merging; its branch stays. */
    readonly closeChange: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
    ) => Effect.Effect<HqChange, ReadError | NotLeader>;
    /**
     * The changes of every application the person may read them of, by application id: what the
     * structure socket carries (`stream.ts`).
     */
    readonly readable: (userId: string) => Effect.Effect<ChangesSnapshot, SqlError | ZeropsError>;
    /** Compact open menu rows, shared across people; no git, descriptions or comment counts. */
    readonly navigation: Effect.Effect<ChangeNavigationSource, SqlError>;
    /** Ticks after any change's record moved, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
    /**
     * Where each application's releases and its repositories' `main` last moved, by id
     * (`releaseRevisions`): what the structure socket carries, beside each application's changes.
     */
    readonly releaseRevisions: Effect.Effect<ReadonlyMap<string, string>, SqlError>;
    /** A private picture's stored bytes and their detected raster type. */
    readonly attachment: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      id: string,
    ) => Effect.Effect<
      { readonly content: Uint8Array; readonly contentType: RasterContentType },
      ReadError
    >;
  }
>()("@t3tools/hq/changes") {}

/** The most of a tier's import file a read takes: the git layer's own ceiling. */
const RECIPE_READ_MAX = 1024 * 1024;

const refuse = (code: ChangeRefused["code"], reason: ChangeRefused["reason"]) =>
  Effect.fail(new ChangeRefused({ code, reason }));

/** The crew's trailers a squash carries over from the change's own commits (SPEC §9). */
const CREW_TRAILERS = ["Crew-Lane", "Crew-Assignment"] as const;

/** Trailers as a squash takes them: by key, each value once, in the order first written. */
const onceEach = (trailers: ReadonlyArray<{ readonly key: string; readonly value: string }>) => {
  const found: Record<string, Array<string>> = {};
  for (const { key, value } of trailers) {
    const values = (found[key] ??= []);
    if (value !== "" && !values.includes(value)) values.push(value);
  }
  return found;
};

/** The squash of a Mate's change among `main`'s latest commits (`squashes.ts`); none past them. */
const squashOnMain = (git: HqGit, repo: Repo, mateId: string, number: number) =>
  Effect.map(
    squashesOnMain(git, repo),
    (found) => found.get(`${mateId}/${String(number)}`) ?? null,
  );

/** What a try of a landing squashes onto — `main` as it read it — or why it stops short (`stop`). */
type Aim<A> = { readonly main: string } | { readonly stop: A };

const instant = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${column}`;

/** A change's columns as {@link ChangeRow} reads them. */
const CHANGE_COLUMNS = [
  "app_id::text AS app_id",
  "repo",
  "number",
  "mate_project_id",
  "title",
  "body",
  "state",
  "head",
  "merged_sha",
  "landed_head",
  instant("opened_at"),
  instant("merged_at"),
  instant("closed_at"),
  instant("updated_at"),
  "mergeability",
  "behind",
  "first_code_merge",
  // A recipe change is whole as proposed: it asks for review undescribed. A Mate's delivery
  // asks at the head it last described.
  `(repo = '${RECIPE_REPO}' OR COALESCE(ready_head = head, false)) AS ready`,
  // Every read of a change is of `hq_change` by that name, its writes' `RETURNING` included.
  `(SELECT count(*)::int FROM hq_change_comment c
    WHERE c.app_id = hq_change.app_id AND c.repo = hq_change.repo
      AND c.number = hq_change.number) AS comments`,
].join(", ");

interface ChangeRow {
  readonly app_id: string;
  readonly repo: string;
  readonly number: number;
  readonly mate_project_id: string;
  readonly title: string;
  readonly body: string;
  readonly state: HqChange["state"];
  readonly head: string | null;
  readonly merged_sha: string | null;
  readonly landed_head: string | null;
  readonly opened_at: string;
  readonly merged_at: string | null;
  readonly closed_at: string | null;
  readonly updated_at: string;
  readonly mergeability: HqChange["mergeability"];
  readonly behind: boolean;
  readonly first_code_merge: boolean | null;
  readonly ready: boolean;
  readonly comments: number;
}

const COMMENT_COLUMNS = [
  "id::text AS id",
  "author_user_id",
  "author_mate_project_id",
  "body",
  instant("created_at"),
].join(", ");

interface CommentRow {
  readonly id: string;
  readonly author_user_id: string | null;
  readonly author_mate_project_id: string | null;
  readonly body: string;
  readonly created_at: string;
}

const commentOf = (row: CommentRow): HqChangeComment => ({
  id: row.id,
  authorUserId: row.author_user_id,
  authorMateProjectId: row.author_mate_project_id,
  body: row.body,
  createdAt: row.created_at,
});

const changeOf = (row: ChangeRow): HqChange => ({
  appId: row.app_id,
  repo: row.repo,
  number: row.number,
  mateProjectId: row.mate_project_id,
  title: row.title,
  body: row.body,
  state: row.state,
  head: row.head,
  mergedSha: row.merged_sha,
  landedHead: row.landed_head,
  openedAt: row.opened_at,
  mergedAt: row.merged_at,
  closedAt: row.closed_at,
  updatedAt: row.updated_at,
  mergeability: row.mergeability,
  behind: row.behind,
  ...(row.first_code_merge === null ? {} : { firstCodeMerge: row.first_code_merge }),
  ready: row.ready,
  comments: row.comments,
});

export const changesLayer: Layer.Layer<
  Changes,
  never,
  GitHost | Leader | Roles | SqlClient.SqlClient
> = Layer.effect(
  Changes,
  Effect.gen(function* () {
    const gitHost = yield* GitHost;
    const leader = yield* Leader;
    const roles = yield* Roles;
    const sql = yield* SqlClient.SqlClient;
    // One repository is made at a time: two first deliveries of one name meet here, not in git.
    const making = yield* Semaphore.make(1);
    const ticks = yield* SubscriptionRef.make(0);
    /** After a write that changed a change's record has committed. */
    const touched = <A, E, R>(write: Effect.Effect<A, E, R>) =>
      Effect.tap(write, () => SubscriptionRef.update(ticks, (n) => n + 1));

    /** The Mate's project as HQ holds it: its kind, and its application if it is in one. */
    const mateHeld = (projectId: string) =>
      Effect.gen(function* () {
        const [placed] = yield* sql<{ readonly app_id: string }>`
          SELECT app_id::text AS app_id FROM hq_app_project WHERE project_id = ${projectId}`;
        return { projectId, appId: placed?.app_id ?? null, held: yield* heldOf(sql, projectId) };
      });

    /**
     * `can`'s answer to a Mate, enforced: a refusal is logged with what it asked, and answered by
     * its reason; an allowed verb answers the application, which `can` allows only when there is one.
     */
    const enforced = (
      verb: string,
      target: { readonly projectId: string; readonly appId: string | null },
      decision: Decision,
    ) =>
      Effect.gen(function* () {
        if (decision.allow) return target.appId!;
        const { reason } = decision;
        yield* Effect.logInfo("mate refused", { verb, target, reason });
        return yield* refuse(
          reason === "project_gone"
            ? "project_not_found"
            : reason === "unknown_change"
              ? "change_not_found"
              : "forbidden",
          reason,
        );
      });

    const mate = (projectId: string) => ({ kind: "mate", projectId }) as const;

    const mateApp = (projectId: string, verb: MateVerb) =>
      confirmingRefusal(
        Effect.gen(function* () {
          const target = yield* mateHeld(projectId);
          return yield* enforced(
            verb,
            target,
            can(mate(projectId), verb, target, yield* roles.forWrite),
          );
        }),
      );

    /** The application the Mate edits its change `number` of `repo` in: its own change only. */
    const mateChange = (projectId: string, repo: string, number: number) =>
      confirmingRefusal(
        Effect.gen(function* () {
          const held = yield* mateHeld(projectId);
          const [row] =
            held.appId === null
              ? []
              : yield* sql<{ readonly mate_project_id: string }>`
                SELECT mate_project_id FROM hq_change
                WHERE app_id = ${held.appId}::uuid AND repo = ${repo} AND number = ${number}`;
          const target = {
            ...held,
            change: row === undefined ? null : { mateProjectId: row.mate_project_id },
          };
          const facts = yield* roles.forWrite;
          return yield* enforced(
            "edit_change",
            target,
            can(mate(projectId), "edit_change", target, facts),
          );
        }),
      );

    const mateFetch = (projectId: string, repoAppId: string) =>
      Effect.gen(function* () {
        const target = { ...(yield* mateHeld(projectId)), repoAppId };
        const facts = yield* roles.view;
        return yield* enforced(
          "fetch_repo",
          target,
          can(mate(projectId), "fetch_repo", target, facts),
        );
      });

    /**
     * Whether the person `userId` may `verb` the changes of the application `appId`: `can` over
     * all of its projects — a read over the org's view, a comment as every write is decided.
     * Decided before the application's existence, so an id tells nobody without the right whether
     * it names an application. Applications are compared by their id's text, which a path may
     * spell any way.
     */
    /** Whether the person may read the changes of an application of these projects. */
    const readsChanges = (userId: string, projectIds: ReadonlyArray<string>, facts: Facts) =>
      can({ kind: "person", userId }, "read_change", { projectIds }, facts);

    const personApp = (
      userId: string,
      appId: string,
      verb: "read_change" | "comment_change" | "merge_change" | "close_change" | "push_repo",
    ) => {
      const check = Effect.gen(function* () {
        const projects = yield* sql<{ readonly project_id: string }>`
          SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
        const target = appTarget(projects);
        const decision =
          verb === "read_change"
            ? readsChanges(userId, target.projectIds, yield* roles.view)
            : can({ kind: "person", userId }, verb, target, yield* roles.forWrite);
        if (!decision.allow) {
          yield* Effect.logInfo("change refused", { userId, verb, appId, reason: decision.reason });
          return yield* refuse("forbidden", decision.reason);
        }
        const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
        if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
      });
      // A read is decided over the cached view; a write that can be undone as every such write is
      // (F22); a merge or a close, which cannot, over roles read for it alone.
      return verb === "read_change"
        ? check
        : verb === "merge_change" || verb === "close_change"
          ? decidedFresh(check)
          : confirmingRefusal(check);
    };

    /** A change of the application, or `change_not_found`. */
    const changeIn = (appId: string, repo: string, number: number) =>
      Effect.flatMap(
        sql<ChangeRow>`
          SELECT ${sql.literal(CHANGE_COLUMNS)} FROM hq_change
          WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`,
        (rows) =>
          rows[0] === undefined
            ? refuse("change_not_found", "change_not_found")
            : Effect.succeed(changeOf(rows[0])),
      );

    /**
     * The changes of the applications `appIds`: each one's open changes and its latest settled
     * ones, newest first.
     */
    const windowOf = (appIds: ReadonlyArray<string>) =>
      appIds.length === 0
        ? Effect.succeed([])
        : Effect.map(
            sql<ChangeRow>`
              SELECT ${sql.literal(CHANGE_COLUMNS)} FROM (
                SELECT hq_change.*, row_number() OVER (
                  PARTITION BY app_id, state = 'open'
                  ORDER BY COALESCE(merged_at, closed_at) DESC NULLS LAST, number DESC
                ) AS settled_rank
                FROM hq_change WHERE app_id::text IN ${sql.in(appIds)}
              ) hq_change
              WHERE state = 'open' OR settled_rank <= ${CHANGE_LIST_SETTLED}
              ORDER BY hq_change.opened_at DESC, repo, number DESC`,
            (rows) => rows.map(changeOf),
          );

    /** In a fenced write: the change, locked, while it is open. Whose it is, `can` has decided. */
    const openChangeLocked = (appId: string, repo: string, number: number) =>
      Effect.gen(function* () {
        const [change] = yield* sql<{ readonly state: string }>`
          SELECT state FROM hq_change
          WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}
          FOR UPDATE`;
        if (change === undefined) return yield* refuse("change_not_found", "change_not_found");
        if (change.state !== "open") return yield* refuse("conflict", "change_not_open");
      });

    /**
     * The change squashed into `main` by whoever `by` names — a person, or Core — with the head
     * that was judged: one merge of a repository at a time. Each try squashes onto the `main` its
     * `aim` reads under the repository's lock — a person's, `main` as it is now; Core's, the one it
     * judged the change against — or stops short where the aim says; should anything else move
     * `main` meanwhile, it is tried again from where it went.
     */
    const land = <A = never, E = never, R = never>(
      change: HqChange,
      expectedHead: string,
      by: object,
      aim: (git: HqGit, at: Repo) => Effect.Effect<Aim<A>, E, R>,
    ) =>
      Effect.gen(function* () {
        const git = yield* gitHost.git;
        const number = change.number;
        // As the change's record names it, never as a path spelled it.
        const at = { appId: change.appId, id: change.repo };
        const mate = change.mateProjectId;
        // Read before the squash, from every commit of the change; a push since moves the head
        // the squash checks.
        const crew = onceEach(yield* git.changeTrailers(at, mate, number, CREW_TRAILERS));
        // The Mate by its project's name in Zerops (D3), as the org's view has it; unnamed while
        // that view cannot be read.
        const name = yield* Effect.orElseSucceed(
          Effect.map(
            roles.view,
            (view) => view.projects.find((project) => project.id === mate)?.name,
          ),
          () => undefined,
        );
        const message =
          change.body.trim() === ""
            ? mergeSubject(change.title, number)
            : `${mergeSubject(change.title, number)}\n\n${change.body}`;
        const attempt = Effect.gen(function* () {
          const aimed = yield* aim(git, at);
          if ("stop" in aimed) return aimed;
          return yield* git.squashMerge(at, {
            mateId: mate,
            number,
            expectedMain: aimed.main,
            expectedHead,
            message,
            trailers: crew,
            author: { name: name ?? "Mate", email: `${mate}@mate.hq.invalid` },
          });
        });
        return yield* touched(
          leader.write(
            Effect.gen(function* () {
              // The repository's row, locked: its merges go one at a time.
              yield* sql`
                SELECT 1 FROM hq_repo WHERE app_id = ${at.appId}::uuid AND name = ${at.id}
                FOR UPDATE`;
              yield* openChangeLocked(at.appId, at.id, number);
              let landed = yield* attempt;
              for (
                let tries = 1;
                "kind" in landed && landed.kind === "main_moved" && tries < 3;
                tries++
              ) {
                landed = yield* attempt;
              }
              if ("stop" in landed) return landed.stop;
              // On main already, yet open here: this change's squash whose record never landed
              // (its write failed after git moved main) is recorded now.
              const found =
                "kind" in landed && landed.kind === "already_merged"
                  ? yield* squashOnMain(git, at, mate, number)
                  : null;
              if ("kind" in landed && found === null) {
                return yield* refuse("conflict", landed.kind);
              }
              const mergedSha = "merged" in landed ? landed.merged : found!;
              const first = yield* firstCodeMergeOf(sql, { appId: at.appId, repo: at.id, number });
              const [row] = yield* sql<ChangeRow>`
                UPDATE hq_change
                SET state = 'merged', merged_sha = ${mergedSha}, landed_head = ${expectedHead},
                    head = ${expectedHead}, merged_at = now(), updated_at = now(),
                    mergeability = 'already_merged', behind = false,
                    first_code_merge = ${first}::boolean
                WHERE app_id = ${at.appId}::uuid AND repo = ${at.id} AND number = ${number}
                RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
              // The merge asks for its deploys in its own write (`rollouts.ts`): the request that
              // merged runs them; the main move git reports names the same rollout.
              yield* addRollout(sql, {
                cause: "merge",
                appId: at.appId,
                repo: at.id,
                sha: mergedSha,
              });
              yield* appendEvent(sql, {
                kind: "merged",
                appId: at.appId,
                repo: at.id,
                number,
                data: {
                  mergedSha,
                  landedHead: expectedHead,
                  ...by,
                  ...(found === null ? {} : { recovered: true }),
                },
              });
              return changeOf(row!);
            }),
          ),
        );
      });

    /** A person's try: the head they saw, onto `main` as it is now. */
    const asItIs = (git: HqGit, at: Repo) =>
      Effect.map(mainOf(git, at), (main) => ({ main: main ?? "" }));

    /** In a fenced write, the change locked open: closed without merging, as `by` says. */
    const closeLocked = (change: HqChange, by: object) =>
      Effect.gen(function* () {
        const [row] = yield* sql<ChangeRow>`
          UPDATE hq_change
          SET state = 'closed', closed_at = now(), updated_at = now()
          WHERE app_id = ${change.appId}::uuid AND repo = ${change.repo}
            AND number = ${change.number}
          RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
        yield* appendEvent(sql, {
          kind: "closed",
          appId: change.appId,
          repo: change.repo,
          number: change.number,
          data: by,
        });
        return changeOf(row!);
      });

    /** The change closed without merging, as `by` says; its branch stays. */
    const close = (appId: string, repo: string, number: number, by: object) =>
      touched(
        leader.write(
          Effect.gen(function* () {
            const change = yield* changeIn(appId, repo, number);
            yield* openChangeLocked(change.appId, change.repo, number);
            return yield* closeLocked(change, by);
          }),
        ),
      );

    /**
     * Core's try at a recipe change of `head`, under its repository's lock: judged (`can`'s
     * `land_recipe`) by what its squash does to `main` now — the `main` it then squashes onto —
     * never by a guess: names cut short, or a change that does not merge, stop it there. An empty
     * one is closed here; one `main` has the squash of already is recorded by the squash's own way.
     */
    const recipeAim = (change: HqChange, head: string, facts: Facts) => (git: HqGit, at: Repo) =>
      Effect.gen(function* () {
        const mate = change.mateProjectId;
        const named = yield* git.squashNames(at, mate, change.number);
        if (!("files" in named)) {
          return named.kind === "already_merged"
            ? { main: (yield* mainOf(git, at)) ?? "" }
            : { stop: named.kind };
        }
        // A push since is judged as its own, as it comes.
        if (named.head !== head) return { stop: "head_moved" };
        if (named.files.truncated) return { stop: "files_past_bound" };
        const held = yield* mateHeld(mate);
        const decision = can(
          { kind: "core" },
          "land_recipe",
          {
            repo: at.id,
            author: { projectId: mate, held: held.held, appId: held.appId },
            appId: at.appId,
            onlyAdded: named.files.items.every((file) => file.status === "A"),
            empty: named.files.items.length === 0,
          },
          facts,
        );
        if (decision.allow) return { main: named.main };
        if (decision.reason === "recipe_empty") {
          yield* closeLocked(change, { by: "core", reason: "empty" });
        }
        return { stop: decision.reason };
      });

    /**
     * A pushed change of an application's recipe repository, landed by Core when `can` says so
     * (`recipeAim`); any other waits for a person. A change no longer open, or with nothing pushed,
     * is let be — so judging it again, at a takeover, is judging it once.
     */
    const judgeRecipe = ({ repo, mateId, number }: PushedChange) =>
      Effect.gen(function* () {
        if (repo.id !== RECIPE_REPO) return;
        const git = yield* gitHost.git;
        const [row] = yield* sql<{ readonly state: string }>`
          SELECT state FROM hq_change
          WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND number = ${number}
            AND mate_project_id = ${mateId}`;
        if (row?.state !== "open") return;
        const head = yield* git.changeHead(repo, mateId, number);
        if (head === null) return;
        // Read before the lock, never held across Zerops: the landing reads none of the org.
        const facts = yield* roles.view;
        const change = yield* changeIn(repo.appId, repo.id, number);
        // Refused as git sees it — a conflict with main, a head moved since — it stays open, as
        // main's broker left it: its record says how it merges, and its Mate proposes again.
        const landed = yield* land(
          change,
          head,
          { by: "core" },
          recipeAim(change, head, facts),
        ).pipe(
          Effect.catchIf(isChangeRefused, (refused) =>
            Effect.as(
              Effect.logWarning("recipe change not landed", {
                repo,
                number,
                reason: refused.reason,
              }),
              null,
            ),
          ),
        );
        if (typeof landed === "string" && landed !== "recipe_empty") {
          yield* Effect.logInfo("recipe change waits", { repo, number, reason: landed });
        }
      });

    /**
     * A repository of the application, made if new: one at a time, so two first deliveries of one
     * name meet here, not in git. Git first, then its record: one cut short leaves git ahead of
     * the records, which a takeover records (`reconcile.ts`), never a record naming what git lacks,
     * which would hold all of HQ (H1). Each step holds when it is done already, so a call cut short
     * is finished by the next.
     */
    const makeRepo = (appId: string, name: string, createdBy: string) =>
      Semaphore.withPermits(
        making,
        1,
      )(
        Effect.gen(function* () {
          const git = yield* gitHost.git;
          const repo = { appId, id: name };
          yield* madeRepo(git, repo);
          // Recorded with its main: its first commit's move came before there was a record to move.
          const main = yield* mainOf(git, repo);
          yield* leader.write(sql`
            INSERT INTO hq_repo (app_id, name, created_by, main_head)
            VALUES (${appId}::uuid, ${name}, ${createdBy}, ${main})
            ON CONFLICT DO NOTHING`);
          return { appId, name };
        }),
      );

    const recipeTier = (appId: string, tier: RecipeTier) =>
      Effect.gen(function* () {
        const absent: RecipeTierResponse = { state: "absent" };
        const known = yield* sql`
          SELECT 1 FROM hq_repo WHERE app_id::text = ${appId} AND name = ${RECIPE_REPO}`;
        if (known.length === 0) return absent;
        const git = yield* gitHost.git;
        const at = { appId, id: RECIPE_REPO };
        const main = yield* mainOf(git, at);
        if (main === null) return absent;
        const path = RECIPE_TIER_PATHS[tier];
        const [dir = "", file = ""] = path.split("/");
        const listed = (tree: string, name: string, type: string) =>
          Effect.map(git.tree(at, main, tree), (entries) =>
            entries.items.some((entry) => entry.path === name && entry.type === type),
          );
        if (!(yield* listed("", dir, "tree")) || !(yield* listed(dir, file, "blob"))) {
          return absent;
        }
        const read = yield* git.file(at, main, path, RECIPE_READ_MAX);
        if (read.truncated) return yield* refuse("too_large", "recipe_too_large");
        const importYaml = read.content.toString("utf8");
        return hasServices(importYaml)
          ? { state: "present" as const, importYaml, mainHead: main }
          : absent;
      });

    // Every pushed change is judged as it comes, by the Core that leads (only it records pushes).
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Queue.take(gitHost.pushes), (pushed) =>
          judgeRecipe(pushed).pipe(
            Effect.catch((error) => Effect.logWarning("recipe change not judged", error)),
          ),
        ),
      ),
    );

    return Changes.of({
      mateApp,
      mateFetch,
      ensureRepo: (projectId, name) =>
        Effect.flatMap(mateApp(projectId, "ensure_repo"), (appId) =>
          // The recipe's is Core's, whoever asks for it first: a Mate joins it.
          makeRepo(appId, name, name === RECIPE_REPO ? "core" : projectId),
        ),
      ensureGroupRepo: (appId) => makeRepo(appId, RECIPE_REPO, "core"),
      removeAppRepos: (appId) =>
        gitHost.holdingRepos(
          Effect.gen(function* () {
            const git = yield* gitHost.git;
            for (const repo of yield* git.list(appId)) yield* git.remove(repo);
          }),
        ),
      recipeTier,
      readRecipe: (userId, appId, tier) =>
        Effect.andThen(personApp(userId, appId, "read_change"), recipeTier(appId, tier)),
      mateRecipe: (projectId, tier) =>
        Effect.gen(function* () {
          const { appId } = yield* mateHeld(projectId);
          return yield* recipeTier(yield* mateFetch(projectId, appId ?? ""), tier);
        }),
      openChange: (projectId, repo, title, tree) =>
        Effect.gen(function* () {
          const appId = yield* mateApp(projectId, "open_change");
          const columns = sql.literal(CHANGE_COLUMNS);
          const git = yield* gitHost.git;
          return yield* touched(
            leader.write(
              Effect.gen(function* () {
                // The repository's row, locked: its next number is taken by one opening at a time.
                const repos = yield* sql`
                SELECT 1 FROM hq_repo WHERE app_id = ${appId}::uuid AND name = ${repo} FOR UPDATE`;
                if (repos.length === 0) return yield* refuse("repo_not_found", "repo_not_found");
                // The tree hash identifies content, irrespective of squash ancestry. This verdict
                // precedes both opening a number and returning an existing open change.
                const at = { appId, id: repo };
                const main = yield* mainOf(git, at);
                if (tree !== undefined && main !== null && tree === (yield* git.treeId(at, main))) {
                  yield* appendEvent(sql, {
                    kind: "delivery_empty",
                    appId,
                    repo,
                    number: null,
                    data: { mateProjectId: projectId, main, tree },
                  });
                  return { change: null, created: false, reason: "nothing_to_deliver" } as const;
                }
                const [open] = yield* sql<ChangeRow>`
                SELECT ${columns} FROM hq_change
                WHERE app_id = ${appId}::uuid AND repo = ${repo}
                  AND mate_project_id = ${projectId} AND state = 'open'`;
                if (open !== undefined) return { change: changeOf(open), created: false };
                // Past every change branch too, recorded or not: a branch a restore's records
                // lack is never a new change's.
                const branched = (yield* git.changeRefs({ appId, id: repo })).reduce(
                  (highest, ref) => Math.max(highest, ref.number),
                  0,
                );
                const [made] = yield* sql<ChangeRow>`
                INSERT INTO hq_change (app_id, repo, number, mate_project_id, title)
                SELECT ${appId}::uuid, ${repo}, GREATEST(COALESCE(MAX(number), 0), ${branched}) + 1,
                  ${projectId}, ${title}
                FROM hq_change WHERE app_id = ${appId}::uuid AND repo = ${repo}
                RETURNING ${columns}`;
                // `INSERT … RETURNING` answers the row it inserted, or fails.
                const change = changeOf(made!);
                yield* appendEvent(sql, {
                  kind: "opened",
                  appId,
                  repo,
                  number: change.number,
                  data: { mateProjectId: projectId },
                });
                return { change, created: true };
              }),
            ),
          );
        }),
      mateChanges: (projectId) =>
        Effect.gen(function* () {
          const [placed] = yield* sql<{ readonly app_id: string; readonly name: string }>`
            SELECT placed.app_id::text AS app_id, app.name FROM hq_app_project placed
            JOIN hq_app app ON app.id = placed.app_id
            WHERE placed.project_id = ${projectId} AND placed.kind IN ('mate', 'devstage')`;
          if (placed === undefined) return { appId: null, appName: null, changes: [] };
          const rows = yield* sql<
            Pick<
              ChangeRow,
              "repo" | "number" | "title" | "state" | "head" | "merged_sha" | "landed_head"
            >
          >`
            SELECT repo, number, title, state, head, merged_sha, landed_head FROM (
              SELECT *, row_number() OVER (PARTITION BY repo ORDER BY number DESC) AS rank
              FROM hq_change
              WHERE app_id = ${placed.app_id}::uuid AND mate_project_id = ${projectId}
            ) latest
            WHERE rank <= ${MATE_CHANGES_PER_REPO}
            ORDER BY repo, number DESC`;
          return {
            appId: placed.app_id,
            appName: placed.name,
            changes: rows.map((row) => ({
              repo: row.repo,
              number: row.number,
              title: row.title,
              state: row.state,
              head: row.head,
              mergedSha: row.merged_sha,
              landedHead: row.landed_head,
            })),
          };
        }),
      editChange: (projectId, repo, number, edit) =>
        Effect.gen(function* () {
          const appId = yield* mateChange(projectId, repo, number);
          return yield* touched(
            leader.write(
              Effect.gen(function* () {
                yield* openChangeLocked(appId, repo, number);
                const [row] = yield* sql<ChangeRow>`
                UPDATE hq_change
                SET title = COALESCE(${edit.title ?? null}, title),
                    body = COALESCE(${edit.body ?? null}, body),
                    -- Words describe the head they were written at; a title describes nothing.
                    ready_head = CASE
                      WHEN ${edit.body === undefined} THEN ready_head
                      WHEN ${(edit.body ?? "").trim() === ""} THEN NULL
                      ELSE head
                    END,
                    updated_at = now()
                WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}
                RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
                return changeOf(row!);
              }),
            ),
          );
        }),
      attach: (projectId, repo, number, content) =>
        Effect.gen(function* () {
          if (content.byteLength > ATTACHMENT_MAX_BYTES)
            return yield* refuse("too_large", "not_raster");
          if (rasterContentType(content) === undefined)
            return yield* refuse("invalid", "not_raster");
          const appId = yield* mateChange(projectId, repo, number);
          const id = yield* leader.write(
            Effect.gen(function* () {
              yield* openChangeLocked(appId, repo, number);
              const [row] = yield* sql<{ readonly id: string }>`
                INSERT INTO hq_change_attachment (app_id, repo, number, content)
                VALUES (${appId}::uuid, ${repo}, ${number}, ${content})
                RETURNING id::text AS id`;
              return row!.id;
            }),
          );
          return { id, path: attachmentPath(appId, repo, number, id) };
        }),
      changes: Stream.merge(SubscriptionRef.changes(ticks), gitHost.recorded),
      navigation: readChangeNavigationSource(sql),
      releaseRevisions: Effect.provideService(releaseRevisions, SqlClient.SqlClient, sql),
      readable: (userId) =>
        Effect.gen(function* () {
          const view = yield* roles.view;
          const rows = yield* sql<{ readonly app_id: string; readonly project_id: string | null }>`
            SELECT a.id::text AS app_id, p.project_id
            FROM hq_app a LEFT JOIN hq_app_project p ON p.app_id = a.id`;
          const projects = new Map<string, Array<string>>();
          for (const row of rows) {
            const list = projects.get(row.app_id) ?? [];
            if (row.project_id !== null) list.push(row.project_id);
            projects.set(row.app_id, list);
          }
          const apps = [...projects]
            .filter(([, projectIds]) => readsChanges(userId, projectIds, view).allow)
            .map(([appId]) => appId);
          const changes = yield* windowOf(apps);
          return Object.fromEntries(
            apps.map((appId) => [appId, changes.filter((change) => change.appId === appId)]),
          );
        }),
      listChanges: (userId, appId) =>
        Effect.andThen(personApp(userId, appId, "read_change"), windowOf([appId])),
      listRepos: (userId, appId) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          const rows = yield* sql<{
            readonly name: string;
            readonly main_head: string | null;
            readonly updated_at: string;
          }>`
              SELECT name, main_head, ${sql.literal(instant("updated_at"))}
              FROM hq_repo WHERE app_id::text = ${appId} ORDER BY name`;
          if (rows.length === 0) return [];
          // Listing remains a database read while git opens or this Core is a standby.
          const git = yield* gitHost.git.pipe(
            Effect.catchTag("NotLeader", () => Effect.succeed(undefined)),
          );
          return yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const releaseVersion =
                git === undefined
                  ? undefined
                  : yield* readReleaseVersion(git, { appId, id: row.name }, row.main_head);
              return {
                name: row.name,
                mainHead: row.main_head,
                updatedAt: row.updated_at,
                ...(releaseVersion === undefined ? {} : { releaseVersion }),
              };
            }),
          );
        }),
      personGit: (userId, appId, write = false) =>
        personApp(userId, appId, write ? "push_repo" : "read_change"),
      repositorySource: (userId, appId, repo, query) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          const known =
            yield* sql`SELECT 1 FROM hq_repo WHERE app_id::text = ${appId} AND name = ${repo}`;
          if (known.length === 0) return yield* refuse("repo_not_found", "repo_not_found");
          const git = yield* gitHost.git;
          const target = { appId, id: repo };
          const branches = yield* git.branches(target);
          // Resolve a moving branch once; every following read in this response uses its commit.
          const selected = query.rev ?? "refs/heads/main";
          const branch = branches.items.find(
            (branch) => branch.ref === selected || branch.ref === `refs/heads/${selected}`,
          );
          const revision =
            branch?.sha ??
            (query.rev === undefined && branches.items.length === 0 ? null : selected);
          const common = {
            branches: branches.items,
            branchesTruncated: branches.truncated,
            path: query.path,
          };
          if (revision === null)
            return {
              ...common,
              kind: "tree" as const,
              revision: null,
              entries: [],
              truncated: false,
            };
          // A missing commit is an earned negative; a git process failure stays unavailable.
          if (!isSha(revision)) return yield* refuse("commit_not_found", "commit_not_found");
          if (branch === undefined && (yield* git.missingCommits(target, [revision])).length > 0) {
            return yield* refuse("commit_not_found", "commit_not_found");
          }
          const commit = { sha: revision };
          if (query.kind === "file") {
            const file = yield* git.file(target, commit.sha, query.path, SOURCE_FILE_MAX_BYTES);
            return {
              ...common,
              kind: "file" as const,
              revision: commit.sha,
              content: file.binary ? null : file.content.toString("utf8"),
              binary: file.binary,
              truncated: file.truncated,
            };
          }
          const tree = yield* git.tree(target, commit.sha, query.path);
          return {
            ...common,
            kind: "tree" as const,
            revision: commit.sha,
            entries: tree.items,
            truncated: tree.truncated,
          };
        }),
      compare: (userId, appId, repo, query) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          const known = yield* sql`
            SELECT 1 FROM hq_repo WHERE app_id::text = ${appId} AND name = ${repo}`;
          if (known.length === 0) return yield* refuse("repo_not_found", "repo_not_found");
          const git = yield* gitHost.git;
          const base = query.base ?? null;
          const between = yield* git
            .range({ appId, id: repo }, base, query.head, { limit: COMPARE_COMMITS_MAX })
            .pipe(
              Effect.catchIf(
                (error) => error.reason === "not_found",
                () => refuse("commit_not_found", "commit_not_found"),
              ),
            );
          const shas = between.items.map((commit) => commit.sha);
          const landed = new Map(
            (shas.length === 0
              ? []
              : yield* sql<{
                  readonly merged_sha: string;
                  readonly number: number;
                  readonly title: string;
                  readonly mate_project_id: string;
                }>`
                  SELECT merged_sha, number, title, mate_project_id FROM hq_change
                  WHERE app_id::text = ${appId} AND repo = ${repo}
                    AND ${sql.in("merged_sha", shas)}`
            ).map((row) => [
              row.merged_sha,
              { number: row.number, title: row.title, mateProjectId: row.mate_project_id },
            ]),
          );
          return {
            base,
            head: query.head,
            commits: between.items.map((commit) => ({
              sha: commit.sha,
              subject: commit.message.split("\n")[0] ?? "",
              authorName: commit.author.name,
              at: commit.committedAt,
              change: landed.get(commit.sha) ?? null,
            })),
            truncated: between.truncated,
            total: between.total,
          };
        }),
      changeDetail: (userId, appId, repo, number, query = {}) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          const change = yield* changeIn(appId, repo, number);
          const git = yield* gitHost.git;
          // As the change's record names it, never as the path spelled it.
          const at = { appId: change.appId, id: change.repo };
          const mate = change.mateProjectId;
          const mainHead = yield* mainOf(git, at);
          if (query.expectedHead !== undefined && query.expectedHead !== change.head) {
            return yield* refuse("conflict", "head_moved");
          }
          if (query.expectedMain !== undefined && query.expectedMain !== mainHead) {
            return yield* refuse("conflict", "main_moved");
          }
          const snapshot = { head: change.head, main: mainHead };
          const diff = yield* git.changeDiff(at, mate, number, {
            maxFiles: 300,
            maxBytesPerFile: 256 * 1024,
            snapshot,
          });
          // A squash lands content without its original commits. The preceding landing of this
          // Mate is the change's own base, independent of a later merge-base with main.
          const [previous] = yield* sql<{ readonly landed_head: string | null }>`
            SELECT landed_head FROM hq_change
            WHERE app_id = ${change.appId}::uuid AND repo = ${change.repo}
              AND mate_project_id = ${mate} AND number < ${number} AND state = 'merged'
              AND landed_head IS NOT NULL
            ORDER BY number DESC LIMIT 1`;
          const log = yield* git.changeLog(at, mate, number, {
            limit: 100,
            snapshot,
            ...(previous?.landed_head == null ? {} : { base: previous.landed_head }),
          });
          const mergeBase = yield* git.mergeBase(at, mate, number, snapshot);
          const mergeability = yield* git.mergeability(at, mate, number, snapshot);
          // Read in full, the change is judged: its record keeps what was just read.
          const judged = {
            mergeability: mergeability.kind === "no_change" ? "unknown" : mergeability.kind,
            behind:
              mergeability.kind !== "no_change" && mergeBase !== null && mergeBase !== mainHead,
          } as const;
          if (judged.mergeability !== change.mergeability || judged.behind !== change.behind) {
            yield* touched(
              leader.write(sql`
                UPDATE hq_change
                SET mergeability = ${judged.mergeability}, behind = ${judged.behind}
                WHERE app_id = ${change.appId}::uuid AND repo = ${change.repo}
                  AND number = ${number} AND head IS NOT DISTINCT FROM ${change.head}
                  AND EXISTS (SELECT 1 FROM hq_repo WHERE app_id = ${change.appId}::uuid
                    AND name = ${change.repo} AND main_head IS NOT DISTINCT FROM ${mainHead})`),
            );
          }
          return {
            change: { ...change, ...judged },
            mainHead,
            mergeBase,
            mergeability,
            files: diff.items.map((file) => ({
              path: file.path,
              added: file.added,
              deleted: file.deleted,
              hunks: file.hunks,
              binary: file.binary,
              truncated: file.truncated,
            })),
            filesTruncated: diff.truncated,
            commits: log.items.map((commit) => ({
              sha: commit.sha,
              subject: commit.message.split("\n")[0] ?? "",
              authorName: commit.author.name,
              at: commit.committedAt,
            })),
            commitsTruncated: log.truncated,
          };
        }),
      listComments: (userId, appId, repo, number) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          yield* changeIn(appId, repo, number);
          const rows = yield* sql<CommentRow>`
            SELECT ${sql.literal(COMMENT_COLUMNS)} FROM hq_change_comment
            WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}
            ORDER BY created_at, id`;
          return rows.map(commentOf);
        }),
      postComment: (userId, appId, repo, number, body) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "comment_change");
          return yield* touched(
            leader.write(
              Effect.gen(function* () {
                const change = yield* changeIn(appId, repo, number);
                const [row] = yield* sql<CommentRow>`
                INSERT INTO hq_change_comment (app_id, repo, number, author_user_id, body)
                VALUES (${change.appId}::uuid, ${change.repo}, ${number}, ${userId}, ${body})
                RETURNING ${sql.literal(COMMENT_COLUMNS)}`;
                // A comment moves the change.
                yield* sql`
                UPDATE hq_change SET updated_at = now()
                WHERE app_id = ${change.appId}::uuid AND repo = ${change.repo}
                  AND number = ${number}`;
                const comment = commentOf(row!);
                yield* appendEvent(sql, {
                  kind: "commented",
                  appId: change.appId,
                  repo: change.repo,
                  number,
                  data: { commentId: comment.id, userId },
                });
                return comment;
              }),
            ),
          );
        }),
      mergeChange: (userId, appId, repo, number, expectedHead) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "merge_change");
          const change = yield* changeIn(appId, repo, number);
          return yield* land(change, expectedHead, { userId }, asItIs);
        }),
      closeChange: (userId, appId, repo, number) =>
        Effect.andThen(
          personApp(userId, appId, "close_change"),
          close(appId, repo, number, { userId }),
        ),
      attachment: (userId, appId, repo, number, id) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          const [row] = yield* sql<{ readonly content: Uint8Array }>`
            SELECT content FROM hq_change_attachment
            WHERE id::text = ${id} AND app_id::text = ${appId} AND repo = ${repo}
              AND number = ${number}`;
          if (row === undefined)
            return yield* refuse("attachment_not_found", "attachment_not_found");
          const contentType = rasterContentType(row.content);
          if (contentType === undefined)
            return yield* refuse("attachment_not_found", "attachment_not_found");
          return { content: row.content, contentType };
        }),
    });
  }),
);
