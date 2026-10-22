import type { HqPullRequest } from "@t3tools/shared/hqGithub";
import type { HqNavigationChange } from "@t3tools/shared/hqStream";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

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
    readonly mate_gone: boolean;
    readonly title: string;
    readonly has_head: boolean;
    readonly updated_at: string;
    readonly mergeability: HqNavigationChange["mergeability"];
    readonly ready: boolean;
    readonly pr_number: number | null;
    readonly pr_url: string | null;
    readonly pr_state: HqPullRequest["state"] | null;
    readonly pr_checks: HqPullRequest["checks"] | null;
  }>`SELECT c.app_id::text AS app_id, c.repo, c.number, c.mate_project_id, c.title,
      NOT EXISTS (SELECT 1 FROM hq_app_project p
        WHERE p.project_id = c.mate_project_id AND p.app_id = c.app_id AND p.kind = 'mate')
        AS mate_gone,
      c.head IS NOT NULL AS has_head,
      to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
      c.mergeability, (c.repo = ${RECIPE_REPO} OR COALESCE(c.ready_head = c.head, false)) AS ready,
      pr.pr_number, pr.url AS pr_url, pr.state AS pr_state, pr.checks AS pr_checks
    FROM hq_change c
    LEFT JOIN hq_pull_request pr
      ON pr.app_id = c.app_id AND pr.repo = c.repo AND pr.number = c.number
    WHERE c.state = 'open'
    ORDER BY c.app_id, c.updated_at DESC, c.number DESC, c.repo`;
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
      ...(row.mate_gone ? { mateGone: true as const } : {}),
      title: row.title,
      state: "open",
      hasHead: row.has_head,
      updatedAt: row.updated_at,
      mergeability: row.mergeability,
      ready: row.ready,
      ...(row.pr_number === null || row.pr_url === null || row.pr_state === null
        ? {}
        : {
            pullRequest: {
              number: row.pr_number,
              url: row.pr_url,
              state: row.pr_state,
              ...(row.pr_checks === null || row.pr_checks === undefined
                ? {}
                : { checks: row.pr_checks }),
            },
          }),
    });
  }
  return {
    fingerprints: new Map([...apps].map(([app, list]) => [app, json(list)])),
    forApp: (appId: string) => apps.get(appId) ?? [],
  } satisfies ChangeNavigationSource;
});
