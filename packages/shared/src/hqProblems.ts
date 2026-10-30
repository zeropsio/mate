/** HQ's structured finding, carried unchanged through its existing transports. */
import * as Schema from "effect/Schema";

export const HqProblem = Schema.Struct({
  code: Schema.String,
  what: Schema.String,
  where: Schema.Struct({
    appId: Schema.String,
    projectId: Schema.optionalKey(Schema.String),
    environment: Schema.optionalKey(Schema.String),
    service: Schema.optionalKey(Schema.String),
    tier: Schema.optionalKey(Schema.String),
    file: Schema.optionalKey(Schema.String),
    repo: Schema.optionalKey(Schema.String),
    change: Schema.optionalKey(Schema.Number),
    head: Schema.optionalKey(Schema.String),
    releaseTag: Schema.optionalKey(Schema.String),
    operationId: Schema.optionalKey(Schema.String),
  }),
  rule: Schema.Struct({
    source: Schema.Literals(["zerops-schema", "zerops-api", "hq", "zcp"]),
    code: Schema.optionalKey(Schema.String),
    schemaUrl: Schema.optionalKey(Schema.String),
    schemaDigest: Schema.optionalKey(Schema.String),
    schemaPath: Schema.optionalKey(Schema.String),
    instancePath: Schema.optionalKey(Schema.String),
  }),
  next: Schema.Struct({
    actor: Schema.String,
    action: Schema.String,
    target: Schema.optionalKey(Schema.String),
  }),
  evidence: Schema.optionalKey(
    Schema.Struct({
      processId: Schema.optionalKey(Schema.String),
      appVersionId: Schema.optionalKey(Schema.String),
      logUrl: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type HqProblem = typeof HqProblem.Type;

/** The verdict belongs to one exact group head; absent on older HQs. */
export const HqRecipeValidation = Schema.Struct({
  head: Schema.String,
  state: Schema.Literals(["valid", "invalid", "unavailable"]),
  schemaUrl: Schema.optionalKey(Schema.String),
  schemaDigest: Schema.optionalKey(Schema.String),
  problems: Schema.Array(HqProblem),
});
export type HqRecipeValidation = typeof HqRecipeValidation.Type;
