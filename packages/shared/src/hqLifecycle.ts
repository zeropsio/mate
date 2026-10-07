/** Original lifecycle requests retained by their accepting HQ and visible only to their person. */
import * as Schema from "effect/Schema";

const Target = { orgId: Schema.String, hqProjectId: Schema.String, projectId: Schema.String };
const Placement = Schema.Struct({
  appId: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["mate", "devstage", "stage", "production"]),
});
export const HqLifecycleIntent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("move-project"),
    ...Target,
    from: Placement,
    to: Placement,
    rename: Schema.Struct({ from: Schema.String, name: Schema.String }),
  }),
  Schema.Struct({ kind: Schema.Literal("prepare-mate-deletion"), ...Target }),
  Schema.Struct({
    kind: Schema.Literal("complete-mate-deletion"),
    ...Target,
    preparedRequestId: Schema.String,
    completion: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("complete-key-retirement"),
    ...Target,
    preparedRequestId: Schema.String,
    completionRequestId: Schema.String,
  }),
]);
export type HqLifecycleIntent = typeof HqLifecycleIntent.Type;
export const HqLifecycleRecord = Schema.Struct({
  requestId: Schema.String,
  intent: HqLifecycleIntent,
  projectName: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(
    Schema.Struct({ keyTokenId: Schema.NullOr(Schema.String), completion: Schema.String }),
  ),
});
export type HqLifecycleRecord = typeof HqLifecycleRecord.Type;
