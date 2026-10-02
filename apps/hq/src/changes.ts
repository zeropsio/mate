/**
 * A Mate's changes (SPEC §3.2a, `@t3tools/shared/hqChanges`): the repositories HQ keeps for an
 * application and the changes Mates deliver into them, the replacement of a pull request.
 *
 * A Mate works only in the application HQ holds it in: it names a repository by its name, and HQ
 * finds it there, so no Mate ever names another application. Whether it may is `can`
 * (`@t3tools/shared/zeropsPermissions`), asked in {@link Changes} `mateApp` — the one place a Mate's
 * verbs are decided — over the org read fresh. Every write is fenced by the leader.
 *
 * @module changes
 */
import type { GitError } from "@t3tools/hq-git";
import {
  type AttachmentResponse,
  type ChangeDetailResponse,
  type HqChange,
  type HqChangeComment,
  type HqRepo,
  CHANGE_LIST_SETTLED,
  MATE_CHANGES_PER_REPO,
  type MateChanges,
  type OpenChangeResponse,
  attachmentPath,
} from "@t3tools/shared/hqChanges";
import { REASONS, can } from "@t3tools/shared/zeropsPermissions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { appendEvent } from "./gitEvents.ts";
import { GitHost, mainOf } from "./gitHost.ts";
import { heldOf } from "./held.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { Roles } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

export class ChangeRefused extends Schema.TaggedError<ChangeRefused>()("ChangeRefused", {
  code: Schema.Literals([
    "forbidden",
    "project_not_found",
    "app_not_found",
    "repo_not_found",
    "change_not_found",
    "attachment_not_found",
    "conflict",
    "invalid",
  ]),
  /** Why: a permission's reason (`zeropsPermissions.ts`) or one of the changes' own. */
  reason: Schema.Literals([
    ...REASONS,
    "app_not_found",
    "repo_not_found",
    "change_not_found",
    "attachment_not_found",
    "change_not_open",
    "not_png",
  ]),
}) {}

/** The verbs a Mate does in its application. */
export type MateVerb = "ensure_repo" | "open_change" | "edit_change";

type MateError = ChangeRefused | NotLeader | SqlError | ZeropsError;

type ReadError = ChangeRefused | SqlError | ZeropsError;

export class Changes extends Context.Service<
  Changes,
  {
    /**
     * The application the Mate of `projectId` does `verb` in: the one HQ holds it in, as `can`
     * decides it over the org read now.
     */
    readonly mateApp: (projectId: string, verb: MateVerb) => Effect.Effect<string, MateError>;
    /** The repository `name` in the Mate's application, made if new: `main` begins with HQ's commit. */
    readonly ensureRepo: (
      projectId: string,
      name: string,
    ) => Effect.Effect<HqRepo, MateError | GitError>;
    /** The Mate's open change in `repo`, or the next number opened with `title`. */
    readonly openChange: (
      projectId: string,
      repo: string,
      title: string,
    ) => Effect.Effect<OpenChangeResponse, MateError>;
    /** The Mate's open change `number` in `repo`, retitled, described, or both. */
    readonly editChange: (
      projectId: string,
      repo: string,
      number: number,
      edit: { readonly title?: string; readonly body?: string },
    ) => Effect.Effect<HqChange, MateError>;
    /**
     * What the Mate's own state carries of its changes: the application HQ holds it in, and there
     * its latest changes per repository, newest first.
     */
    readonly mateChanges: (projectId: string) => Effect.Effect<MateChanges, SqlError>;
    /** A picture for the Mate's open change: a PNG, kept for its description to show. */
    readonly attach: (
      projectId: string,
      repo: string,
      number: number,
      png: Uint8Array,
    ) => Effect.Effect<AttachmentResponse, MateError>;
    /**
     * An application's changes as a person reads them: its open ones and its latest
     * {@link CHANGE_LIST_SETTLED} merged or closed ones, newest first.
     */
    readonly listChanges: (
      userId: string,
      appId: string,
    ) => Effect.Effect<ReadonlyArray<HqChange>, ReadError>;
    /** A change and what its review reads, from git. */
    readonly changeDetail: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
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
    /** A picture of a change, its PNG's bytes. */
    readonly attachment: (
      userId: string,
      appId: string,
      repo: string,
      number: number,
      id: string,
    ) => Effect.Effect<Uint8Array, ReadError>;
  }
>()("@t3tools/hq/changes") {}

/** Who writes HQ's own commits. */
const HQ_AUTHOR = { name: "HQ", email: "hq@hq.invalid" };

const refuse = (code: ChangeRefused["code"], reason: ChangeRefused["reason"]) =>
  Effect.fail(new ChangeRefused({ code, reason }));

/** The bytes every PNG begins with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);

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
}

const COMMENT_COLUMNS = ["id::text AS id", "author_user_id", "body", instant("created_at")].join(
  ", ",
);

interface CommentRow {
  readonly id: string;
  readonly author_user_id: string;
  readonly body: string;
  readonly created_at: string;
}

const commentOf = (row: CommentRow): HqChangeComment => ({
  id: row.id,
  authorUserId: row.author_user_id,
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

    const mateApp = (projectId: string, verb: MateVerb) =>
      Effect.gen(function* () {
        const view = yield* roles.fresh;
        const [placed] = yield* sql<{ readonly app_id: string }>`
          SELECT app_id::text AS app_id FROM hq_app_project WHERE project_id = ${projectId}`;
        const target = {
          projectId,
          appId: placed?.app_id ?? null,
          held: yield* heldOf(sql, projectId),
        };
        const decision = can({ kind: "mate", projectId }, verb, target, view);
        if (!decision.allow) {
          const { reason } = decision;
          yield* Effect.logInfo("mate refused", { projectId, verb, target, reason });
          return yield* refuse(
            reason === "project_gone" ? "project_not_found" : "forbidden",
            reason,
          );
        }
        // `can` allows a Mate's verb only in an application.
        return target.appId!;
      });

    /**
     * Whether the person `userId` may `verb` the changes of the application `appId`: `can` over
     * all of its projects — a read over the org up to 30 s old, a comment over the org read now.
     * Decided before the application's existence, so an id tells nobody without the right whether
     * it names an application. Applications are compared by their id's text, which a path may
     * spell any way.
     */
    const personApp = (userId: string, appId: string, verb: "read_change" | "comment_change") =>
      Effect.gen(function* () {
        const projects = yield* sql<{ readonly project_id: string }>`
          SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
        const target = { projectIds: projects.map((row) => row.project_id) };
        const person = { kind: "person", userId } as const;
        const decision =
          verb === "read_change"
            ? can(person, "read_change", target, yield* roles.view)
            : can(person, "comment_change", target, yield* roles.fresh);
        if (!decision.allow) {
          yield* Effect.logInfo("change refused", { userId, verb, appId, reason: decision.reason });
          return yield* refuse("forbidden", decision.reason);
        }
        const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
        if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
      });

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

    /**
     * In a fenced write: the Mate's own change, locked, while it is open. Another Mate's change is
     * none of its own.
     */
    const ownOpenChange = (appId: string, projectId: string, repo: string, number: number) =>
      Effect.gen(function* () {
        const [change] = yield* sql<{ readonly state: string }>`
          SELECT state FROM hq_change
          WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}
            AND mate_project_id = ${projectId}
          FOR UPDATE`;
        if (change === undefined) return yield* refuse("change_not_found", "change_not_found");
        if (change.state !== "open") return yield* refuse("conflict", "change_not_open");
      });

    return Changes.of({
      mateApp,
      ensureRepo: (projectId, name) =>
        Semaphore.withPermits(
          making,
          1,
        )(
          Effect.gen(function* () {
            const appId = yield* mateApp(projectId, "ensure_repo");
            const git = yield* gitHost.git;
            const repo = { appId, id: name };
            yield* leader.write(sql`
              INSERT INTO hq_repo (app_id, name, created_by)
              VALUES (${appId}::uuid, ${name}, ${projectId})
              ON CONFLICT DO NOTHING`);
            // Each step holds when it is done already, so a call cut short is finished by the next.
            yield* git.create(repo).pipe(
              Effect.catchIf(
                (error) => error.reason === "exists",
                () => Effect.void,
              ),
            );
            // An empty tree's commit gives every change a base, as Gitea's first commit did; a main
            // that is there already (`head_moved`) stays as it is.
            yield* git.commitFiles(repo, "refs/heads/main", {
              files: {},
              expectedHead: null,
              message: "Initial commit",
              author: HQ_AUTHOR,
            });
            return { appId, name };
          }),
        ),
      openChange: (projectId, repo, title) =>
        Effect.gen(function* () {
          const appId = yield* mateApp(projectId, "open_change");
          const columns = sql.literal(CHANGE_COLUMNS);
          return yield* leader.write(
            Effect.gen(function* () {
              // The repository's row, locked: its next number is taken by one opening at a time.
              const repos = yield* sql`
                SELECT 1 FROM hq_repo WHERE app_id = ${appId}::uuid AND name = ${repo} FOR UPDATE`;
              if (repos.length === 0) return yield* refuse("repo_not_found", "repo_not_found");
              const [open] = yield* sql<ChangeRow>`
                SELECT ${columns} FROM hq_change
                WHERE app_id = ${appId}::uuid AND repo = ${repo}
                  AND mate_project_id = ${projectId} AND state = 'open'`;
              if (open !== undefined) return { change: changeOf(open), created: false };
              const [made] = yield* sql<ChangeRow>`
                INSERT INTO hq_change (app_id, repo, number, mate_project_id, title)
                SELECT ${appId}::uuid, ${repo}, COALESCE(MAX(number), 0) + 1, ${projectId}, ${title}
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
          );
        }),
      mateChanges: (projectId) =>
        Effect.gen(function* () {
          const [placed] = yield* sql<{ readonly app_id: string }>`
            SELECT app_id::text AS app_id FROM hq_app_project
            WHERE project_id = ${projectId} AND kind IN ('mate', 'devstage')`;
          if (placed === undefined) return { appId: null, changes: [] };
          const rows = yield* sql<
            Pick<ChangeRow, "repo" | "number" | "state" | "head" | "merged_sha" | "landed_head">
          >`
            SELECT repo, number, state, head, merged_sha, landed_head FROM (
              SELECT *, row_number() OVER (PARTITION BY repo ORDER BY number DESC) AS rank
              FROM hq_change
              WHERE app_id = ${placed.app_id}::uuid AND mate_project_id = ${projectId}
            ) latest
            WHERE rank <= ${MATE_CHANGES_PER_REPO}
            ORDER BY repo, number DESC`;
          return {
            appId: placed.app_id,
            changes: rows.map((row) => ({
              repo: row.repo,
              number: row.number,
              state: row.state,
              head: row.head,
              mergedSha: row.merged_sha,
              landedHead: row.landed_head,
            })),
          };
        }),
      editChange: (projectId, repo, number, edit) =>
        Effect.gen(function* () {
          const appId = yield* mateApp(projectId, "edit_change");
          return yield* leader.write(
            Effect.gen(function* () {
              yield* ownOpenChange(appId, projectId, repo, number);
              const [row] = yield* sql<ChangeRow>`
                UPDATE hq_change
                SET title = COALESCE(${edit.title ?? null}, title),
                    body = COALESCE(${edit.body ?? null}, body)
                WHERE app_id = ${appId}::uuid AND repo = ${repo} AND number = ${number}
                RETURNING ${sql.literal(CHANGE_COLUMNS)}`;
              return changeOf(row!);
            }),
          );
        }),
      attach: (projectId, repo, number, png) =>
        Effect.gen(function* () {
          if (!isPng(png)) return yield* refuse("invalid", "not_png");
          const appId = yield* mateApp(projectId, "edit_change");
          const id = yield* leader.write(
            Effect.gen(function* () {
              yield* ownOpenChange(appId, projectId, repo, number);
              const [row] = yield* sql<{ readonly id: string }>`
                INSERT INTO hq_change_attachment (app_id, repo, number, content)
                VALUES (${appId}::uuid, ${repo}, ${number}, ${png})
                RETURNING id::text AS id`;
              return row!.id;
            }),
          );
          return { id, path: attachmentPath(appId, repo, number, id) };
        }),
      listChanges: (userId, appId) =>
        Effect.andThen(personApp(userId, appId, "read_change"), windowOf([appId])),
      changeDetail: (userId, appId, repo, number) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          const change = yield* changeIn(appId, repo, number);
          const git = yield* gitHost.git;
          // As the change's record names it, never as the path spelled it.
          const at = { appId: change.appId, id: change.repo };
          const mate = change.mateProjectId;
          const diff = yield* git.changeDiff(at, mate, number, {
            maxFiles: 300,
            maxBytesPerFile: 256 * 1024,
          });
          const log = yield* git.changeLog(at, mate, number, { limit: 100 });
          return {
            change,
            mainHead: yield* mainOf(git, at),
            mergeBase: yield* git.mergeBase(at, mate, number),
            mergeability: yield* git.mergeability(at, mate, number),
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
          return yield* leader.write(
            Effect.gen(function* () {
              const change = yield* changeIn(appId, repo, number);
              const [row] = yield* sql<CommentRow>`
                INSERT INTO hq_change_comment (app_id, repo, number, author_user_id, body)
                VALUES (${change.appId}::uuid, ${change.repo}, ${number}, ${userId}, ${body})
                RETURNING ${sql.literal(COMMENT_COLUMNS)}`;
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
          );
        }),
      attachment: (userId, appId, repo, number, id) =>
        Effect.gen(function* () {
          yield* personApp(userId, appId, "read_change");
          const [row] = yield* sql<{ readonly content: Uint8Array }>`
            SELECT content FROM hq_change_attachment
            WHERE id::text = ${id} AND app_id::text = ${appId} AND repo = ${repo}
              AND number = ${number}`;
          if (row === undefined)
            return yield* refuse("attachment_not_found", "attachment_not_found");
          return row.content;
        }),
    });
  }),
);
