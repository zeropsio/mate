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
import type { HqChange, HqRepo, OpenChangeResponse } from "@t3tools/shared/hqChanges";
import { REASONS, can } from "@t3tools/shared/zeropsPermissions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { appendEvent } from "./gitEvents.ts";
import { GitHost } from "./gitHost.ts";
import { heldOf } from "./held.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { Roles } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

export class ChangeRefused extends Schema.TaggedError<ChangeRefused>()("ChangeRefused", {
  code: Schema.Literals([
    "forbidden",
    "project_not_found",
    "repo_not_found",
    "change_not_found",
    "attachment_not_found",
    "conflict",
    "invalid",
  ]),
  /** Why: a permission's reason (`zeropsPermissions.ts`) or one of the changes' own. */
  reason: Schema.Literals([
    ...REASONS,
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
  }
>()("@t3tools/hq/changes") {}

/** Who writes HQ's own commits. */
const HQ_AUTHOR = { name: "HQ", email: "hq@hq.invalid" };

const refuse = (code: ChangeRefused["code"], reason: ChangeRefused["reason"]) =>
  Effect.fail(new ChangeRefused({ code, reason }));

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
    });
  }),
);
