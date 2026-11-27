/** A change held for the conversation's application. Numbers belong to repositories. */
export interface NumberedChange {
  readonly repo: string;
  readonly number: number;
}

/** Index only numbers that identify one repository; null means more than one carries it. */
export function indexChangeNumbers(
  ...lists: ReadonlyArray<ReadonlyArray<NumberedChange> | undefined>
): ReadonlyMap<string, NumberedChange | null> {
  const indexed = new Map<string, NumberedChange | null>();
  for (const changes of lists) {
    if (changes === undefined) continue;
    for (const change of changes) {
      const number = String(change.number);
      const previous = indexed.get(number);
      if (previous === undefined) indexed.set(number, change);
      else if (previous !== null && previous.repo !== change.repo) indexed.set(number, null);
    }
  }
  return indexed;
}

export interface ChangeNumberPart {
  readonly text: string;
  readonly change?: NumberedChange;
}

// Do not take a suffix from a longer word, identifier, or number.
const CHANGE_NUMBER = /(^|[^\p{L}\p{N}_#])#([1-9][0-9]*)(?![\p{L}\p{N}_])/gu;

/** The known, unambiguous change numbers in prose; all other words stay as written. */
export function resolveChangeNumbers(
  text: string,
  changes: ReadonlyMap<string, NumberedChange | null>,
): ReadonlyArray<ChangeNumberPart> {
  const parts: ChangeNumberPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CHANGE_NUMBER)) {
    const change = changes.get(match[2] ?? "");
    if (change == null) continue;
    const start = match.index + (match[1]?.length ?? 0);
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    const end = match.index + match[0].length;
    parts.push({ text: text.slice(start, end), change });
    cursor = end;
  }
  if (cursor < text.length || parts.length === 0) parts.push({ text: text.slice(cursor) });
  return parts;
}
