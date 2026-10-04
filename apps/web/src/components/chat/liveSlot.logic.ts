/**
 * The live slot's schedule (pass 35, the owner: "when this thing is done, it
 * would animatedly plop to the history; items should have some minimal show
 * time before they plop"). The slot at the card's foot shows what the Mate is
 * doing this moment, each thing as the row it becomes; the history above
 * holds what happened. Pure: the caller offers what is live and what the
 * record holds, at a time, and draws what this says.
 *
 * - An item enters the slot when it goes live, unless an item that ended
 *   still stands there: then it waits, so the slot is never more than one
 *   minimum show time behind the Mate.
 * - An item leaves as it ends, once it has been shown `SLOT_MIN_SHOW_MS` —
 *   a question once its answer has stood that long under it — and plops into
 *   the history. The last one standing holds its place `SLOT_HOLD_MS` past
 *   its end for the next, which takes it in one change; only a longer quiet
 *   says "Thinking", and once said it stands its minimum too.
 * - Bursts coalesce: what starts and ends while an ended item stands never
 *   takes the slot; it joins the history in that item's plop. The board
 *   measured the lag at 0.7 s this way, against 4.7 s for a queue.
 * - What is first seen ended — a note placed, a Codex command, which says
 *   nothing until it returns — stands its own minimum, unless it rides.
 * - What the record holds when the slot is first drawn is history at once,
 *   and so is everything once the run is over (`final`).
 *
 * The timing reuses the now line's calm (`nowLineCalm.logic`): one clock,
 * `due` and `settle`, driven by `useLiveSlot`.
 */

/**
 * How long anything the slot says, once said, stands before something else
 * takes its place: an item, and "Thinking" too.
 */
export const SLOT_MIN_SHOW_MS = 1200;

/**
 * How long an item that ended, the last one standing, holds the slot past its
 * end for the next to take its place: a step, then the next a second later,
 * reads as one step after another, never step, "Thinking", step (run 9: the
 * slot changed 277 times in 25 minutes, its median state stood 1.0 s).
 */
export const SLOT_HOLD_MS = 1200;

/** How many items the slot draws at once; the rest are "+N more running". */
export const SLOT_MAX_ROWS = 3;

/** One item in the slot: since when it shows, when it ended, what rides along with it. */
export interface SlotEntry {
  readonly key: string;
  readonly shownAt: number;
  /** When it ended: null while it runs (a question while it waits). */
  readonly endedAt: number | null;
  /** Record items that started and ended while it stood: they plop with it. */
  readonly riders: ReadonlyArray<string>;
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
  /**
   * What arrived whole while "Thinking" had not stood its minimum: it takes
   * the slot once it has, the first standing, the rest riding with it.
   */
  readonly pending: ReadonlyArray<string>;
}

/** What the caller offers: what is live, what the record holds, and whether the run is over. */
export interface SlotOffer {
  readonly live: ReadonlyArray<string>;
  readonly record: ReadonlyArray<string>;
  readonly at: number;
  readonly final: boolean;
}

/** A question stands its minimum from its answer, so the pair is read together. */
function standsAfterItsEnd(key: string): boolean {
  return key.startsWith("question:");
}

/** Whether a live item waits to enter: it takes the place of what ended as soon as that stood. */
function waits(slot: Pick<LiveSlot, "entries" | "live">): boolean {
  const shown = new Set(slot.entries.map((entry) => entry.key));
  return slot.live.some((key) => !shown.has(key));
}

/**
 * When an ended entry may plop: once it stood its minimum and ended — and,
 * the last one standing with nothing waiting, once it held its place
 * `SLOT_HOLD_MS` past its end for the next.
 */
function plopsAt(slot: Pick<LiveSlot, "entries" | "live">, entry: SlotEntry): number | null {
  if (entry.endedAt === null) return null;
  const from = standsAfterItsEnd(entry.key)
    ? Math.max(entry.shownAt, entry.endedAt)
    : entry.shownAt;
  const shown = Math.max(entry.endedAt, from + SLOT_MIN_SHOW_MS);
  const last = slot.entries.every((other) => other === entry || other.endedAt !== null);
  return last && !waits(slot) ? Math.max(shown, entry.endedAt + SLOT_HOLD_MS) : shown;
}

/**
 * Live items that wait enter once no ended item stands in the slot, and once
 * the "Thinking" it says, empty, has stood its minimum (`quietSince`).
 */
function admit(
  entries: ReadonlyArray<SlotEntry>,
  live: ReadonlyArray<string>,
  at: number,
  quietSince: number | null,
) {
  if (entries.some((entry) => entry.endedAt !== null)) return entries;
  if (entries.length === 0 && quietSince !== null && at < quietSince + SLOT_MIN_SHOW_MS) {
    return entries;
  }
  const shown = new Set(entries.map((entry) => entry.key));
  const entering = live.filter((key) => !shown.has(key));
  if (entering.length === 0) return entries;
  return [
    ...entries,
    ...entering.map((key): SlotEntry => ({ key, shownAt: at, endedAt: null, riders: [] })),
  ];
}

/** Since when the slot says "Thinking": kept while it is empty, null once an item stands. */
function quietAfter(
  entries: ReadonlyArray<SlotEntry>,
  quietSince: number | null,
  at: number,
): number | null {
  return entries.length > 0 ? null : (quietSince ?? at);
}

/** The slot as first drawn: what the record holds is history, what is live shows at once. */
export function slotStart(offer: Omit<SlotOffer, "final">): LiveSlot {
  const entries = admit([], offer.live, offer.at, null);
  return {
    entries,
    live: offer.live,
    seen: new Set(offer.record),
    quietSince: quietAfter(entries, null, offer.at),
    pending: [],
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
  const entries = admit(
    kept.map((entry) => (entry.riders.length === 0 ? entry : { ...entry, riders: [] })),
    offer.live,
    offer.at,
    null,
  );
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
        quietSince: quietAfter(entries, null, offer.at),
        pending: [],
      };
}

/** Plops what has ended and stood its minimum, and lets in what waited. */
export function slotSettle(slot: LiveSlot, at: number): LiveSlot {
  // What arrived whole during a young "Thinking" takes the slot once it stood.
  if (
    slot.pending.length > 0 &&
    slot.entries.length === 0 &&
    (slot.quietSince === null || at >= slot.quietSince + SLOT_MIN_SHOW_MS)
  ) {
    const [first, ...along] = slot.pending;
    return {
      ...slot,
      entries: [{ key: first!, shownAt: at, endedAt: at, riders: along }],
      quietSince: null,
      pending: [],
    };
  }
  const plopping = slot.entries.filter((entry) => {
    const due = plopsAt(slot, entry);
    return due !== null && at >= due;
  });
  if (plopping.length === 0) {
    const entries = admit(slot.entries, slot.live, at, slot.quietSince);
    const quietSince = quietAfter(entries, slot.quietSince, at);
    return entries === slot.entries && quietSince === slot.quietSince
      ? slot
      : { ...slot, entries, quietSince };
  }
  const left = slot.entries.filter((entry) => !plopping.includes(entry));
  // What plops makes way for what waited at once: one change, never a "Thinking" between.
  const entries = admit(left, slot.live, at, null);
  return { ...slot, entries, quietSince: quietAfter(entries, null, at) };
}

/**
 * What is live and what the record holds, at `at`: an item no longer live
 * ended; a record item that was never shown rides with the ended item that
 * stands, else is history at once; then what is due plops. An offer that
 * changes nothing returns the slot it was given.
 */
export function slotOffer(slot: LiveSlot, offer: SlotOffer): LiveSlot {
  if (offer.final) {
    if (slot.entries.length === 0 && slot.live.length === 0) return slot;
    return {
      entries: [],
      live: [],
      seen: new Set([...slot.seen, ...offer.record]),
      quietSince: null,
      pending: [],
    };
  }
  const live = new Set(offer.live);
  let pending = slot.pending;
  let entries = slot.entries.map((entry) =>
    entry.endedAt === null && !live.has(entry.key) ? { ...entry, endedAt: offer.at } : entry,
  );
  const fresh = offer.record.filter((key) => !slot.seen.has(key));
  if (fresh.length > 0) {
    const inSlot = new Set(entries.map((entry) => entry.key));
    const unseen = fresh.filter((key) => !inSlot.has(key) && !live.has(key));
    // Never seen live — a note placed, a call that said nothing until it
    // returned: it rides with the ended item that stands, else it stands
    // its own minimum in the slot and what arrived with it rides along.
    const host = entries.findLast((entry) => entry.endedAt !== null);
    const young =
      entries.length === 0 &&
      slot.quietSince !== null &&
      offer.at < slot.quietSince + SLOT_MIN_SHOW_MS;
    if (unseen.length > 0 && (young || slot.pending.length > 0) && entries.length === 0) {
      pending = [...slot.pending, ...unseen];
    } else if (host !== undefined && unseen.length > 0) {
      entries = entries.map((entry) =>
        entry === host ? { ...entry, riders: [...entry.riders, ...unseen] } : entry,
      );
    } else if (unseen.length > 0) {
      const [first, ...along] = unseen;
      entries = [...entries, { key: first!, shownAt: offer.at, endedAt: offer.at, riders: along }];
    }
  }
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
  // An item waits while "Thinking" stands its minimum.
  if (
    slot.entries.length === 0 &&
    slot.quietSince !== null &&
    (waits(slot) || slot.pending.length > 0)
  ) {
    const at = slot.quietSince + SLOT_MIN_SHOW_MS;
    if (due === null || at < due) due = at;
  }
  return due;
}

/**
 * The record keys the history does not draw yet: the slot's own, what rides
 * with them, and what is live — a question waits in the record and the slot.
 */
export function slotHolds(slot: LiveSlot): ReadonlySet<string> {
  return new Set([
    ...slot.entries.flatMap((entry) => [entry.key, ...entry.riders]),
    ...slot.live,
    ...slot.pending,
  ]);
}

/**
 * What the history leaves out as the record holds `record`: what the slot
 * holds, and what arrived since the slot last heard — a new item is the
 * slot's to place (it rides along, or stands its minimum) before it is
 * history, so it never shows there first for a frame.
 */
export function slotHoldsIn(slot: LiveSlot, record: ReadonlyArray<string>): ReadonlySet<string> {
  const holds = new Set(slotHolds(slot));
  for (const key of record) if (!slot.seen.has(key)) holds.add(key);
  return holds;
}

/**
 * What the slot's clock counts: what its first line shows — a call since it
 * started, stopped where it ended while it holds its place, "Thinking" since
 * the quiet began — so a row lands with its own time in the clock's column
 * (Bodhi: a step beside "1:57", the run's clock, settled as 1m 11s). A thing
 * first seen whole has no time of its own: null.
 */
export function slotClock(
  slot: LiveSlot,
  first: { readonly key: string; readonly at: string } | null,
): { readonly from: string; readonly stopped: string | null } | null {
  if (first === null) {
    return slot.quietSince === null
      ? null
      : { from: new Date(slot.quietSince).toISOString(), stopped: null };
  }
  const entry = slot.entries.find((candidate) => candidate.key === first.key);
  if (entry === undefined) return null;
  if (entry.endedAt === null) return { from: first.at, stopped: null };
  if (entry.endedAt <= entry.shownAt) return null;
  return { from: first.at, stopped: new Date(entry.endedAt).toISOString() };
}
