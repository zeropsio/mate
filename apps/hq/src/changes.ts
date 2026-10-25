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
import type { HqPullRequest } from "@t3tools/shared/hqGithub";
import { type ChangeBranch, type GitError, type HqGit, type Repo, validRef } from "@t3tools/hq-git";
import {
  type AttachmentResponse,
  ATTACHMENT_MAX_BYTES,
  ChangeReceipt,
  type ChangeDetailResponse,
  type ChangeDetailQuery,
  type ChangesSnapshot,
  COMPARE_COMMITS_MAX,
  type CompareQuery,
  type CompareResponse,
  type EditChangeRequest,
  type HqChange,
  type HqChangeComment,
  type HqRepo,
  CHANGE_LIST_SETTLED,
  HAND_REFUSALS,
  MERGE_REFUSALS,
  MATE_CHANGES_PER_REPO,
  MATE_OPEN_CHANGES_MAX,
  type MateChanges,
  type OpenChangeResponse,
  type RepoListEntry,
  attachmentPath,
  mergeSubject,
} from "@t3tools/shared/hqChanges";
import type { HqPushCi, MateGitPush } from "@t3tools/shared/hqDeploys";
import {
  RECIPE_REPO,
  RECIPE_TIER_PATHS,
  type RecipeTier,
  type RecipeTierResponse,
  hasServices,
} from "@t3tools/shared/hqRecipe";
import { type Decision, REASONS } from "@t3tools/shared/zeropsPermissions";
import { type Facts, can } from "./permissions.ts";
import { readReleaseVersion } from "./releaseVersion.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

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
    ...HAND_REFUSALS,
    "app_not_found",
    "repo_not_found",
    "change_not_found",
    "attachment_not_found",
    "commit_not_found",
    "not_raster",
    "recipe_too_large",
    "branch_taken",
    "change_on_branch",
    "protected_ref",
    "invalid_ref",
    "too_many_open",
    "change_on_task",
  ]),
}) {}

const isChangeRefused = Schema.is(ChangeRefused);

/** The verbs a Mate does in its application, beside editing its change and fetching. */
export type MateVerb = "ensure_repo" | "open_change";

type MateError = ChangeRefused | NotLeader | SqlError | ZeropsError;

type ReadError = ChangeRefused | SqlError | ZeropsError;

/** A comment said on a change's pull request on GitHub, as `githubComment` keeps it. */
export interface GithubComment {
  /** Where GitHub keeps it (`review:<id>`, `review_comment:<id>`, `issue_comment:<id>`). */
  readonly key: string;
  readonly login: string;
  readonly body: string;
}

/** A person's comment on a change, as it was kept. */
export interface ChangeCommented {
  readonly appId: string;
  readonly repo: string;
  readonly number: number;
  readonly commentId: string;
  readonly userId: string;
  readonly body: string;
}

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
     * service in it. A release's deploy reads it `at` the commit its tag names instead.
     */
    readonly recipeTier: (
      appId: string,
      tier: RecipeTier,
      at?: string,
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
    /** A person's first code repository, using the same storage and authority as a source push. */
    readonly ensurePersonRepo: (
      userId: string,
      appId: string,
      name: string,
    ) => Effect.Effect<HqRepo, ReadError | NotLeader | GitError>;
    /**
     * The repository `name` in the Mate's application, made if new: `main` begins with HQ's commit.
     * The recipe's (`RECIPE_REPO`) is Core's, whichever Mate asks for it first.
     */
    readonly ensureRepo: (
      projectId: string,
      name: string,
    ) => Effect.Effect<HqRepo, MateError | GitError>;
    /**
     * The open change in `repo` a delivery goes to — its live task's own; off any task, the Mate's
     * own on `branch`, or its default change where none is named — or the next number opened with
     * `title`, the task's, on `branch` (its default where none is named).
     */
    readonly openChange: (
      projectId: string,
      repo: string,
      title: string,
      tree?: string,
      branch?: string,
    ) => Effect.Effect<OpenChangeResponse, MateError | GitError>;
    /**
     * The Mate's open change `number` in `repo`, retitled, described, its receipt replaced whole,
     * or any of them.
     */
    readonly editChange: (
      projectId: string,
      repo: string,
      number: number,
      edit: EditChangeRequest,
    ) => Effect.Effect<HqChange, MateError>;
    /**
     * What the Mate's own state carries of its changes: the application HQ holds it in, by id and
     * name, and there every open change of its and its latest settled ones per repository, newest
     * first.
     */
    readonly mateChanges: (projectId: string) => Effect.Effect<MateChanges, SqlError>;
    /**
     * In the application HQ holds the Mate in, each Git environment's latest confirmed push per
     * repository with the CI record on its evidence (`gitCi.ts`); none for a Mate in no application.
     */
    readonly mateGitPushes: (
      projectId: string,
    ) => Effect.Effect<ReadonlyArray<MateGitPush>, SqlError>;
    /** Whether the Mate's application has a production, of any target; none out of one. */
    readonly mateProduction: (projectId: string) => Effect.Effect<boolean, SqlError>;
    /**
     * The Mate's own open change `number` in `repo` closed without merging — work it gave up — its
     * branch kept; said in the change's conversation in the Mate's own name. A task's change is
     * refused `change_on_task`: it is decided with its task.
     */
    readonly mateCloseChange: (
      projectId: string,
      repo: string,
      number: number,
    ) => Effect.Effect<HqChange, MateError>;
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
     * `expectedHead`: one merge of a repository at a time, from `main` as the last one left it. The
     * first change into a repository whose `main` holds nothing, carrying another repository's
     * history, lands it under one merge commit instead (`@t3tools/hq-git` `keepsHistory`).
     */
    readonly mergeChange: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      expectedHead: string,
    ) => Effect.Effect<HqChange, ReadError | NotLeader | GitError>;
    /**
     * The change merged by a merge made elsewhere — on the GitHub its repository mirrors to — whose
     * commit `mergedSha` HQ's `main` already holds (`githubMirror.ts` imported it): what a squash
     * here records, with `main` left as the import moved it. One merged already stays as it is.
     * `mergedHead` is the head GitHub merged, landed as it — a push since is not merged; the
     * change's head now where none is known. A head no person merged in Mate (`hq_gate`) landed
     * outside Mate (`landed_outside`).
     */
    readonly landImported: (
      appId: string,
      repo: string,
      number: number,
      mergedSha: string,
      mergedHead?: string,
    ) => Effect.Effect<HqChange, ReadError | NotLeader | GitError>;
    /**
     * Whether the person may merge or close the application's changes, as `mergeChange` and
     * `closeChange` decide it: for a change that merges elsewhere (its pull request on GitHub).
     */
    readonly personMay: (
      userId: string,
      appId: string,
      verb: "merge_change" | "close_change",
    ) => Effect.Effect<void, ReadError>;
    /** The change as its record is, whoever asks: for a service that decided who may already. */
    readonly change: (
      appId: string,
      repo: string,
      number: number,
    ) => Effect.Effect<HqChange, ChangeRefused | SqlError>;
    /**
     * The change closed without merging because its pull request was closed on GitHub, whatever
     * its head; `undefined` where it is not open.
     */
    readonly closeOnGithub: (
      appId: string,
      repo: string,
      number: number,
      by: object,
    ) => Effect.Effect<HqChange | undefined, SqlError | NotLeader>;
    /**
     * A comment said on the change's pull request on GitHub, kept in its conversation as its
     * author's; `false` where GitHub's comment was kept already (a delivery repeated).
     */
    readonly githubComment: (
      appId: string,
      repo: string,
      number: number,
      comment: GithubComment,
    ) => Effect.Effect<boolean, SqlError | NotLeader>;
    /** A change's record moved outside this service (its pull request): its readers read again. */
    readonly touch: Effect.Effect<void>;
    /** The change closed without merging; its branch stays. */
    readonly closeChange: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      expectedHead: string | null,
    ) => Effect.Effect<HqChange, ReadError | NotLeader | GitError>;
    /**
     * An open change whose Mate is gone, handed by a person who may close it to `mateProjectId`, a
     * Mate of its application, however many open changes of its own it holds: its branch stays, and
     * that Mate's from then on (`@t3tools/hq-git` `allowRefUpdate` reads its record).
     */
    readonly handChange: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      mateProjectId: string,
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
     * The tasks a change was recorded on as their Mate opened it (`openChange`, `mateTasks.ts`),
     * by id, as they are.
     */
    readonly taskChanges: Stream.Stream<string>;
    /**
     * Each repository a Mate just opened a change in on a branch it named, with none of the branch
     * recorded yet: where the branch is kept elsewhere (GitHub, `githubMirror.ts`), it is looked
     * for at once.
     */
    readonly openedOnBranch: Stream.Stream<Repo>;
    /** Each comment a person posted on a change (`postComment`), once it is kept (`mateTasks.ts`). */
    readonly comments: Stream.Stream<ChangeCommented>;
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

/** How many of a repository's latest landings a change's commit list leaves out as landed. */
const LANDED_BASES = 20;

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

/** A change a comparison names a commit by. */
interface LandedChange {
  readonly number: number;
  readonly title: string;
  readonly mateProjectId: string;
}

/**
 * Which change each of `commits` (git's `base..head`, children first) is: the change merged as it —
 * HQ's own squash, or GitHub's merge or squash commit as its pull request recorded it — and, for a
 * merge commit, every commit it brought in beside `main`'s line, which are that change's own.
 */
const changesOfCommits = (
  commits: ReadonlyArray<{ readonly sha: string; readonly parents: ReadonlyArray<string> }>,
  merges: ReadonlyArray<{
    readonly merged_sha: string | null;
    readonly pr_merged_sha: string | null;
    readonly number: number;
    readonly title: string;
    readonly mate_project_id: string;
  }>,
): ReadonlyMap<string, LandedChange> => {
  const landed = new Map<string, LandedChange>();
  const byChange = (row: (typeof merges)[number]) => ({
    number: row.number,
    title: row.title,
    mateProjectId: row.mate_project_id,
  });
  // GitHub's word for its own merge first: a change HQ recorded merged by a later import's tip
  // shares that tip with the change merged as it.
  for (const row of merges)
    if (row.pr_merged_sha !== null) landed.set(row.pr_merged_sha, byChange(row));
  for (const row of merges) {
    if (row.merged_sha !== null && !landed.has(row.merged_sha))
      landed.set(row.merged_sha, byChange(row));
  }
  const between = new Map(commits.map((commit) => [commit.sha, commit]));
  const reach = (from: ReadonlyArray<string>) => {
    const seen = new Set<string>();
    const next = [...from];
    for (let sha = next.pop(); sha !== undefined; sha = next.pop()) {
      const commit = between.get(sha);
      if (commit === undefined || seen.has(sha)) continue;
      seen.add(sha);
      next.push(...commit.parents);
    }
    return seen;
  };
  for (const commit of commits) {
    const change = landed.get(commit.sha);
    const [line, ...side] = commit.parents;
    if (change === undefined || line === undefined || side.length === 0) continue;
    const onLine = reach([line]);
    for (const sha of reach(side))
      if (!onLine.has(sha) && !landed.has(sha)) landed.set(sha, change);
  }
  return landed;
};

const instant = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${column}`;

const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(ChangeReceipt));

/** A change's columns as {@link ChangeRow} reads them. */
export const CHANGE_COLUMNS = [
  "app_id::text AS app_id",
  "repo",
  "number",
  "mate_project_id",
  "branch",
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
  "landed_outside",
  "receipt",
  // Open, and its Mate no longer the application's: its project deleted, or taken out of it.
  `(state = 'open' AND NOT EXISTS (SELECT 1 FROM hq_app_project p
    WHERE p.project_id = hq_change.mate_project_id AND p.app_id = hq_change.app_id
      AND p.kind = 'mate')) AS mate_gone`,
  // A recipe change is whole as proposed: it asks for review undescribed. A Mate's delivery
  // asks at the head it last described.
  `(repo = '${RECIPE_REPO}' OR COALESCE(ready_head = head, false)) AS ready`,
  // Every read of a change is of `hq_change` by that name, its writes' `RETURNING` included.
  `(SELECT count(*)::int FROM hq_change_comment c
    WHERE c.app_id = hq_change.app_id AND c.repo = hq_change.repo
      AND c.number = hq_change.number) AS comments`,
  // Its pull request on GitHub (`pullRequests.ts`), one row by its key.
  `(SELECT jsonb_build_object('number', pr.pr_number, 'url', pr.url, 'state', pr.state,
      'checks', pr.checks) FROM hq_pull_request pr
    WHERE pr.app_id = hq_change.app_id AND pr.repo = hq_change.repo
      AND pr.number = hq_change.number) AS pull_request`,
  // Closed by its own Mate (`mateCloseChange`), as the log's close of it says.
  `(CASE WHEN state = 'closed' THEN EXISTS (SELECT 1 FROM hq_git_event e
    WHERE e.kind = 'closed' AND e.app_id = hq_change.app_id AND e.repo = hq_change.repo
      AND e.number = hq_change.number AND e.data->>'by' = 'mate') ELSE false END)
    AS closed_by_mate`,
  // Its branch on GitHub diverged (`githubMirror.ts`): since when.
  `(SELECT to_char(m.diverged_since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    FROM hq_change_mirror m WHERE m.app_id = hq_change.app_id AND m.repo = hq_change.repo
      AND m.number = hq_change.number) AS mirror_diverged_since`,
].join(", ");

/** A change's pull request as `CHANGE_COLUMNS` reads it. */
interface PullRequestRow {
  readonly number: number;
  readonly url: string;
  readonly state: HqPullRequest["state"];
  readonly checks: HqPullRequest["checks"] | null;
}

/** The pull request the wire carries: its checks only once GitHub reported some. */
export const pullRequestOf = (row: PullRequestRow): HqPullRequest => ({
  number: row.number,
  url: row.url,
  state: row.state,
  ...(row.checks === null || row.checks === undefined ? {} : { checks: row.checks }),
});

interface ChangeRow {
  readonly app_id: string;
  readonly repo: string;
  readonly number: number;
  readonly mate_project_id: string;
  readonly branch: string;
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
  readonly landed_outside: boolean;
  readonly receipt: ChangeReceipt | null;
  readonly mate_gone: boolean;
  readonly ready: boolean;
  readonly comments: number;
  readonly pull_request: PullRequestRow | null;
  readonly mirror_diverged_since: string | null;
  readonly closed_by_mate: boolean;
}

const COMMENT_COLUMNS = [
  "id::text AS id",
  "author_user_id",
  "author_mate_project_id",
  "author_github_login",
  "body",
  instant("created_at"),
].join(", ");

interface CommentRow {
  readonly id: string;
  readonly author_user_id: string | null;
  readonly author_mate_project_id: string | null;
  readonly author_github_login: string | null;
  readonly body: string;
  readonly created_at: string;
}

const commentOf = (row: CommentRow): HqChangeComment => ({
  id: row.id,
  authorUserId: row.author_user_id,
  authorMateProjectId: row.author_mate_project_id,
  ...(row.author_github_login === null ? {} : { authorGithubLogin: row.author_github_login }),
  body: row.body,
  createdAt: row.created_at,
});

/**
 * A Mate's description without a leading heading "What it does" — at any level, in any case, a
 * colon after it: HQ heads the description with it wherever it shows it (the change's review, its
 * pull request), so the words say it once. A heading further down is the Mate's own.
 */
const describedOnce = (body: string) => {
  const lines = body.split(/\r?\n/u);
  const first = lines.findIndex((line) => line.trim() !== "");
  const heading = first === -1 ? undefined : /^#{1,6}\s+(.*?)\s*#*\s*$/u.exec(lines[first]!.trim());
  if (heading?.[1]?.replace(/:$/u, "").trim().toLowerCase() !== "what it does") return body;
  return lines
    .slice(first + 1)
    .join("\n")
    .replace(/^\s*\n/u, "")
    .trimEnd();
};

/** A change as this HQ records it: always on a branch it names. */
type RecordedChange = HqChange & { readonly branch: string };

/** The change as git reads it. */
const branchOf = (change: RecordedChange): ChangeBranch => ({
  mateId: change.mateProjectId,
  number: change.number,
  branch: change.branch,
});

const changeOf = (row: ChangeRow): RecordedChange => ({
  appId: row.app_id,
  repo: row.repo,
  number: row.number,
  mateProjectId: row.mate_project_id,
  ...(row.mate_gone ? { mateGone: true } : {}),
  branch: row.branch,
  title: row.title,
  body: row.body,
  state: row.state,
  head: row.head,
  mergedSha: row.merged_sha,
  landedHead: row.landed_head,
  openedAt: row.opened_at,
  mergedAt: row.merged_at,
  closedAt: row.closed_at,
  ...(row.closed_by_mate ? { closedByMate: true } : {}),
  updatedAt: row.updated_at,
  mergeability: row.mergeability,
  behind: row.behind,
  ...(row.first_code_merge === null ? {} : { firstCodeMerge: row.first_code_merge }),
  ...(row.state === "merged" ? { landedOutside: row.landed_outside } : {}),
  ready: row.ready,
  comments: row.comments,
  ...(row.pull_request === null ? {} : { pullRequest: pullRequestOf(row.pull_request) }),
  ...(row.mirror_diverged_since === null ? {} : { mirrorDivergedSince: row.mirror_diverged_since }),
  receipt: row.receipt,
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
    const taskChanged = yield* PubSub.unbounded<string>();
    const openedUnrecorded = yield* PubSub.unbounded<Repo>();
    /** The tasks a change was opened for hear that it moved (`taskChanges`). */
    const tellTasksOf = (appId: string, repo: string, number: number) =>
      Effect.gen(function* () {
        const tasks = yield* sql<{ readonly id: string }>`
          SELECT id::text AS id FROM hq_task
          WHERE app_id = ${appId}::uuid AND change_repo = ${repo} AND change_number = ${number}`;
        for (const task of tasks) yield* PubSub.publish(taskChanged, task.id);
      });
    const commented = yield* PubSub.unbounded<ChangeCommented>();
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

    /** The application HQ holds the Mate in, by id and name: none for a Mate in no application. */
    const matePlaced = (projectId: string) =>
      sql<{ readonly app_id: string; readonly name: string }>`
        SELECT placed.app_id::text AS app_id, app.name FROM hq_app_project placed
        JOIN hq_app app ON app.id = placed.app_id
        WHERE placed.project_id = ${projectId} AND placed.kind IN ('mate', 'devstage')`;
    /**
     * The application the Mate edits or closes its change `number` of `repo` in: its own change
     * only. An edit is decided as every write that can be undone is; a close, which cannot, over
     * roles read for it alone.
     */
    const mateChange = (
      projectId: string,
      repo: string,
      number: number,
      verb: "edit_change" | "close_own_change" = "edit_change",
    ) =>
      (verb === "edit_change" ? confirmingRefusal : decidedFresh)(
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
          return yield* enforced(verb, target, can(mate(projectId), verb, target, facts));
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
        const [change] = yield* sql<{ readonly state: string; readonly head: string | null }>`
          SELECT state, head FROM hq_change
          WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}
          FOR UPDATE`;
        if (change === undefined) return yield* refuse("change_not_found", "change_not_found");
        if (change.state !== "open") return yield* refuse("conflict", "change_not_open");
        return change;
      });

    /**
     * The change squashed into `main` by whoever `by` names — a person, or Core — with the head
     * that was judged (or, keeping its history into a `main` that holds nothing, landed with it
     * under one merge commit): one merge of a repository at a time. Each try
     * squashes onto the `main` its `aim` reads under the repository's lock — a person's, `main` as
     * it is now; Core's, the one it judged the change against — or stops short where the aim says;
     * should anything else move `main` meanwhile, it is tried again from where it went.
     */
    const land = <A = never, E = never, R = never>(
      change: RecordedChange,
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
        const crew = onceEach(yield* git.changeTrailers(at, branchOf(change), CREW_TRAILERS));
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
            ...branchOf(change),
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

    /**
     * In a fenced write, the change locked open: closed without merging, as `by` says — logged
     * first, so the change it returns says who closed it (`closed_by_mate`).
     */
    const closeLocked = (change: RecordedChange, by: object) =>
      Effect.gen(function* () {
        yield* appendEvent(sql, {
          kind: "closed",
          appId: change.appId,
          repo: change.repo,
          number: change.number,
          data: by,
        });
        const [row] = yield* sql<ChangeRow>`
          UPDATE hq_change
          SET state = 'closed', closed_at = now(), updated_at = now()
          WHERE app_id = ${change.appId}::uuid AND repo = ${change.repo}
            AND number = ${change.number}
          RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
        return changeOf(row!);
      });

    /** The change closed without merging, as `by` says; its branch stays. */
    const close = (
      appId: string,
      repo: string,
      number: number,
      by: object,
      expectedHead: string | null,
    ) =>
      touched(
        leader.write(
          Effect.gen(function* () {
            const change = yield* changeIn(appId, repo, number);
            const current = yield* openChangeLocked(change.appId, change.repo, number);
            if (current.head !== expectedHead) return yield* refuse("conflict", "head_moved");
            const git = yield* gitHost.git;
            const head = yield* git.changeHead({ appId, id: repo }, branchOf(change));
            if (head !== expectedHead) return yield* refuse("conflict", "head_moved");
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
    const recipeAim =
      (change: RecordedChange, head: string, facts: Facts) => (git: HqGit, at: Repo) =>
        Effect.gen(function* () {
          const mate = change.mateProjectId;
          const named = yield* git.squashNames(at, branchOf(change));
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
    const judgeRecipe = ({ repo, ...pushed }: PushedChange) =>
      Effect.gen(function* () {
        if (repo.id !== RECIPE_REPO) return;
        const git = yield* gitHost.git;
        const [row] = yield* sql<{ readonly state: string }>`
          SELECT state FROM hq_change
          WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND number = ${pushed.number}
            AND mate_project_id = ${pushed.mateId}`;
        if (row?.state !== "open") return;
        const number = pushed.number;
        const head = yield* git.changeHead(repo, pushed);
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

    const recipeTier = (appId: string, tier: RecipeTier, commit?: string) =>
      Effect.gen(function* () {
        const absent: RecipeTierResponse = { state: "absent" };
        const known = yield* sql`
          SELECT 1 FROM hq_repo WHERE app_id::text = ${appId} AND name = ${RECIPE_REPO}`;
        if (known.length === 0) return absent;
        const git = yield* gitHost.git;
        const at = { appId, id: RECIPE_REPO };
        const main = commit ?? (yield* mainOf(git, at));
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
      ensurePersonRepo: (userId, appId, name) =>
        decidedFresh(
          Effect.andThen(personApp(userId, appId, "push_repo"), makeRepo(appId, name, userId)),
        ),
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
      openChange: (projectId, repo, title, tree, branch) =>
        Effect.gen(function* () {
          const appId = yield* mateApp(projectId, "open_change");
          // A branch as git names it under `refs/heads/`: never `main`, never a full ref, never in
          // the namespace of changes opened without one (`mate/`).
          if (branch !== undefined && /^(?:main$|mate(?:$|\/)|refs\/)/u.test(branch))
            return yield* refuse("conflict", "protected_ref");
          if (branch !== undefined && !validRef(`refs/heads/${branch}`))
            return yield* refuse("invalid", "invalid_ref");
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
                /**
                 * The Mate's live task (one at a time — on it, or back on it for a follow-up): what
                 * it delivers is that task's own change, whatever else of its waits for review.
                 * None on no task: a person's own Mate keeps an open change per branch it names,
                 * and one default change for openings that name none.
                 */
                const [live] = yield* sql<{
                  readonly id: string;
                  readonly linked: boolean;
                }>`
                SELECT t.id::text AS id, (t.change_number IS NOT NULL AND EXISTS (
                  SELECT 1 FROM hq_change c WHERE c.app_id = t.app_id AND c.repo = t.change_repo
                    AND c.number = t.change_number AND c.state = 'open')) AS linked
                FROM hq_task t
                WHERE t.mate_project_id = ${projectId} AND t.app_id = ${appId}::uuid
                  AND t.state IN ('assigned', 'working', 'waiting')`;
                const taskId = live?.id ?? null;
                /**
                 * The task's change, in the write that answers it: the first it opens on it, or the
                 * next once the one it had is no longer open.
                 */
                const onTask = (change: { readonly number: number }) =>
                  live === undefined || live.linked
                    ? Effect.succeed(undefined)
                    : Effect.map(
                        sql<{ readonly id: string }>`
                        UPDATE hq_task SET change_repo = ${repo}, change_number = ${change.number},
                          updated_at = now()
                        WHERE id::text = ${live.id}
                        RETURNING id::text AS id`,
                        (rows) => rows[0]?.id,
                      );
                if (taskId !== null) {
                  const [open] = yield* sql<ChangeRow>`
                  SELECT ${columns} FROM hq_change
                  WHERE app_id = ${appId}::uuid AND repo = ${repo}
                    AND mate_project_id = ${projectId} AND state = 'open'
                    AND task_id::text = ${taskId}`;
                  if (open !== undefined) {
                    const change = changeOf(open);
                    // An opener naming no branch (released zcp) pushes `mate/<Mate>/<number>`,
                    // which a change on a branch its Mate named, or one handed over from another
                    // Mate's default, never takes: answered, it would push there and open again for
                    // good.
                    if (
                      branch === undefined &&
                      change.branch !== `mate/${projectId}/${change.number}`
                    )
                      return yield* refuse("conflict", "change_on_branch");
                    return { change, created: false, task: yield* onTask(change) };
                  }
                } else {
                  // Off any task: the open change on the branch named — this Mate's own (one handed
                  // to it is), never another's — or, naming none, the Mate's default change.
                  const [open] = yield* sql<ChangeRow & { readonly task_id: string | null }>`
                  SELECT ${columns}, task_id::text AS task_id FROM hq_change
                  WHERE app_id = ${appId}::uuid AND repo = ${repo} AND state = 'open' AND ${
                    branch === undefined
                      ? sql`mate_project_id = ${projectId} AND task_id IS NULL
                          AND branch = 'mate/' || mate_project_id || '/' || number::text`
                      : sql`branch = ${branch}`
                  }`;
                  if (open !== undefined) {
                    if (open.mate_project_id !== projectId || open.task_id !== null)
                      return yield* refuse("conflict", "branch_taken");
                    const change = changeOf(open);
                    return { change, created: false, task: yield* onTask(change) };
                  }
                  // A Mate fills its person's review queue only so far: anything new waits for one
                  // of its open changes to be merged or closed.
                  const [held] = yield* sql<{ readonly open: number }>`
                  SELECT count(*)::int AS open FROM hq_change
                  WHERE app_id = ${appId}::uuid AND repo = ${repo}
                    AND mate_project_id = ${projectId} AND state = 'open' AND task_id IS NULL`;
                  if ((held?.open ?? 0) >= MATE_OPEN_CHANGES_MAX)
                    return yield* refuse("conflict", "too_many_open");
                }
                // A branch is one open change's at a time.
                const taken =
                  branch === undefined
                    ? []
                    : yield* sql`
                      SELECT 1 FROM hq_change
                      WHERE app_id = ${appId}::uuid AND repo = ${repo} AND branch = ${branch}
                        AND state = 'open'`;
                if (taken.length > 0) return yield* refuse("conflict", "branch_taken");
                // The repository's next number; a change named no branch is on its default.
                const [made] = yield* sql<ChangeRow>`
                WITH next AS (
                  SELECT COALESCE(MAX(number), 0) + 1 AS number FROM hq_change
                  WHERE app_id = ${appId}::uuid AND repo = ${repo})
                INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, task_id, branch)
                SELECT ${appId}::uuid, ${repo}, number, ${projectId}, ${title}, ${taskId}::uuid,
                  COALESCE(${branch ?? null}::text, 'mate/' || ${projectId} || '/' || number)
                FROM next
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
                return { change, created: true, task: yield* onTask(change) };
              }),
            ),
          ).pipe(
            Effect.tap((opened) =>
              "task" in opened && opened.task !== undefined
                ? PubSub.publish(taskChanged, opened.task)
                : Effect.void,
            ),
            // Opened on a branch pushed before it: the change is at its head from the start. Its
            // head read again while none is recorded, as an opening whose read failed is retried.
            // A named branch still unrecorded may be kept elsewhere, and is looked for there.
            Effect.flatMap((opened) =>
              opened.change === null || opened.change.head !== null
                ? Effect.succeed(opened)
                : Effect.gen(function* () {
                    const change = opened.change;
                    yield* gitHost.follow({ repo: { appId, id: repo }, ...branchOf(change) });
                    const now = yield* changeIn(appId, repo, change.number);
                    if (branch !== undefined && now.head === null)
                      yield* PubSub.publish(openedUnrecorded, { appId, id: repo });
                    return { ...opened, change: now };
                  }),
            ),
            // The task is HQ's to know; the Mate's answer stays the wire's.
            Effect.map((opened): OpenChangeResponse => {
              if (!("task" in opened)) return opened;
              const { task: _task, ...answer } = opened;
              return answer;
            }),
          );
        }),
      mateChanges: (projectId) =>
        Effect.gen(function* () {
          const [placed] = yield* matePlaced(projectId);
          if (placed === undefined) return { appId: null, appName: null, changes: [] };
          // Every open change, and the newest settled ones per repository: a change missing from
          // the Mate's state reads to zcp as merged or closed.
          const rows = yield* sql<
            Pick<
              ChangeRow,
              | "repo"
              | "number"
              | "title"
              | "state"
              | "head"
              | "merged_sha"
              | "landed_head"
              | "branch"
              | "ready"
              | "mergeability"
              | "behind"
              | "updated_at"
            > & { readonly handed: boolean }
          >`
            SELECT repo, number, title, state, head, merged_sha, landed_head, branch,
              handed_from IS NOT NULL AS handed,
              (repo = ${RECIPE_REPO} OR COALESCE(ready_head = head, false)) AS ready,
              mergeability, behind, ${sql.literal(instant("updated_at"))} FROM (
              SELECT *, row_number() OVER (
                PARTITION BY repo, state = 'open' ORDER BY number DESC
              ) AS rank
              FROM hq_change
              WHERE app_id = ${placed.app_id}::uuid AND mate_project_id = ${projectId}
            ) latest
            WHERE state = 'open' OR rank <= ${MATE_CHANGES_PER_REPO}
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
              branch: row.branch,
              ...(row.handed ? { handed: true } : {}),
              ...(row.state === "open"
                ? {
                    ready: row.ready,
                    mergeability: row.mergeability,
                    behind: row.behind,
                    updatedAt: row.updated_at,
                  }
                : {}),
            })),
            openPerBranch: true as const,
          };
        }),
      // The newest pushed job per environment and repository, as `gitCi.ts` resumes it.
      mateGitPushes: (projectId) =>
        Effect.gen(function* () {
          const [placed] = yield* matePlaced(projectId);
          if (placed === undefined) return [];
          // The newest pushed job per environment and repository, as `gitCi.ts` resumes it.
          const rows = yield* sql<{
            readonly environment: string;
            readonly tier: MateGitPush["tier"];
            readonly branch: string;
            readonly repo: string;
            readonly sha: string;
            readonly ci: HqPushCi | null;
          }>`
            SELECT environment, tier, branch, repo, sha, ci FROM (
              SELECT DISTINCT ON (e.id, j.repo) e.name AS environment, e.tier, e.branch, j.repo,
                     j.sha, j.evidence->'ci' AS ci, e.declared_seq
              FROM hq_environment e
              JOIN hq_deploy_job j ON j.environment_id = e.id
                AND j.kind = 'push' AND j.state = 'pushed'
              WHERE e.app_id = ${placed.app_id}::uuid AND e.target = 'git'
              ORDER BY e.id, j.repo, j.id DESC
            ) latest
            ORDER BY declared_seq, repo`;
          return rows.map(({ ci, ...push }) => (ci === null ? push : { ...push, ci }));
        }),
      mateProduction: (projectId) =>
        Effect.gen(function* () {
          const [placed] = yield* matePlaced(projectId);
          if (placed === undefined) return false;
          const rows = yield* sql`
            SELECT 1 FROM hq_environment
            WHERE app_id = ${placed.app_id}::uuid AND tier = 'production' LIMIT 1`;
          return rows.length > 0;
        }),
      editChange: (projectId, repo, number, written) =>
        Effect.gen(function* () {
          const edit =
            written.body === undefined
              ? written
              : { ...written, body: describedOnce(written.body) };
          const appId = yield* mateChange(projectId, repo, number);
          const edited = yield* touched(
            leader.write(
              Effect.gen(function* () {
                yield* openChangeLocked(appId, repo, number);
                const [row] = yield* sql<ChangeRow>`
                UPDATE hq_change
                SET title = COALESCE(${edit.title ?? null}, title),
                    body = COALESCE(${edit.body ?? null}, body),
                    receipt = COALESCE(
                      ${edit.receipt === undefined ? null : encodeReceipt(edit.receipt)}::jsonb,
                      receipt
                    ),
                    -- Words describe the head they were written at; a title describes nothing.
                    ready_head = CASE
                      WHEN ${edit.body === undefined} THEN ready_head
                      WHEN ${(edit.body ?? "").trim() === ""} THEN NULL
                      ELSE head
                    END,
                    -- A receipt is no words: it leaves the change's last edit where it was.
                    updated_at = CASE
                      WHEN ${edit.title === undefined && edit.body === undefined} THEN updated_at
                      ELSE now()
                    END
                WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}
                RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
                return changeOf(row!);
              }),
            ),
          );
          // Described, it asks for review: a task's status line says so now, not when it opened.
          if (edit.body !== undefined) yield* tellTasksOf(appId, repo, number);
          return edited;
        }),
      mateCloseChange: (projectId, repo, number) =>
        Effect.gen(function* () {
          const appId = yield* mateChange(projectId, repo, number, "close_own_change");
          return yield* touched(
            leader.write(
              Effect.gen(function* () {
                yield* openChangeLocked(appId, repo, number);
                const change = yield* changeIn(appId, repo, number);
                // Handed to another Mate since `can` decided: no longer its own to give up.
                if (change.mateProjectId !== projectId)
                  return yield* refuse("forbidden", "not_your_change");
                // A task's change is decided with its task, and closed by a person.
                const [task] = yield* sql<{ readonly on_task: boolean }>`
                  SELECT task_id IS NOT NULL AS on_task FROM hq_change
                  WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}`;
                if (task?.on_task === true) return yield* refuse("conflict", "change_on_task");
                // The person reads who closed it where they read the change's conversation.
                yield* sql`
                  INSERT INTO hq_change_comment (app_id, repo, number, author_mate_project_id, body)
                  VALUES (${appId}::uuid, ${repo}, ${number}, ${projectId},
                    ${`Closed without merging. Its branch ${change.branch} stays.`})`;
                return yield* closeLocked(change, { by: "mate", mateProjectId: projectId });
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
      taskChanges: Stream.fromPubSub(taskChanged),
      openedOnBranch: Stream.fromPubSub(openedUnrecorded),
      comments: Stream.fromPubSub(commented),
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
            Effect.catchTags({ NotLeader: () => Effect.succeed(undefined) }),
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
          const merges =
            shas.length === 0
              ? []
              : yield* sql<{
                  readonly merged_sha: string | null;
                  readonly pr_merged_sha: string | null;
                  readonly number: number;
                  readonly title: string;
                  readonly mate_project_id: string;
                }>`
                  SELECT c.merged_sha, pr.merged_sha AS pr_merged_sha, c.number, c.title,
                    c.mate_project_id
                  FROM hq_change c
                  LEFT JOIN hq_pull_request pr
                    ON pr.app_id = c.app_id AND pr.repo = c.repo AND pr.number = c.number
                  WHERE c.app_id::text = ${appId} AND c.repo = ${repo}
                    AND (${sql.in("c.merged_sha", shas)} OR ${sql.in("pr.merged_sha", shas)})`;
          const landed = changesOfCommits(between.items, merges);
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
          const mainHead = yield* mainOf(git, at);
          if (query.expectedHead !== undefined && query.expectedHead !== change.head) {
            return yield* refuse("conflict", "head_moved");
          }
          if (query.expectedMain !== undefined && query.expectedMain !== mainHead) {
            return yield* refuse("conflict", "main_moved");
          }
          const snapshot = { head: change.head, main: mainHead };
          const diff = yield* git.changeDiff(at, branchOf(change), {
            maxFiles: 300,
            maxBytesPerFile: 256 * 1024,
            snapshot,
          });
          // A squash lands content without its original commits: a commit reachable from the head
          // of any change landed before this one is landed content — whoever's, whatever its
          // number — be the change continued from it or built on it while it was open. The
          // repository's latest landings, and its Mate's own last one at any age: what it goes on
          // from however many landed since.
          const before = sql`
            app_id = ${change.appId}::uuid AND repo = ${change.repo}
              AND number <> ${number} AND state = 'merged' AND landed_head IS NOT NULL
              AND (${change.mergedAt}::timestamptz IS NULL
                OR merged_at < ${change.mergedAt}::timestamptz)`;
          const landed = yield* sql<{ readonly landed_head: string }>`
            (SELECT landed_head FROM hq_change WHERE ${before}
              ORDER BY merged_at DESC NULLS LAST, number DESC LIMIT ${LANDED_BASES})
            UNION
            (SELECT landed_head FROM hq_change
              WHERE ${before} AND mate_project_id = ${change.mateProjectId}
              ORDER BY merged_at DESC NULLS LAST, number DESC LIMIT 1)`;
          const log = yield* git.changeLog(at, branchOf(change), {
            limit: 100,
            snapshot,
            landed: landed.map((row) => row.landed_head),
          });
          const mergeBase = yield* git.mergeBase(at, branchOf(change), snapshot);
          const mergeability = yield* git.mergeability(at, branchOf(change), snapshot);
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
            // As the wire declares it: how a clean change lands is the merge's to decide.
            mergeability: mergeability.kind === "clean" ? { kind: "clean" as const } : mergeability,
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
                return { comment, appId: change.appId, repo: change.repo };
              }),
            ),
          ).pipe(
            Effect.tap(({ comment, appId: app, repo: at }) =>
              PubSub.publish(commented, {
                appId: app,
                repo: at,
                number,
                commentId: comment.id,
                userId,
                body,
              }),
            ),
            Effect.map(({ comment }) => comment),
          );
        }),
      mergeChange: (userId, appId, repo, number, expectedHead) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "merge_change");
          const change = yield* changeIn(appId, repo, number);
          const merged = yield* land(change, expectedHead, { userId }, asItIs);
          // Merged in Mate: a task's status line says so where the task came from.
          yield* tellTasksOf(appId, repo, number);
          return merged;
        }),
      landImported: (appId, repo, number, mergedSha, mergedHead) =>
        Effect.gen(function* () {
          const git = yield* gitHost.git;
          const at = { appId, id: repo };
          return yield* touched(
            leader.write(
              Effect.gen(function* () {
                yield* sql`
                  SELECT 1 FROM hq_repo WHERE app_id::text = ${appId} AND name = ${repo}
                  FOR UPDATE`;
                const [row] = yield* sql<ChangeRow>`
                  SELECT ${sql.literal(CHANGE_COLUMNS)} FROM hq_change
                  WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}
                  FOR UPDATE`;
                if (row === undefined) return yield* refuse("change_not_found", "change_not_found");
                if (row.state === "merged") return changeOf(row);
                if (row.state !== "open") return yield* refuse("conflict", "change_not_open");
                // Only a merge HQ's main holds: never a commit named by someone else's word alone.
                if (!(yield* git.onMain(at, mergedSha)))
                  return yield* refuse("commit_not_found", "commit_not_found");
                const first = yield* firstCodeMergeOf(sql, { appId, repo, number });
                // A head no person merged in Mate (`hq_gate`) landed outside Mate.
                const [merged] = yield* sql<ChangeRow>`
                  UPDATE hq_change
                  SET state = 'merged', merged_sha = ${mergedSha},
                      landed_head = COALESCE(${mergedHead ?? null}, head),
                      landed_outside = NOT EXISTS (
                        SELECT 1 FROM hq_gate g
                        WHERE g.app_id = hq_change.app_id AND g.repo = hq_change.repo
                          AND g.sha = COALESCE(${mergedHead ?? null}, hq_change.head)),
                      merged_at = now(), updated_at = now(),
                      mergeability = 'already_merged', behind = false,
                      first_code_merge = ${first}::boolean
                  WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}
                  RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
                yield* addRollout(sql, { cause: "merge", appId, repo, sha: mergedSha });
                yield* appendEvent(sql, {
                  kind: "merged",
                  appId,
                  repo,
                  number,
                  data: { mergedSha, landedHead: mergedHead ?? row.head, by: "github" },
                });
                return changeOf(merged!);
              }),
            ),
          );
        }),
      personMay: (userId, appId, verb) => personApp(userId, appId, verb),
      change: (appId, repo, number) => changeIn(appId, repo, number),
      closeOnGithub: (appId, repo, number, by) =>
        touched(
          leader.write(
            Effect.gen(function* () {
              const [open] = yield* sql<{ readonly state: string }>`
                SELECT state FROM hq_change
                WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}
                FOR UPDATE`;
              if (open?.state !== "open") return undefined;
              return yield* closeLocked(
                yield* changeIn(appId, repo, number).pipe(Effect.orDie),
                by,
              );
            }),
          ),
        ),
      githubComment: (appId, repo, number, comment) =>
        touched(
          leader.write(
            Effect.gen(function* () {
              const kept = yield* sql<{ readonly id: string }>`
                INSERT INTO hq_change_comment
                  (app_id, repo, number, author_github_login, github_key, body)
                VALUES (${appId}::uuid, ${repo}, ${number}, ${comment.login}, ${comment.key},
                  ${comment.body})
                ON CONFLICT (app_id, repo, number, github_key) WHERE github_key IS NOT NULL
                DO NOTHING
                RETURNING id::text AS id`;
              if (kept.length === 0) return false;
              // A comment moves the change.
              yield* sql`
                UPDATE hq_change SET updated_at = now()
                WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}`;
              yield* appendEvent(sql, {
                kind: "commented",
                appId,
                repo,
                number,
                data: { commentId: kept[0]!.id, githubLogin: comment.login },
              });
              return true;
            }),
          ),
        ),
      touch: SubscriptionRef.update(ticks, (n) => n + 1),
      closeChange: (userId, appId, repo, number, expectedHead) =>
        Effect.andThen(
          personApp(userId, appId, "close_change"),
          close(appId, repo, number, { userId }, expectedHead),
        ),
      handChange: (userId, appId, repo, number, mateProjectId) =>
        Effect.andThen(
          personApp(userId, appId, "close_change"),
          touched(
            leader.write(
              Effect.gen(function* () {
                // The repository's row, locked, as an opening locks it: its Mates' default changes
                // are decided one write at a time.
                yield* sql`
                  SELECT 1 FROM hq_repo WHERE app_id = ${appId}::uuid AND name = ${repo} FOR UPDATE`;
                yield* openChangeLocked(appId, repo, number);
                const change = yield* changeIn(appId, repo, number);
                if (change.mateGone !== true) return yield* refuse("conflict", "change_has_mate");
                const mates = yield* sql`
                  SELECT 1 FROM hq_app_project
                  WHERE project_id = ${mateProjectId} AND app_id = ${appId}::uuid AND kind = 'mate'`;
                if (mates.length === 0) return yield* refuse("conflict", "not_app_mate");
                // Off any task, one more open change of its new Mate's, however many it holds: the
                // cap guards agents, never a person. Only a change on that Mate's own default
                // branch, handed away from it once, would be its default change a second time.
                const own = yield* sql`
                  SELECT 1 FROM hq_change
                  WHERE app_id = ${appId}::uuid AND repo = ${repo} AND state = 'open'
                    AND mate_project_id = ${mateProjectId} AND task_id IS NULL
                    AND branch = 'mate/' || mate_project_id || '/' || number::text`;
                if (own.length > 0 && change.branch === `mate/${mateProjectId}/${String(number)}`)
                  return yield* refuse("conflict", "mate_has_change");
                const [row] = yield* sql<ChangeRow>`
                  UPDATE hq_change
                  SET mate_project_id = ${mateProjectId}, task_id = NULL,
                      handed_from = mate_project_id, updated_at = now()
                  WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}
                  RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
                yield* appendEvent(sql, {
                  kind: "handed",
                  appId,
                  repo,
                  number,
                  data: { from: change.mateProjectId, to: mateProjectId, userId },
                });
                return changeOf(row!);
              }),
            ),
          ),
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
