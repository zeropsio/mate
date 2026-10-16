/** Read-only facts a Mate asks HQ for, scoped to its application's environments. */
import * as Schema from "effect/Schema";

export const ObservedEnvironment = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
  tier: Schema.Literals(["stage", "production"]),
});
export type ObservedEnvironment = typeof ObservedEnvironment.Type;
/** A service's running version as Zerops' `GET /app-version/{id}` reads it: it carries no name. */
export const ActiveVersion = Schema.Struct({
  id: Schema.String,
  activatedAt: Schema.NullOr(Schema.String),
});
export type ActiveVersion = typeof ActiveVersion.Type;
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

export const ObservationLogEntry = Schema.Struct({
  timestamp: Schema.String,
  severity: Schema.String,
  message: Schema.String,
});
export type ObservationLogEntry = typeof ObservationLogEntry.Type;
export const EnvironmentLogs = Schema.Struct({
  projectId: Schema.String,
  serviceId: Schema.String,
  entries: Schema.Array(ObservationLogEntry),
});
export type EnvironmentLogs = typeof EnvironmentLogs.Type;
