import * as Schema from "effect/Schema";

/** One image content block a `zerops_*` result carried (e.g. a `zerops_browser` screenshot), already under the 256 KB base64 cap — `apps/server/src/spi/toolCall.ts`'s `readContentImages`. */
export const ZeropsActivityResultImage = Schema.Struct({
  mimeType: Schema.NonEmptyString,
  data: Schema.NonEmptyString,
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
});
export type ZeropsActivityResultImage = typeof ZeropsActivityResultImage.Type;

/** The one shared schema for the Zerops result copied into a projected activity. */
export const ZeropsActivityResult = Schema.Struct({
  toolName: Schema.NonEmptyString,
  resultText: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Literal(true)),
  /** Image content blocks the result carried. Independent of the `resultText` cap — see `SpiToolCall.result`. */
  images: Schema.optional(Schema.Array(ZeropsActivityResultImage)),
  /** `true` when at least one image content block was dropped for exceeding its own cap. */
  imagesDropped: Schema.optional(Schema.Literal(true)),
});
export type ZeropsActivityResult = typeof ZeropsActivityResult.Type;
