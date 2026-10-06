/** PB's operation scope reads these records; Deploys.changes announces committed changes. */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { ProcessEvidence, type OperationSignal } from "./operationWatch.ts";

export const OperationEvidence = Schema.Struct({
  phase: Schema.String,
  processes: Schema.Array(ProcessEvidence),
  version: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      _version: Schema.optionalKey(Schema.Number),
    }),
  ),
  nextActor: Schema.Literals(["hq", "person", "none"]),
  nextAction: Schema.String,
});
export type OperationEvidence = typeof OperationEvidence.Type;
export const encodePhase = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({ phase: Schema.String, nextActor: Schema.String, nextAction: Schema.String }),
  ),
);
export const encodeEvidence = Schema.encodeSync(Schema.fromJsonString(OperationEvidence));
/** Persist one step per status change; revision-only pushes update evidence without growing history. */
export const stepOf = (signal: OperationSignal): OperationEvidence => ({
  ...evidenceOf(signal),
  processes: signal.processes.map((process) => ({
    id: process.id,
    status: process.status,
    ...(process.error === undefined ? {} : { error: process.error }),
  })),
  version:
    signal.version === null ? null : { id: signal.version.id, status: signal.version.status },
});
export const evidenceOf = (signal: OperationSignal): OperationEvidence => ({
  ...signal,
  nextActor: "hq",
  nextAction:
    signal.phase === "recovering"
      ? "Re-register with Zerops and read the original handles"
      : "Follow Zerops' terminal process status",
});
export interface OperationRecord {
  readonly id: string;
  readonly appId: string;
  readonly projectId: string;
  readonly executor: "hq";
  readonly kind: "deploy" | "delta";
  readonly state:
    | "queued"
    | "submitting"
    | "building"
    | "live"
    | "failed"
    | "refused"
    | "unresolved"
    | "skipped"
    | "superseded";
  readonly handle: string | null;
  readonly handles: ReadonlyArray<string>;
  readonly versionId: string | null;
  readonly verifiedVersionId: string | null;
  readonly evidence: OperationEvidence | null;
  readonly steps: ReadonlyArray<OperationEvidence>;
  readonly reason: string | null;
}
/** Application visibility is checked by PB before serving this scope. Never contains credentials. */
export const operationRecords = (
  sql: SqlClient.SqlClient,
  appId: string,
): Effect.Effect<ReadonlyArray<OperationRecord>, SqlError> => sql<OperationRecord>`
  SELECT j.id::text AS id, e.app_id::text AS "appId", j.project_id AS "projectId", 'hq' AS executor,
    j.kind, j.state, j.process_id AS handle, (CASE WHEN j.process_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[j.process_id] END || coalesce(j.processes, ARRAY[]::text[])) AS handles,
    j.app_version_id AS "versionId", j.verified_version_id AS "verifiedVersionId", coalesce(j.evidence, jsonb_build_object('phase', j.state, 'processes', '[]'::jsonb, 'version', null,
      'nextActor', CASE WHEN j.ended_at IS NULL THEN 'hq' ELSE 'none' END,
      'nextAction', CASE WHEN j.ended_at IS NULL THEN 'Submit once and follow the accepted handles' ELSE 'Operation ended' END)) AS evidence,
    j.steps, j.reason
  FROM hq_deploy_job j JOIN hq_environment e ON e.project_id = j.project_id
  WHERE e.app_id::text = ${appId} ORDER BY j.id`;
