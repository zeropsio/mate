/**
 * The durable log of what happened to repositories and changes (`hq_git_event`): written in the
 * transaction of the change it records, or from the git layer's events; read in order of `seq`, so a
 * reader resumes after the last one it read.
 *
 * @module gitEvents
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export type GitEventKind =
  | "pushed"
  | "opened"
  | "delivery_empty"
  | "main_moved"
  | "merged"
  | "closed"
  | "commented"
  | "released";

/** Appends one event; inside a fenced write (`leader.ts`). */
export const appendEvent = (
  sql: SqlClient.SqlClient,
  event: {
    readonly kind: GitEventKind;
    readonly appId: string;
    readonly repo: string;
    readonly number: number | null;
    readonly data: object;
  },
) =>
  sql`
    INSERT INTO hq_git_event (kind, app_id, repo, number, data)
    VALUES (${event.kind}, ${event.appId}::uuid, ${event.repo}, ${event.number},
      ${JSON.stringify(event.data)}::jsonb)`;

/**
 * Where each application's releases and its repositories' `main` last moved (audit R4): the
 * sequence of its log's last release, merge or move of `main`, by application id. A reader reads
 * them again only when it moves; an application none moved yet has none.
 */
export const releaseRevisions = Effect.flatMap(SqlClient.SqlClient, (sql) =>
  Effect.map(
    sql<{ readonly app_id: string; readonly revision: string }>`
      SELECT app_id::text AS app_id, max(seq)::text AS revision
      FROM hq_git_event WHERE kind IN ('main_moved', 'merged', 'released')
      GROUP BY app_id`,
    (rows) => new Map(rows.map((row) => [row.app_id, row.revision])),
  ),
);
