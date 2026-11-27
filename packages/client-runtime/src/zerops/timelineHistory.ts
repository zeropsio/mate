/**
 * Which rows of a conversation's list are its history read in above it: the earlier turns a person
 * loads stand above where the conversation began when it was shown, and are placed where they
 * stand, never entering as rows arriving while the person watches.
 */

/** A row of the list, by its key and kind. */
export interface TimelineRowShape {
  readonly id: string;
  readonly kind: string;
}

/**
 * Where a conversation begins: its first message, whose key no read changes, else its first row
 * that is not a seam. A day's seam is no start, since it moves up with its day's earlier turns once
 * they are read in, and nor is a card's row, whose key follows its run's first item.
 */
export function conversationBegins(rows: ReadonlyArray<TimelineRowShape>): string | null {
  return (
    rows.find((row) => row.kind === "message")?.id ??
    rows.find((row) => row.kind !== "seam")?.id ??
    null
  );
}

/** The rows standing above where the conversation began (`conversationBegins`): its read-in history. */
export function historyAbove(
  rows: ReadonlyArray<TimelineRowShape>,
  began: string | null,
): ReadonlySet<string> {
  const at = began === null ? -1 : rows.findIndex((row) => row.id === began);
  return new Set(rows.slice(0, Math.max(0, at)).map((row) => row.id));
}
