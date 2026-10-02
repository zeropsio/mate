/**
 * What HQ holds a project as now — the target's current kind every permission is decided with
 * (`@t3tools/shared/zeropsPermissions`): its kind in an application, `mate` for a Mate in none,
 * `none` otherwise.
 *
 * @module held
 */
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

export const heldOf = (sql: SqlClient.SqlClient, projectId: string) =>
  Effect.map(
    sql<{ readonly held: string }>`
      SELECT COALESCE(
        (SELECT kind FROM hq_app_project WHERE project_id = ${projectId}),
        (SELECT 'mate' FROM hq_mate WHERE project_id = ${projectId}),
        'none') AS held`,
    (rows) => rows[0]?.held ?? "none",
  );
