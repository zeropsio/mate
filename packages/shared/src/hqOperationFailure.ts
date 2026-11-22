import * as Schema from "effect/Schema";

/**
 * Zerops' answer to a call it refused, as HQ keeps it on the failure (`mate-hq spec/protocol.md`,
 * "Operation failures"): `words` is Zerops' own sentence for people, or null. `status`, `error` and
 * `request` are printed for people and support, never branched on, so any shape decodes: a Zerops
 * body in another shape must not cost a person their menu.
 */
export const HqZeropsAnswer = Schema.Struct({
  words: Schema.NullOr(Schema.String),
  status: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
  request: Schema.optionalKey(Schema.Unknown),
});
export type HqZeropsAnswer = typeof HqZeropsAnswer.Type;

/**
 * An operation's failure as HQ sends it (`mate-hq spec/protocol.md`, "Operation failures"): the
 * step that stopped, its code, when HQ recorded it, and who stopped it (`origin`: `zerops`,
 * `zerops_process` or `hq`). `zerops` is Zerops' answer, present exactly when Zerops refused. The
 * origin is read as a string: one this build does not know never takes a row away.
 */
export const HqOperationFailure = Schema.Struct({
  step: Schema.String,
  code: Schema.String,
  at: Schema.String,
  origin: Schema.String,
  zerops: Schema.optionalKey(HqZeropsAnswer),
});
export type HqOperationFailure = typeof HqOperationFailure.Type;
