/**
 * What a request left in a Mate's composer is about, until the person sends it.
 *
 * A review's fix ("Ask Fia to update it") writes its request into the composer unsent, for the
 * person to read and send (`useAskMateToFix`). The send says which change it is about
 * (`MessageAbout`), so the Mate's row can say it works on that change. The composer keeps only
 * words, so the request's subject is kept here, by conversation, beside them: a send whose words
 * still hold the request's first line goes about it, and anything else the person sends there does
 * not. Kept in memory only: a reload leaves the request in the composer as words alone.
 */
import type { MessageAbout } from "@t3tools/contracts";

interface LeftAsk {
  /** The request's first line, as it was written into the composer. */
  readonly line: string;
  readonly about: MessageAbout;
}

const left = new Map<string, LeftAsk>();

const firstLine = (ask: string): string => ask.trim().split("\n")[0]?.trim() ?? "";

/** A request written into the conversation's composer (by its scoped key) about `about`. */
export function leaveAskAbout(threadKey: string, ask: string, about: MessageAbout): void {
  const line = firstLine(ask);
  if (line.length > 0) left.set(threadKey, { line, about });
}

/**
 * What the words the person sends from the conversation's composer are about: the request left
 * there, while they still hold its first line. Taken once it goes (`forgetAskAbout`).
 */
export function askAboutOf(threadKey: string, words: string): MessageAbout | undefined {
  const ask = left.get(threadKey);
  return ask !== undefined && words.includes(ask.line) ? ask.about : undefined;
}

/** The request left in the conversation's composer went, or its words did: it is about no more. */
export function forgetAskAbout(threadKey: string): void {
  left.delete(threadKey);
}
