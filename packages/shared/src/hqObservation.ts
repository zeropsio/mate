/** Read-only facts a Mate asks HQ for, scoped to its application's environments. */
import * as Schema from "effect/Schema";

export const ObservedEnvironment = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
  tier: Schema.Literals(["stage", "production"]),
});
export type ObservedEnvironment = typeof ObservedEnvironment.Type;
export const ActiveVersion = Schema.Struct({ id: Schema.String, name: Schema.String });
export const EnvironmentStatus = Schema.Struct({
  environment: ObservedEnvironment,
  services: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.String,
      activeVersion: Schema.NullOr(ActiveVersion),
    }),
  ),
});
export type EnvironmentStatus = typeof EnvironmentStatus.Type;
