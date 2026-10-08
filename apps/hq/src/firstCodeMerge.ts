/**
 * Whether a change's merge is its application's first of a code change: no other code change of
 * it merged before. The recipe repository (`RECIPE_REPO`) holds the recipe, never code, so a change
 * there is neither the first nor a later one.
 *
 * @module firstCodeMerge
 */
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

/**
 * In the write that merges the change: the application's row locked, so merges of two of its
 * repositories, each under its own repository's lock, still go one at a time, and each reads the
 * other's record once it is committed. None for a recipe repository's change.
 */
export const firstCodeMergeOf = (
  sql: SqlClient.SqlClient,
  change: { readonly appId: string; readonly repo: string; readonly number: number },
): Effect.Effect<boolean | null, SqlError> =>
  Effect.gen(function* () {
    if (change.repo === RECIPE_REPO) return null;
    yield* sql`SELECT 1 FROM hq_app WHERE id = ${change.appId}::uuid FOR NO KEY UPDATE`;
    const [other] = yield* sql`
      SELECT 1 FROM hq_change
      WHERE app_id = ${change.appId}::uuid AND repo <> ${RECIPE_REPO} AND state = 'merged'
        AND NOT (repo = ${change.repo} AND number = ${change.number})
      LIMIT 1`;
    return other === undefined;
  });
