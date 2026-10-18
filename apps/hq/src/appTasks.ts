/**
 * An application's tasks as its Automation board lists them (`HqAppTasksView`): what waits, by its
 * place in the queue; what its automated Mates are on; and the latest 20 that ended, newest
 * first — each with what it cost, how long it worked, its change and pull request, and where it is
 * followed in Mate (`mateTaskLink`). Read by whoever sees the application; a task stopped from it
 * by whoever keeps where its tasks come from (`MateTasks.stop`).
 *
 * @module appTasks
 */
import { mateTaskSourceLabel, mateTaskSourceLink } from "@t3tools/contracts";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import type { NotLeader } from "./leader.ts";
import { MateOverviews } from "./mateOverviews.ts";
import { MateTasks, isTaskId, mateTaskLink } from "./mateTasks.ts";
import { readAppTarget } from "./offers.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { mateNameIn, sourceOfRow } from "./taskSources.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** How many ended tasks the board lists. */
export const ENDED_SHOWN = 20;

/** Why a task stopped from its board, by whom. */
export const stoppedInMate = (name: string) => `${name} stopped it in Mate.`;

export class AppTasks extends Context.Service<
  AppTasks,
  {
    readonly list: (
      userId: string,
      appId: string,
    ) => Effect.Effect<ReadonlyArray<HqAppTask>, AutomationRefused | SqlError | ZeropsError>;
    /**
     * A task of the application stopped: one no Mate took goes, else its Mate is told to stop; one
     * that ended already stays as it ended (nothing to stop). One it has not: `not_found`.
     */
    readonly stop: (
      userId: string,
      appId: string,
      taskId: string,
    ) => Effect.Effect<void, AutomationRefused | NotLeader | SqlError | ZeropsError>;
  }
>()("@t3tools/hq/appTasks") {}

interface TaskRow {
  readonly id: string;
  readonly source: unknown;
  readonly state: string;
  readonly mate: string | null;
  readonly conversation_id: string | null;
  readonly position: number | null;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly spent_usd: number | null;
  readonly worked_ms: number | null;
  readonly detail: string | null;
  readonly change_repo: string | null;
  readonly change_number: number | null;
  readonly change_state: string | null;
  readonly pr_number: number | null;
  readonly pr_url: string | null;
  readonly stopping: boolean;
  readonly seq: number;
}

const LIVE = ["queued", "assigned", "working", "waiting"] as const;

/**
 * A task's state as the board says it: live with a stop taken, stopping; dropped is stopped; done
 * with its change merged, merged, and closed unmerged, closed.
 */
const stateOf = (row: TaskRow): HqAppTask["state"] | undefined => {
  if (row.stopping && (LIVE as ReadonlyArray<string>).includes(row.state)) return "stopping";
  if (row.state === "dropped") return "stopped";
  if (row.state === "done" && row.change_state === "merged") return "merged";
  if (row.state === "done" && row.change_state === "closed") return "closed";
  switch (row.state) {
    case "queued":
    case "assigned":
    case "working":
    case "waiting":
    case "done":
    case "failed":
    case "stopped":
      return row.state;
  }
  return undefined;
};

const ISO = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const COLUMNS = `t.id::text AS id, t.source, t.state,
  COALESCE(t.mate_project_id, t.last_mate_project_id) AS mate, t.conversation_id,
  ${ISO("t.created_at")} AS created_at, ${ISO("t.started_at")} AS started_at,
  ${ISO("t.ended_at")} AS ended_at, t.spent_usd, t.worked_ms::float8 AS worked_ms,
  CASE WHEN t.state = 'waiting' THEN t.question ELSE t.detail END AS detail,
  t.change_repo, t.change_number, c.state AS change_state, pr.pr_number, pr.url AS pr_url,
  t.stop_requested_at IS NOT NULL AS stopping, t.seq::float8 AS seq`;

const JOINS = `LEFT JOIN hq_change c ON c.app_id = t.app_id AND c.repo = t.change_repo
    AND c.number = t.change_number
  LEFT JOIN hq_pull_request pr ON pr.app_id = t.app_id AND pr.repo = t.change_repo
    AND pr.number = t.change_number`;

export const appTasksLayer = Layer.effect(
  AppTasks,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const roles = yield* Roles;
    const overviews = yield* MateOverviews;
    const tasks = yield* MateTasks;
    const refuse = (code: AutomationRefused["code"], reason: string) =>
      Effect.fail(new AutomationRefused({ code, reason }));
    const appExists = (appId: string) =>
      Effect.gen(function* () {
        const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
        if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
      });

    return AppTasks.of({
      list: (userId, appId) =>
        Effect.gen(function* () {
          const view = yield* roles.view;
          // Whether it sees the application first: an id tells nobody else whether it names one.
          const verdict = can(
            { kind: "person", userId },
            "read_app",
            yield* readAppTarget(sql, appId),
            view,
          );
          if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
          yield* appExists(appId);
          const [app] = yield* sql<{ readonly name: string }>`
            SELECT name FROM hq_app WHERE id::text = ${appId}`;
          const rows = yield* sql<TaskRow>`
            SELECT * FROM (
              SELECT ${sql.literal(COLUMNS)},
                CASE WHEN t.state = 'queued'
                  THEN row_number() OVER (PARTITION BY t.state = 'queued' ORDER BY t.seq)::int
                END AS position
              FROM hq_task t ${sql.literal(JOINS)}
              WHERE t.app_id = ${appId}::uuid AND t.state IN ${sql.in(LIVE)}) live
            UNION ALL
            SELECT * FROM (
              SELECT ${sql.literal(COLUMNS)}, NULL::int AS position
              FROM hq_task t ${sql.literal(JOINS)}
              WHERE t.app_id = ${appId}::uuid AND t.ended_at IS NOT NULL
              ORDER BY t.ended_at DESC LIMIT ${ENDED_SHOWN}) ended`;
          // Queued by place, then at work by when it came, then ended, newest first.
          const group = (row: TaskRow) =>
            row.state === "queued" ? 0 : row.ended_at === null ? 1 : 2;
          const ordered = rows.toSorted(
            (a, b) =>
              group(a) - group(b) ||
              (group(a) === 2
                ? (b.ended_at ?? "").localeCompare(a.ended_at ?? "")
                : (a.position ?? 0) - (b.position ?? 0) || a.seq - b.seq),
          );
          const environments = yield* overviews.all;
          const names = new Map(view.projects.map((project) => [project.id, project.name]));
          return ordered.flatMap((row): ReadonlyArray<HqAppTask> => {
            const source = sourceOfRow(row.source);
            const state = stateOf(row);
            if (source === undefined || state === undefined) return [];
            const environmentId =
              row.mate === null
                ? undefined
                : environments.get(row.mate)?.overview?.identity.environmentId;
            const projectName = row.mate === null ? undefined : names.get(row.mate);
            return [
              {
                id: row.id,
                title: source.title,
                label: mateTaskSourceLabel(source),
                url: mateTaskSourceLink(source)?.url ?? null,
                state,
                mate:
                  row.mate === null
                    ? null
                    : {
                        projectId: row.mate,
                        name:
                          projectName === undefined
                            ? "Mate"
                            : mateNameIn(projectName, app?.name) || "Mate",
                      },
                ...(row.position === null ? {} : { position: row.position }),
                requestedBy: "author" in source ? source.author : null,
                createdAt: row.created_at,
                startedAt: row.started_at,
                endedAt: row.ended_at,
                spentUsd: row.spent_usd,
                workedMs: row.worked_ms,
                detail: row.detail,
                change:
                  row.change_repo === null || row.change_number === null
                    ? null
                    : { repo: row.change_repo, number: row.change_number },
                pullRequest:
                  row.pr_number === null || row.pr_url === null
                    ? null
                    : { number: row.pr_number, url: row.pr_url },
                // Followed where its Mate works it: its conversation once said, else its Mate.
                link:
                  row.mate === null
                    ? null
                    : mateTaskLink(
                        row.mate,
                        environmentId === undefined || row.conversation_id === null
                          ? undefined
                          : { environmentId, conversationId: row.conversation_id },
                      ),
              },
            ];
          });
        }),
      stop: (userId, appId, taskId) =>
        confirmingRefusal(
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            // Whoever keeps where the application's tasks come from stops them.
            const verdict = can({ kind: "person", userId }, "keep_intake", null, view);
            if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
            yield* appExists(appId);
            const found = isTaskId(taskId)
              ? yield* sql`
                  SELECT 1 FROM hq_task WHERE id = ${taskId}::uuid AND app_id = ${appId}::uuid`
              : [];
            if (found.length === 0) return yield* refuse("not_found", "task_not_found");
            const name =
              view.members.find((member) => member.userId === userId)?.name.trim() || "Someone";
            yield* tasks.stop(taskId, stoppedInMate(name));
          }),
        ),
    });
  }),
);
