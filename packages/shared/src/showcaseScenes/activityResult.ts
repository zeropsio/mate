import * as Schema from "effect/Schema";

/** The one shared schema for the Zerops result copied into a projected activity. */
export const ZeropsActivityResult = Schema.Struct({
  toolName: Schema.NonEmptyString,
  resultText: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Literal(true)),
});
export type ZeropsActivityResult = typeof ZeropsActivityResult.Type;
