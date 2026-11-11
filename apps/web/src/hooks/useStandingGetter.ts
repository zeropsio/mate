import { useRef } from "react";

/**
 * A getter over the items listed that keeps its identity while it answers the same for each of
 * them. A memoised list handed a getter is drawn again whenever the getter is rebuilt, and a
 * getter built off shared state is rebuilt for every change of that state, whoever it concerns;
 * handed this one, the list is drawn again when an answer it would read has changed.
 *
 * The answers are read here, whenever the caller's getter or list is another one, so the list
 * reads them as of that render; an item not listed is answered by the latest getter itself. The
 * getter must be a new function whenever what it would answer may have changed.
 */
export function useStandingGetter<Item, Answer>(
  get: (item: Item) => Answer,
  listed: ReadonlyArray<Item>,
  keyOf: (item: Item) => string,
  same: (previous: Answer, next: Answer) => boolean = Object.is,
): (item: Item) => Answer {
  const held = useRef<{
    answers: ReadonlyMap<string, Answer>;
    latest: (item: Item) => Answer;
    listed: ReadonlyArray<Item>;
    readonly standing: (item: Item) => Answer;
  } | null>(null);
  const before = held.current;
  // The same getter over the same list answers the same: nothing is read again.
  if (before !== null && before.latest === get && before.listed === listed) return before.standing;
  const answers = new Map<string, Answer>();
  let stands = before !== null;
  for (const item of listed) {
    const key = keyOf(item);
    const next = get(item);
    if (before !== null && before.answers.has(key)) {
      const previous = before.answers.get(key) as Answer;
      if (same(previous, next)) {
        answers.set(key, previous);
        continue;
      }
    }
    answers.set(key, next);
    stands = false;
  }
  if (before !== null && stands && before.answers.size === answers.size) {
    before.latest = get;
    before.listed = listed;
    return before.standing;
  }
  const box: NonNullable<typeof held.current> = {
    answers,
    latest: get,
    listed,
    standing: (item) => {
      const key = keyOf(item);
      return box.answers.has(key) ? (box.answers.get(key) as Answer) : box.latest(item);
    },
  };
  held.current = box;
  return box.standing;
}
