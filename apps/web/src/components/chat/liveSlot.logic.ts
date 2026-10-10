/**
 * The live slot's schedule (pass 35, the owner: "when this thing is done, it
 * would animatedly plop to the history; items should have some minimal show
 * time before they plop"; run 11, 2026-10-05: "one plop and 5 messages" —
 * everything goes through the working row, one item at a time). The slot at
 * the card's foot shows what the Mate is doing this moment, each thing as the
 * row it becomes; the history above holds what happened. Pure: the caller
 * offers what is live and what the record holds, at a time, and draws what
 * this says.
 *
 * - An item enters the slot when it goes live, unless an item that ended
 *   still stands there: then it waits. Calls that run at once stand together.
 * - What is first seen ended — a note placed, a Codex command, which says
 *   nothing until it returns, a quick call that started and ended while
 *   another stood — waits its turn in the order it came, and enters alone:
 *   nothing reaches the history without standing in the slot first.
 * - An item leaves as it ends, once it has been shown `SLOT_MIN_SHOW_MS` —
 *   `SLOT_BUSY_SHOW_MS` while three or more wait behind it, `SLOT_RUSH_SHOW_MS`
 *   past eight, a question once
 *   the person's answer has stood that long under it, the pair as one — and
 *   plops into the history,
 *   one at a time: never two plops within `SLOT_BUSY_SHOW_MS`. Simulated on
 *   a real run's 669 items, the history trails the Mate by 2.4 s at most.
 * - The last one standing holds its place `SLOT_HOLD_MS` past its end for the
 *   next, which takes it in one change; only a longer quiet says "Thinking",
 *   and once said it stands its minimum against words — a call takes its
 *   place once it has stood the pace, so the call shows as it runs.
 * - What the record holds when the slot is first drawn is history at once,
 *   and so is everything once the run is over (`final`).
 *
 * The timing reuses the now line's calm (`nowLineCalm.logic`): one clock,
 * `due` and `settle`, driven by `useLiveSlot`.
 */

/**
 * How long anything the slot says, once said, stands before something else
 * takes its place: an item, and "Thinking" too — against words; a call takes
 * its place once it has stood `SLOT_BUSY_SHOW_MS`.
 */
export const SLOT_MIN_SHOW_MS = 800;

/**
 * How long an item stands while `SLOT_BUSY_WAITING` or more wait behind it,
 * and the least time between two plops: a burst passes as a quick sequence,
 * never as one plop.
 */
export const SLOT_BUSY_SHOW_MS = 250;

/** How many waiting items make the slot hurry. */
export const SLOT_BUSY_WAITING = 3;

/**
 * How long an item stands, and the least time between two plops, while
 * `SLOT_RUSH_WAITING` or more wait: a long burst of quick calls (twenty reads
 * in two seconds) passes as a ticker, and what follows it is seconds behind
 * at most.
 */
export const SLOT_RUSH_SHOW_MS = 125;

/** How many waiting items make the slot rush. */
export const SLOT_RUSH_WAITING = 8;

/**
 * How long an item that ended, the last one standing, holds the slot past its
 * end for the next to take its place: a step, then the next a second later,
 * reads as one step after another, never step, "Thinking", step (run 9: the
 * slot changed 277 times in 25 minutes, its median state stood 1.0 s).
 */
export const SLOT_HOLD_MS = 1200;

/** How many items the slot draws at once; the rest are "+N more running". */
export const SLOT_MAX_ROWS = 3;

/** One item in the slot: since when it shows, and when it ended. */
export interface SlotEntry {
  readonly key: string;
  readonly shownAt: number;
  /** When it ended: null while it runs (a question while it waits). */
  readonly endedAt: number | null;
  /** A question's: the person's answer, which rises in under it and plops with it as one. */
  readonly answer?: string;
}

export interface LiveSlot {
  /** The slot, by when each item entered it. */
  readonly entries: ReadonlyArray<SlotEntry>;
  /** What is live now, by start: an item waiting while an ended one stands enters once it plops. */
  readonly live: ReadonlyArray<string>;
  /** Every record key seen: one not among them arrived since. */
  readonly seen: ReadonlySet<string>;
  /**
   * Since when the slot, empty, says what the Mate does between things
   * ("Thinking"): it stands its minimum before an item takes its place.
   * Null while an item stands.
   */
  readonly quietSince: number | null;
  /** What arrived ended and has not stood yet, in the order it came: each enters on its own. */
  readonly pending: ReadonlyArray<string>;
  /** When the last item plopped: the next plops no sooner than `SLOT_BUSY_SHOW_MS` after it. */
  readonly lastPlopAt: number | null;
}

/** What the caller offers: what is live, what the record holds, and whether the run is over. */
export interface SlotOffer {
  readonly live: ReadonlyArray<string>;
  readonly record: ReadonlyArray<string>;
  readonly at: number;
  readonly final: boolean;
  /**
   * When the quiet began, from the data — the record's newest line, else
   * the run's start — for a slot drawn or caught up mid-quiet: its
   * "Thinking" never restarts with a reload or a resync.
   */
  readonly quietFrom?: number;
}

/** A question stands its minimum from its answer, so the pair is read together. */
function standsAfterItsEnd(key: string): boolean {
  return key.startsWith("question:");
}

type Queue = Pick<LiveSlot, "entries" | "live" | "pending">;

/** How many items wait to enter: live ones behind an ended item, and what arrived ended. */
function waiting(slot: Queue): number {
  const shown = new Set(slot.entries.map((entry) => entry.key));
  return slot.live.filter((key) => !shown.has(key)).length + slot.pending.length;
}

/** How long an item stands once shown: less while three or more wait behind it, less again past eight. */
function showFor(slot: Queue): number {
  const behind = waiting(slot);
  if (behind >= SLOT_RUSH_WAITING) return SLOT_RUSH_SHOW_MS;
  return behind >= SLOT_BUSY_WAITING ? SLOT_BUSY_SHOW_MS : SLOT_MIN_SHOW_MS;
}

/** The least time between two plops, so each lands on its own. */
function plopGap(slot: Queue): number {
  return Math.min(showFor(slot), SLOT_BUSY_SHOW_MS);
}

/**
 * When an ended entry may plop: once it stood its minimum and ended — and,
 * the last one standing with nothing waiting, once it held its place
 * `SLOT_HOLD_MS` past its end for the next. Never sooner than
 * `SLOT_BUSY_SHOW_MS` after the plop before it.
 */
function plopsAt(slot: Queue & Pick<LiveSlot, "lastPlopAt">, entry: SlotEntry): number | null {
  if (entry.endedAt === null) return null;
  const from = standsAfterItsEnd(entry.key)
    ? Math.max(entry.shownAt, entry.endedAt)
    : entry.shownAt;
  const shown = Math.max(entry.endedAt, from + showFor(slot));
  // The last one standing, nothing behind it, holds its place for the next.
  const last = slot.entries.length === 1 && waiting(slot) === 0;
  const due = last ? Math.max(shown, entry.endedAt + SLOT_HOLD_MS) : shown;
  return slot.lastPlopAt === null ? due : Math.max(due, slot.lastPlopAt + plopGap(slot));
}

/** A call of the Mate's — a step, an operation, a call — rather than its words or the person's. */
function isCall(key: string): boolean {
  return key.startsWith("step:") || key.startsWith("operation:") || key.startsWith("call:");
}

/**
 * How long "Thinking", once said, stands before what waits next takes its
 * place: the pace before a call — first seen ended, or live, what is live
 * beside it coming along — so a call shows as it runs (run 12: seven times a
 * short command waited out Thinking's minimum, ended meanwhile, and stood
 * finished between two "Thinking"s), yet never two changes within the pace
 * (review of pass 43: a call 10 ms after Thinking showed it for 10 ms); its
 * minimum before words, a thought or a question.
 */
function thinkingStandsFor(queue: Queue): number {
  const [next] = queue.pending;
  const shown = new Set(queue.entries.map((entry) => entry.key));
  const callNext =
    next !== undefined ? isCall(next) : queue.live.some((key) => !shown.has(key) && isCall(key));
  return callNext ? SLOT_BUSY_SHOW_MS : SLOT_MIN_SHOW_MS;
}

/**
 * What waits enters once no ended item stands in the slot, and once the
 * "Thinking" it says, empty, has stood its time (`thinkingStandsFor`): first
 * what arrived ended, one at a time, in the order it came; then what is live,
 * all of it at once.
 */
function admit(
  queue: Queue,
  at: number,
  quietSince: number | null,
): Pick<LiveSlot, "entries" | "pending"> {
  const { entries, pending } = queue;
  if (entries.some((entry) => entry.endedAt !== null)) return { entries, pending };
  if (entries.length === 0 && quietSince !== null && at < quietSince + thinkingStandsFor(queue)) {
    return { entries, pending };
  }
  const [next, ...rest] = pending;
  if (next !== undefined) {
    return { entries: [...entries, { key: next, shownAt: at, endedAt: at }], pending: rest };
  }
  const shown = new Set(entries.map((entry) => entry.key));
  const entering = queue.live.filter((key) => !shown.has(key));
  if (entering.length === 0) return { entries, pending };
  return {
    entries: [
      ...entries,
      ...entering.map((key): SlotEntry => ({ key, shownAt: at, endedAt: null })),
    ],
    pending,
  };
}

/** Since when the slot says "Thinking": kept while it is empty, null once an item stands. */
function quietAfter(
  entries: ReadonlyArray<SlotEntry>,
  quietSince: number | null,
  at: number,
): number | null {
  return entries.length > 0 ? null : (quietSince ?? at);
}

/** When the quiet began, as the data says: never after now. */
function quietStart(offer: Omit<SlotOffer, "final">): number | null {
  return offer.quietFrom === undefined || !Number.isFinite(offer.quietFrom)
    ? null
    : Math.min(offer.quietFrom, offer.at);
}

/** The slot as first drawn: what the record holds is history, what is live shows at once. */
export function slotStart(offer: Omit<SlotOffer, "final">): LiveSlot {
  const { entries } = admit({ entries: [], live: offer.live, pending: [] }, offer.at, null);
  return {
    entries,
    live: offer.live,
    seen: new Set(offer.record),
    quietSince: quietAfter(entries, quietStart(offer), offer.at),
    pending: [],
    lastPlopAt: null,
  };
}

/**
 * The slot as a resync leaves it: what the catch-up brought is history at
 * once — nobody watched it happen, so nothing stands or plops — and what is
 * live shows, what already stood staying where it stood.
 */
export function slotResync(slot: LiveSlot, offer: Omit<SlotOffer, "final">): LiveSlot {
  const live = new Set(offer.live);
  const kept = slot.entries.filter((entry) => entry.endedAt === null && live.has(entry.key));
  // Nobody watched the quiet either: what is live shows at once.
  const { entries } = admit({ entries: kept, live: offer.live, pending: [] }, offer.at, null);
  const seen = new Set([...slot.seen, ...offer.record]);
  const same =
    entries.length === slot.entries.length &&
    entries.every((entry, index) => entry === slot.entries[index]) &&
    offer.live.length === slot.live.length &&
    offer.live.every((key, index) => slot.live[index] === key) &&
    seen.size === slot.seen.size;
  return same && slot.pending.length === 0
    ? slot
    : {
        entries,
        live: offer.live,
        seen,
        quietSince: quietAfter(entries, quietStart(offer), offer.at),
        pending: [],
        lastPlopAt: slot.lastPlopAt,
      };
}

/** Plops the one item due first, and lets in what waited. */
export function slotSettle(slot: LiveSlot, at: number): LiveSlot {
  let plopping: SlotEntry | null = null;
  let plopsFirst = Infinity;
  for (const entry of slot.entries) {
    const due = plopsAt(slot, entry);
    if (due !== null && at >= due && due < plopsFirst) {
      plopping = entry;
      plopsFirst = due;
    }
  }
  if (plopping === null) {
    const admitted = admit(slot, at, slot.quietSince);
    const quietSince = quietAfter(admitted.entries, slot.quietSince, at);
    return admitted.entries === slot.entries && quietSince === slot.quietSince
      ? slot
      : { ...slot, ...admitted, quietSince };
  }
  const left = slot.entries.filter((entry) => entry !== plopping);
  // What plops makes way for what waited at once: one change, never a "Thinking" between.
  const admitted = admit({ ...slot, entries: left }, at, null);
  return {
    ...slot,
    ...admitted,
    quietSince: quietAfter(admitted.entries, null, at),
    lastPlopAt: at,
  };
}

/**
 * What is live and what the record holds, at `at`: an item no longer live
 * ended; a record item that was never shown waits its turn; then what is due
 * plops. An offer that changes nothing returns the slot it was given.
 */
export function slotOffer(slot: LiveSlot, offer: SlotOffer): LiveSlot {
  if (offer.final) {
    if (slot.entries.length === 0 && slot.live.length === 0 && slot.pending.length === 0) {
      return slot;
    }
    return {
      entries: [],
      live: [],
      seen: new Set([...slot.seen, ...offer.record]),
      quietSince: null,
      pending: [],
      lastPlopAt: null,
    };
  }
  const live = new Set(offer.live);
  const entries = slot.entries.map((entry) =>
    entry.endedAt === null && !live.has(entry.key) ? { ...entry, endedAt: offer.at } : entry,
  );
  const fresh = offer.record.filter((key) => !slot.seen.has(key));
  const inSlot = new Set(entries.map((entry) => entry.key));
  const waitingAlready = new Set(slot.pending);
  // Never shown live — a note placed, a call that said nothing until it
  // returned, one that started and ended while another stood: it waits its
  // turn. The person's answer to a question standing rises in under it.
  let unseen = fresh.filter(
    (key) => !inSlot.has(key) && !live.has(key) && !waitingAlready.has(key),
  );
  const asked = entries.findIndex(
    (entry) => standsAfterItsEnd(entry.key) && entry.answer === undefined,
  );
  const answer = asked === -1 ? undefined : unseen.find((key) => key.startsWith("person:"));
  if (answer !== undefined) {
    entries[asked] = { ...entries[asked]!, answer };
    unseen = unseen.filter((key) => key !== answer);
  }
  // A live item that ended before its turn in the slot came waits it out
  // too, after what waited before it (review of pass 42: drawn in the
  // history at once, above the notes still waiting to plop).
  // One the record held already, else it arrives as unseen.
  const endedWaiting = slot.live.filter(
    (key) => slot.seen.has(key) && !live.has(key) && !inSlot.has(key) && !waitingAlready.has(key),
  );
  const pending =
    unseen.length === 0 && endedWaiting.length === 0
      ? slot.pending
      : [...slot.pending, ...endedWaiting, ...unseen];
  const sameLive =
    offer.live.length === slot.live.length &&
    offer.live.every((key, index) => slot.live[index] === key);
  const changed =
    fresh.length > 0 ||
    !sameLive ||
    pending !== slot.pending ||
    entries.some((entry, index) => entry !== slot.entries[index]);
  if (!changed) return slotSettle(slot, offer.at);
  return slotSettle(
    {
      entries,
      live: offer.live,
      seen: fresh.length === 0 ? slot.seen : new Set([...slot.seen, ...fresh]),
      quietSince: entries.length > 0 ? null : slot.quietSince,
      pending,
      lastPlopAt: slot.lastPlopAt,
    },
    offer.at,
  );
}

/**
 * How many entries run past the rows the slot draws (`SLOT_MAX_ROWS`), as
 * "+N more running": `rows` are the rows it would draw, in order, each with
 * its entry — a question and the answer under it are two rows of one.
 */
export function slotRunningPast(rows: ReadonlyArray<{ readonly entry: SlotEntry }>): number {
  const drawn = new Set(rows.slice(0, SLOT_MAX_ROWS).map((row) => row.entry));
  const past = new Set(
    rows.map((row) => row.entry).filter((entry) => !drawn.has(entry) && entry.endedAt === null),
  );
  return past.size;
}

/** When the slot next changes on its own — an ended item's plop — or null. */
export function slotDue(slot: LiveSlot): number | null {
  let due: number | null = null;
  for (const entry of slot.entries) {
    const at = plopsAt(slot, entry);
    if (at !== null && (due === null || at < due)) due = at;
  }
  // An item waits while "Thinking" stands its time.
  if (slot.entries.length === 0 && slot.quietSince !== null && waiting(slot) > 0) {
    const at = slot.quietSince + thinkingStandsFor(slot);
    if (due === null || at < due) due = at;
  }
  return due;
}

/**
 * The record keys the history does not draw yet: the slot's own, what waits
 * its turn, and what is live — a question waits in the record and the slot.
 */
export function slotHolds(slot: LiveSlot): ReadonlySet<string> {
  return new Set([
    ...slot.entries.flatMap((entry) =>
      entry.answer === undefined ? [entry.key] : [entry.key, entry.answer],
    ),
    ...slot.live,
    ...slot.pending,
  ]);
}

/**
 * What the history leaves out as the record holds `record`: what the slot
 * holds, and what arrived since the slot last heard — a new item is the
 * slot's to place (it stands its minimum, in its turn) before it is
 * history, so it never shows there first for a frame.
 */
export function slotHoldsIn(slot: LiveSlot, record: ReadonlyArray<string>): ReadonlySet<string> {
  const holds = new Set(slotHolds(slot));
  for (const key of record) if (!slot.seen.has(key)) holds.add(key);
  return holds;
}
