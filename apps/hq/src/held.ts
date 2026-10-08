/**
 * What HQ holds a project as now — the target's current kind every permission is decided with
 * (`permissions.ts`): its kind in an application, `mate` for a Mate in none,
 * `none` otherwise.
 *
 * A write that decides on it and changes it takes {@link lockProject} first, in its fenced
 * transaction, and reads it after: a Mate's record and an environment, or two placements, of one
 * project are decided one after the other, never both on what neither has written yet.
 *
 * @module held
 */
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

export const heldOf = (sql: SqlClient.SqlClient, projectId: string) =>
  Effect.map(
    sql<{ readonly held: string }>`
      SELECT COALESCE(
        (SELECT kind FROM hq_app_project WHERE project_id = ${projectId}),
        (SELECT 'mate' FROM hq_mate WHERE project_id = ${projectId}),
        'none') AS held`,
    (rows) => rows[0]?.held ?? "none",
  );

/**
 * The advisory locks' namespace of a project: the two-key form, which never meets the leader's
 * one-key lock (`leader.ts`).
 */
const PROJECT_LOCKS = 1_213_221_458;

/** Locks the project until the transaction ends. */
export const lockProject = (sql: SqlClient.SqlClient, projectId: string) =>
  sql`SELECT pg_advisory_xact_lock(${PROJECT_LOCKS}::int4, hashtext(${projectId}))`;
