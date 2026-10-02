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
 *   the history.
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

/** How long an item, once shown in the slot, stands before it plops into the history. */
export const SLOT_MIN_SHOW_MS = 800;

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

/** When an ended entry may plop. */
function plopsAt(entry: SlotEntry): number | null {
  if (entry.endedAt === null) return null;
  const from = standsAfterItsEnd(entry.key)
    ? Math.max(entry.shownAt, entry.endedAt)
    : entry.shownAt;
  return Math.max(entry.endedAt, from + SLOT_MIN_SHOW_MS);
}

/** Live items that wait enter once no ended item stands in the slot. */
function admit(entries: ReadonlyArray<SlotEntry>, live: ReadonlyArray<string>, at: number) {
  if (entries.some((entry) => entry.endedAt !== null)) return entries;
  const shown = new Set(entries.map((entry) => entry.key));
  const entering = live.filter((key) => !shown.has(key));
  if (entering.length === 0) return entries;
  return [
    ...entries,
    ...entering.map((key): SlotEntry => ({ key, shownAt: at, endedAt: null, riders: [] })),
  ];
}

/** The slot as first drawn: what the record holds is history, what is live shows at once. */
export function slotStart(offer: Omit<SlotOffer, "final">): LiveSlot {
  return {
    entries: admit([], offer.live, offer.at),
    live: offer.live,
    seen: new Set(offer.record),
  };
}

/** Plops what has ended and stood its minimum, and lets in what waited. */
export function slotSettle(slot: LiveSlot, at: number): LiveSlot {
  const plopping = slot.entries.filter((entry) => {
    const due = plopsAt(entry);
    return due !== null && at >= due;
  });
  if (plopping.length === 0) {
    const entries = admit(slot.entries, slot.live, at);
    return entries === slot.entries ? slot : { ...slot, entries };
  }
  const left = slot.entries.filter((entry) => !plopping.includes(entry));
  return { ...slot, entries: admit(left, slot.live, at) };
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
    return { entries: [], live: [], seen: new Set([...slot.seen, ...offer.record]) };
  }
  const live = new Set(offer.live);
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
    if (host !== undefined && unseen.length > 0) {
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
    fresh.length > 0 || !sameLive || entries.some((entry, index) => entry !== slot.entries[index]);
  if (!changed) return slotSettle(slot, offer.at);
  return slotSettle(
    {
      entries,
      live: offer.live,
      seen: fresh.length === 0 ? slot.seen : new Set([...slot.seen, ...fresh]),
    },
    offer.at,
  );
}

/** When the slot next changes on its own — an ended item's plop — or null. */
export function slotDue(slot: LiveSlot): number | null {
  let due: number | null = null;
  for (const entry of slot.entries) {
    const at = plopsAt(entry);
    if (at !== null && (due === null || at < due)) due = at;
  }
  return due;
}

/**
 * The record keys the history does not draw yet: the slot's own, what rides
 * with them, and what is live — a question waits in the record and the slot.
 */
export function slotHolds(slot: LiveSlot): ReadonlySet<string> {
  return new Set([...slot.entries.flatMap((entry) => [entry.key, ...entry.riders]), ...slot.live]);
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
