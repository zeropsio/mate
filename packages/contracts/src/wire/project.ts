/** Plain zcp project calls, authenticated by Authorization: Project <key>. */
import * as Schema from "effect/Schema";
import { RepositoryName } from "./apps.ts";

export const ProjectIdentity = Schema.Struct({
  orgId: Schema.String,
  projectId: Schema.String,
  appId: Schema.String,
});
export type ProjectIdentity = typeof ProjectIdentity.Type;
export const CreateProjectRepo = Schema.Struct({
  name: RepositoryName,
  /** An optional assertion, never the source of the caller's project identity. */
  projectId: Schema.optionalKey(Schema.String),
});
export const ProjectRepository = Schema.Struct({ appId: Schema.String, name: RepositoryName });
export const ProjectRefusal = Schema.Struct({
  code: Schema.Literals([
    "project_key_required",
    "key_refused",
    "key_too_wide",
    "key_not_sensitive",
    "not_plain",
    "project_gone",
    "project_not_found",
    "zerops_refused",
    "zerops_unanswered",
  ]),
  reason: Schema.optionalKey(Schema.String),
});
