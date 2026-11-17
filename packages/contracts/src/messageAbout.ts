/**
 * What a person's message is about, where a page wrote it for something it shows: a change, by
 * its repository and number, at the head the page showed when the person pressed. It rides the
 * message from the composer to the engine, which keeps it on the person's item, and the
 * conversation's row names it as `workingOn` while that message's run has not ended — so the page
 * says its Mate is at it, on every device, until the run ends or the change moves on.
 *
 * @module messageAbout
 */
import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** A change of the Mate's application, as a review's fix asks its Mate about it. */
export const MessageAbout = Schema.Struct({
  kind: Schema.Literal("change"),
  /** The change's repository, by HQ's name of it. */
  repo: TrimmedNonEmptyString,
  number: PositiveInt,
  /** The change's head as the page showed it; absent where HQ had not said it. */
  head: Schema.optionalKey(TrimmedNonEmptyString),
});
export type MessageAbout = typeof MessageAbout.Type;
