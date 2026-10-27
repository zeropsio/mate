import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parseSync, Visitor } from "oxc-parser";
import { parseFindingMessage } from "../exceptions.ts";
import { runOxlintFixtures } from "../test/utils.ts";

it.effect(
  "An environment identity cannot become a project address outside its target binding.",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.join(import.meta.dirname, "../..");
      const filenames = [
        "apps/web/src/routes/_chat.group.$groupId.$projectId.tsx",
        "apps/web/src/routes/_chat.mate.$projectId.tsx",
        "apps/web/src/components/zerops/ZeropsGroupDetail.tsx",
      ];
      const sources = new Map(
        yield* Effect.all(
          filenames.map((filename) =>
            fs
              .readFileString(path.join(root, filename))
              .pipe(Effect.map((text) => [filename, text] as const)),
          ),
          { concurrency: "unbounded" },
        ),
      );
      const source = (filename: string) => {
        const text = sources.get(filename);
        if (text === undefined) throw new Error(`Missing source fixture: ${filename}`);
        return text;
      };
      const sqlFile = "packages/shared/src/fixtureSql.ts";
      const route = "apps/web/src/routes/_chat.group.$groupId.$projectId.tsx";
      const owner = "packages/client-runtime/src/data/projections/identity.ts";
      const mutate = (filename: string, before: string, after: string) => {
        const original = source(filename);
        expect(original).toContain(before);
        return original.replace(before, after);
      };
      const cases = [
        { filename: route, source: source(route), kind: undefined },
        {
          filename: "apps/web/src/routes/_chat.mate.$projectId.tsx",
          source: source("apps/web/src/routes/_chat.mate.$projectId.tsx"),
          kind: undefined,
        },
        {
          filename: "apps/web/src/components/zerops/ZeropsGroupDetail.tsx",
          source: source("apps/web/src/components/zerops/ZeropsGroupDetail.tsx"),
          kind: undefined,
        },
        {
          filename: route,
          source: mutate(route, "environmentId={environmentId}", "projectId={environmentId}"),
          kind: "raw-route-project-read",
        },
        ...[
          "sql`SELECT project_id FROM hq_deploy_job WHERE project_id = ${id}`",
          'sql("SELECT j.project_id FROM hq_deploy_job AS j JOIN hq_environment e ON e.id = j.project_id")',
          "sql`SELECT row_number() OVER (PARTITION BY r.project_id) FROM hq_rollout r`",
          "sql`UPDATE hq_deploy_job SET state = 'failed' WHERE project_id = ${id}`",
          "sql`DELETE FROM hq_rollout WHERE project_id = ${id}`",
          "sql`INSERT INTO hq_rollout (environment_id, project_id) VALUES (${id}, ${project}) RETURNING project_id`",
          "sql`SELECT entry->>'project_id' FROM hq_rollout r, jsonb_array_elements(r.left_out) entry`",
          "sql`SELECT l.project_id FROM hq_rollout r, jsonb_to_recordset(r.left_out) AS l(project_id text)`",
          "const columns = 'j.project_id'; const from = 'hq_deploy_job j'; sql`SELECT ${sql.unsafe(columns)} FROM ${sql.unsafe(from)}`",
        ].map((expression) => ({
          filename: sqlFile,
          source: `export function read() { ${expression}; }`,
          kind: "sql-project-identity-read",
        })),
        ...[
          "export function address(id: HqEnvironmentId) { return id as string; }",
          "export function address(id: HqEnvironmentId) { const alias = id; return String(alias); }",
          "export function address(id: HqEnvironmentId) { const stringify = String; return stringify(id); }",
          "const id = HqEnvironmentId.make('environment'); const alias = id; export const address = alias as string;",
          "export function address(env: { readonly id: HqEnvironmentId }) { const { id: alias } = env; return String(alias); }",
          "import type { HqEnvironmentId as StopId } from '@t3tools/contracts'; export function address(id: StopId) { return String(id); }",
        ].map((expression) => ({
          filename: owner,
          source: `import { HqEnvironmentId } from '@t3tools/contracts'; ${expression}`,
          kind: "environment-id-erasure",
        })),
        ...[
          "const { projectId: environmentId } = Route.useParams(); useVisibleProjectAccess([environmentId]);",
          "const paramsOf = Route.useParams; const params = paramsOf(); zerops.services(params.projectId);",
          "const params = Route.useParams(); const alias = params.projectId; useProjection(projectFlow, { orgId, projectId: alias });",
          "const { projectId } = Route.useParams(); const alias = String(projectId); zerops.services(alias);",
        ].map((expression) => ({
          filename: route,
          source: `const Route = createFileRoute("/_chat/group/$groupId/$projectId")({}); export function component() { ${expression} }`,
          kind: "raw-route-project-read",
        })),
        {
          filename: "apps/web/src/relocated.tsx",
          source:
            'const Route = createFileRoute("/_chat/group/$groupId/$projectId")({}); const { projectId: id } = Route.useParams(); zerops.services(id);',
          kind: "raw-route-project-read",
        },
        ...[
          "sql`UPDATE hq_deploy_job SET environment_id = project_id WHERE project_id IS NOT NULL AND environment_id IS DISTINCT FROM project_id`;",
          "sql`UPDATE hq_rollout r SET environment_id = CASE WHEN project_id IS NOT NULL THEN project_id ELSE environment_id END, left_out = ( SELECT coalesce(jsonb_agg(CASE WHEN entry->>'project_id' IS NOT NULL THEN entry || jsonb_build_object('environment_id', entry->'project_id') ELSE entry END ORDER BY ordinal), '[]'::jsonb) FROM jsonb_array_elements(r.left_out) WITH ORDINALITY AS entries(entry, ordinal) ) WHERE (project_id IS NOT NULL AND environment_id IS DISTINCT FROM project_id) OR EXISTS ( SELECT 1 FROM jsonb_array_elements(r.left_out) AS entries(entry) WHERE entry->>'project_id' IS NOT NULL AND entry->'environment_id' IS DISTINCT FROM entry->'project_id' )`;",
          "export function address(id: ProjectId) { return String(id); }",
          "export function address(id: EnvironmentId) { return id as string; }",
          "const LOCK_KEY = 1296254021; sql`SELECT pg_advisory_lock(${String(LOCK_KEY)})`;",
          "const id = ProjectId.make(rawProject); export const address = String(id);",
          "export function address(id: HqEnvironmentId) { function inner(id: ProjectId) { return String(id); } return inner(project); }",
          "const { projectId: environmentId } = Route.useParams(); const id = HqEnvironmentId.make(environmentId); useProjection(environmentById, { id }); if (environment.target.kind === 'zerops') { useVisibleProjectAccess([environment.target.projectId]); }",
          "const { projectId } = project; zerops.services(projectId);",
          "sql`SELECT e.project_id, t.project_id FROM hq_environment e JOIN hq_deploy_token t USING (project_id)`;",
          "sql`SELECT project_id FROM hq_subdomain_intent WHERE project_id = ${projectId}`;",
          "sql`INSERT INTO hq_deploy_job (environment_id, project_id) VALUES (${environment.id}, ${environment.project_id}) RETURNING id`;",
          "sql`INSERT INTO hq_rollout (environment_id, project_id) SELECT id, project_id FROM hq_environment WHERE project_id = ${projectId}`;",
          "const left = { environment_id: environment.id, project_id: environment.project_id }; sql`UPDATE hq_rollout SET left_out = ${encodeLeftOut([left])}::jsonb WHERE id = ${id}`;",
        ].map((expression) => ({
          filename: owner,
          source: `import { ProjectId, HqEnvironmentId, EnvironmentId } from '@t3tools/contracts'; ${expression}`,
          kind: undefined,
        })),
      ];

      const results = yield* runOxlintFixtures("t3code/no-environment-as-project", cases);
      for (const [index, scenario] of cases.entries()) {
        const findings = results[index]!.filter(
          (diagnostic) => diagnostic.code === "t3code(no-environment-as-project)",
        ).map((diagnostic) => parseFindingMessage(diagnostic.message));
        if (scenario.kind === undefined) {
          expect(findings, `control ${index}: ${scenario.filename}`).toEqual([]);
        } else {
          expect(findings, `mutation ${index}: ${scenario.kind}`).not.toEqual([]);
          expect(findings.every((finding) => finding?.kind === scenario.kind)).toBe(true);
          expect(
            findings.every(
              (finding) => finding?.ruleName === "no-environment-as-project" && !finding.ledgered,
            ),
          ).toBe(true);
          expect(findings.every((finding) => (finding?.fingerprint.length ?? 0) > 0)).toBe(true);
        }
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);
