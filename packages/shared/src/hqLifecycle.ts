/** Original lifecycle requests retained by their accepting HQ and visible only to their person. */
import * as Schema from "effect/Schema";

const Target = {
  orgId: Schema.String,
  hqProjectId: Schema.optionalKey(Schema.String),
  projectId: Schema.String,
};
const Placement = Schema.Struct({
  appId: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["mate", "devstage", "stage", "production"]),
});
export const HqLifecycleIntent = Schema.Struct({
  kind: Schema.Literal("move-project"),
  ...Target,
  from: Placement,
  to: Placement,
  rename: Schema.Struct({ from: Schema.String, name: Schema.String }),
});
export type HqLifecycleIntent = typeof HqLifecycleIntent.Type;
export const HqLifecycleRecord = Schema.Struct({
  requestId: Schema.String,
  intent: HqLifecycleIntent,
  /** When HQ received the request; a deleted Mate's name is kept by no one, so this tells its deletions apart. */
  at: Schema.String,
});
export type HqLifecycleRecord = typeof HqLifecycleRecord.Type;
