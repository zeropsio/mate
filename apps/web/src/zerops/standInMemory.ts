/**
 * Where a conversation's composer stand-in was left (`RouteStandIn`), so the next phase of one
 * reload — the route gate's stage, the chat layout's pending view, the conversation route's
 * opening view, each drawing its own — picks it up as it stood: the caret where the person left
 * it, and focus if it had it the moment the last one went. Only a hand-over within a moment
 * counts; a stand-in drawn later (another restart, another visit) starts unfocused.
 */

/** How long after one stand-in goes the next still takes its focus. */
export const STAND_IN_HAND_OVER_MS = 1_000;

export interface StandInState {
  readonly caret: number;
  readonly focused: boolean;
  /** When the last stand-in for it went, wall ms; null while one stands. */
  readonly leftAtMs: number | null;
}

export type StandInMemory = ReadonlyMap<string, StandInState>;

const EMPTY: StandInState = { caret: 0, focused: false, leftAtMs: null };

export function withStandIn(
  memory: StandInMemory,
  key: string,
  patch: Partial<StandInState>,
): StandInMemory {
  const next = new Map(memory);
  next.set(key, { ...(memory.get(key) ?? EMPTY), ...patch });
  return next;
}

/** What a stand-in drawn now for `key` takes over: its caret, and focus only from a hand-over. */
export function standInToRestore(
  memory: StandInMemory,
  key: string,
  nowMs: number,
): { readonly caret: number | null; readonly focus: boolean } {
  const held = memory.get(key);
  if (held === undefined) return { caret: null, focus: false };
  const handedOver =
    held.focused && held.leftAtMs !== null && nowMs - held.leftAtMs <= STAND_IN_HAND_OVER_MS;
  return { caret: held.caret, focus: handedOver };
}
