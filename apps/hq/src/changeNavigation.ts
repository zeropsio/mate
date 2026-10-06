import type { HqNavigationChange } from "@t3tools/shared/hqStream";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Raw organization computation. Read access is checked by the scope hub at delivery. */
export interface ChangeNavigationSource {
  readonly fingerprints: ReadonlyMap<string, string>;
  readonly forApp: (appId: string) => ReadonlyArray<HqNavigationChange>;
}
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const readChangeNavigationSource = Effect.fnUntraced(function* (sql: SqlClient.SqlClient) {
  const rows = yield* sql<{
    readonly app_id: string;
    readonly repo: string;
    readonly number: number;
    readonly mate_project_id: string;
    readonly title: string;
    readonly has_head: boolean;
    readonly updated_at: string;
    readonly mergeability: HqNavigationChange["mergeability"];
    readonly ready: boolean;
  }>`SELECT app_id::text AS app_id, repo, number, mate_project_id, title,
      head IS NOT NULL AS has_head,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
      mergeability, (repo = ${RECIPE_REPO} OR COALESCE(ready_head = head, false)) AS ready
    FROM hq_change WHERE state = 'open'
    ORDER BY app_id, updated_at DESC, number DESC, repo`;
  const apps = new Map<string, HqNavigationChange[]>();
  for (const row of rows) {
    let list = apps.get(row.app_id);
    if (list === undefined) {
      list = [];
      apps.set(row.app_id, list);
    }
    list.push({
      repo: row.repo,
      number: row.number,
      mateProjectId: row.mate_project_id,
      title: row.title,
      state: "open",
      hasHead: row.has_head,
      updatedAt: row.updated_at,
      mergeability: row.mergeability,
      ready: row.ready,
    });
  }
  return {
    fingerprints: new Map([...apps].map(([app, list]) => [app, json(list)])),
    forApp: (appId: string) => apps.get(appId) ?? [],
  } satisfies ChangeNavigationSource;
});
