/**
 * What an engine call's record says besides its step, tool and words: the line it was given, what
 * its row shows, its Zerops result and the parts of it read on demand — what a V1 call's activity
 * payload carries, so a call reads the same on either engine.
 *
 * @module engineCall
 */
import * as Schema from "effect/Schema";

/** The longest input line a call's record keeps, in UTF-16 code units (V1's activity detail). */
export const CALL_INPUT_MAX = 180;

/**
 * A picture a Zerops result carried, as a reference to the Mate's asset store (rule 8: pictures
 * travel as references, never bytes): the asset as the store described it, and its size.
 */
export const CallResultPicture = Schema.Struct({
  mimeType: Schema.String,
  asset: Schema.Unknown,
  width: Schema.optionalKey(Schema.Number),
  height: Schema.optionalKey(Schema.Number),
});
export type CallResultPicture = typeof CallResultPicture.Type;

/**
 * A `zerops_*` call's result, as V1's activity carries it (`ZeropsActivityResult`): the tool's
 * name, its text verbatim — absent while it runs, or when it was over the server's limit
 * (`truncated`) — and its pictures by reference. The client decodes the text into its card.
 */
export const CallResult = Schema.Struct({
  toolName: Schema.String,
  resultText: Schema.optionalKey(Schema.String),
  truncated: Schema.optionalKey(Schema.Boolean),
  images: Schema.optionalKey(Schema.Array(CallResultPicture)),
  imagesDropped: Schema.optionalKey(Schema.Boolean),
});
export type CallResult = typeof CallResult.Type;

/**
 * A call's whole parts, read on demand by name (`engine.readDetail`): its output as the driver
 * streamed it (`detail`), its own record as the driver gave it (`data`), a result cut to the
 * wire's budget (`result`). A newer build's part decodes as its name.
 */
export const CALL_PARTS = ["detail", "data", "result"] as const;

export const callFields = {
  /** What the call was given, as one line: the command, the path, the query. */
  input: Schema.optionalKey(Schema.String),
  /**
   * What its row shows besides its line, in the terms every client's run card reads a call by
   * (V1's projected activity data): the tool's name, the command, the input's named fields, the
   * files it changed, the picture it looked at, whether it wrote, the first line of its output.
   * Bounded by the server; its open keys are for the card, never for a rule.
   */
  shows: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  /** A `zerops_*` call's result. */
  result: Schema.optionalKey(CallResult),
  /** The parts of it that can be read whole on demand. */
  parts: Schema.optionalKey(Schema.Array(Schema.String)),
} as const;
