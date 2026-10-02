/**
 * The durable log of what happened to repositories and changes (`hq_git_event`): written in the
 * transaction of the change it records, or from the git layer's events; read in order of `seq`, so a
 * reader resumes after the last one it read.
 *
 * @module gitEvents
 */
import type * as SqlClient from "effect/unstable/sql/SqlClient";

export type GitEventKind =
  | "pushed"
  | "opened"
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
