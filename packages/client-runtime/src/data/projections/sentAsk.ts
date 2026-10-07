import type { SentAsk } from "../operations/mateSendTurn.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/** The person's sent words come from the recorded intent, until exact source reflection.
 * An unresolved send keeps its receipt for recovery; restored drafts supply the visible words. */
export const sentAsk: Projection<string | null, SentAsk | undefined> = {
  name: "sentAsk",
  keyOf: (id) => id ?? "none",
  equals: sameValue,
  derive: (read, id) => {
    if (id === null) return undefined;
    const record = read.operation(id);
    if (
      record?.intent.kind !== "mate-send-turn" ||
      record.submission === "unsent" ||
      record.unresolved !== null ||
      (record.receipt !== null &&
        (record.receipt.acceptance.kind === "refused" || record.receipt.outcome.kind !== "pending"))
    )
      return undefined;
    const { messageId, threadId, text, at } = record.intent;
    return { messageId, threadId, text, at };
  },
};
