/** HQ's structured finding and the refusal body that carries it, unchanged through their transports. */
import * as Effect from "effect/Effect";
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

/** A refusal's added field, absent where HQ sent something else there: the refusal still stands. */
const added = <S extends Schema.Top>(field: S) =>
  Schema.optionalKey(field.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

/**
 * The body of a request HQ refused (`4xx`/`5xx`): `{code}` or `{code,reason}`, with what some
 * refusals add (mate-hq spec/protocol.md). A body without a `code` is no refusal of HQ's.
 */
export const HqRefusal = Schema.Struct({
  code: Schema.String,
  reason: added(Schema.String),
  /** Where a hand-over stopped (`handover_unfinished`). */
  phase: added(Schema.String),
  /** A counterpart's own words (`git_probe_refused`, GitHub's refusal behind `github_unavailable`). */
  message: added(Schema.String),
  problems: added(Schema.Array(HqProblem)),
  /** A merge's file limit in bytes and the largest file above it (`too_large`). */
  limit: added(Schema.Number),
  size: added(Schema.Number),
});
export type HqRefusal = typeof HqRefusal.Type;

/** The verdict belongs to one exact group head; absent on older HQs. */
export const HqRecipeValidation = Schema.Struct({
  head: Schema.String,
  state: Schema.Literals(["valid", "invalid", "unavailable"]),
  schemaUrl: Schema.optionalKey(Schema.String),
  schemaDigest: Schema.optionalKey(Schema.String),
  problems: Schema.Array(HqProblem),
});
export type HqRecipeValidation = typeof HqRecipeValidation.Type;
