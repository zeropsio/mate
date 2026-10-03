import { describe, expect, it } from "vite-plus/test";

import {
  SLOT_MIN_SHOW_MS,
  slotDue,
  slotHolds,
  slotHoldsIn,
  slotOffer,
  slotResync,
  slotRunningPast,
  slotSettle,
  slotStart,
  type LiveSlot,
} from "./liveSlot.logic";

/** What the run says at a moment: what is live, and what its record holds. */
interface Moment {
  readonly at: number;
  readonly live: ReadonlyArray<string>;
  readonly record: ReadonlyArray<string>;
  readonly final?: boolean;
}

/**
 * Plays a run's moments through the slot, as `useLiveSlot` does — an offer at
 * each moment, a settle whenever the slot is due — and says, per key, when it
 * entered the slot and when it plopped into the history.
 */
function play(moments: ReadonlyArray<Moment>, until: number) {
  const shown = new Map<string, number>();
  const plopped = new Map<string, number>();
  const watch = (slot: LiveSlot, at: number, record: ReadonlyArray<string>) => {
    for (const entry of slot.entries) if (!shown.has(entry.key)) shown.set(entry.key, at);
    const holds = slotHolds(slot);
    for (const key of record) {
      if (!holds.has(key) && !plopped.has(key) && (shown.has(key) || holdsEver.has(key))) {
        plopped.set(key, at);
      }
    }
    for (const key of holds) holdsEver.add(key);
  };
  const holdsEver = new Set<string>();
  const [first, ...rest] = moments;
  let slot = slotStart(first!);
  let record = first!.record;
  watch(slot, first!.at, record);
  let next = 0;
  for (let at = first!.at; at <= until; at += 5) {
    const moment = rest[next];
    if (moment !== undefined && moment.at <= at) {
      next += 1;
      record = moment.record;
      slot = slotOffer(slot, { ...moment, at, final: moment.final ?? false });
    } else {
      const due = slotDue(slot);
      if (due !== null && at >= due) slot = slotSettle(slot, at);
    }
    watch(slot, at, record);
  }
  return { shown: Object.fromEntries(shown), plopped: Object.fromEntries(plopped), slot };
}

describe("the live slot's schedule", () => {
  it.each<{
    readonly name: string;
    readonly moments: ReadonlyArray<Moment>;
    readonly until: number;
    readonly shown: Record<string, number>;
    readonly plopped: Record<string, number>;
  }>([
    {
      name: "a quick read stands its minimum, then plops",
      moments: [
        { at: 0, live: ["read"], record: [] },
        { at: 300, live: [], record: ["read"] },
      ],
      until: 2000,
      shown: { read: 0 },
      plopped: { read: SLOT_MIN_SHOW_MS },
    },
    {
      name: "a long command plops as it ends",
      moments: [
        { at: 0, live: ["build"], record: [] },
        { at: 2000, live: [], record: ["build"] },
      ],
      until: 3000,
      shown: { build: 0 },
      plopped: { build: 2000 },
    },
    {
      // The board's burst: six reads start and end in half a second, then the
      // tests run. Coalesced, the reads ride along with the first one's plop
      // and the tests show 0.25 s after they started, never 4.7 s.
      name: "a burst rides along with the item that stands, and the next shows on its plop",
      moments: [
        { at: 0, live: ["r1"], record: [] },
        { at: 80, live: [], record: ["r1"] },
        { at: 100, live: ["r2"], record: ["r1"] },
        { at: 180, live: [], record: ["r1", "r2"] },
        { at: 200, live: ["r3"], record: ["r1", "r2"] },
        { at: 280, live: [], record: ["r1", "r2", "r3"] },
        { at: 550, live: ["tests"], record: ["r1", "r2", "r3"] },
        { at: 6550, live: [], record: ["r1", "r2", "r3", "tests"] },
      ],
      until: 8000,
      shown: { r1: 0, tests: SLOT_MIN_SHOW_MS },
      plopped: { r1: 800, r2: 800, r3: 800, tests: 6550 },
    },
    {
      name: "calls at once show together, each plopping on its own",
      moments: [
        { at: 0, live: ["a", "b"], record: [] },
        { at: 1000, live: ["b"], record: ["a"] },
        { at: 3000, live: [], record: ["a", "b"] },
      ],
      until: 4000,
      shown: { a: 0, b: 0 },
      plopped: { a: 1000, b: 3000 },
    },
    {
      // The answer rises in under the question, and the pair plops as one.
      name: "a question stands its minimum from its answer, and the answer plops with it",
      moments: [
        { at: 0, live: ["question:q"], record: ["question:q"] },
        { at: 5000, live: [], record: ["question:q", "person:a"] },
      ],
      until: 7000,
      shown: { "question:q": 0 },
      plopped: { "question:q": 5800, "person:a": 5800 },
    },
    {
      // L3b: a call whose completion never came goes stale as the newer batch
      // starts — it leaves the slot as an ended call does.
      name: "a call gone stale leaves the slot as it ended",
      moments: [
        { at: 0, live: ["tests"], record: [] },
        { at: 1500, live: ["read"], record: ["tests"] },
      ],
      until: 3000,
      shown: { tests: 0, read: 1500 },
      plopped: { tests: 1500 },
    },
    {
      // Codex sends nothing for a command until it returns; a note is placed
      // once its words are known.
      name: "what is first seen ended stands its minimum, and what came with it rides along",
      moments: [
        { at: 0, live: [], record: [] },
        { at: 1000, live: [], record: ["c1", "c2"] },
        { at: 1300, live: [], record: ["c1", "c2", "note"] },
      ],
      until: 3000,
      shown: { c1: 1000 },
      plopped: { c1: 1800, c2: 1800, note: 1800 },
    },
    {
      name: "the run's end puts everything into the history at once",
      moments: [
        { at: 0, live: ["read"], record: [] },
        { at: 100, live: [], record: ["read"] },
        { at: 200, live: [], record: ["read"], final: true },
      ],
      until: 1000,
      shown: { read: 0 },
      plopped: { read: 200 },
    },
  ])("$name", ({ moments, until, shown, plopped }) => {
    const played = play(moments, until);
    expect(played.shown).toEqual(shown);
    expect(played.plopped).toEqual(plopped);
  });

  it("holds nothing of what the record held when it was first drawn: a reload never plops", () => {
    const slot = slotStart({ at: 0, live: ["c3"], record: ["c1", "c2"] });
    expect([...slotHolds(slot)]).toEqual(["c3"]);
    expect(slotOffer(slot, { at: 10, live: ["c3"], record: ["c1", "c2"], final: false })).toBe(
      slot,
    );
  });

  // A running thread opened from a cached copy catches up as it resyncs:
  // what it brings is history at once, and only what is live stands.
  it.each([
    {
      name: "five record items catch up: none stands, none plops",
      before: { live: ["c1"], record: [] as string[] },
      after: { live: ["c6"], record: ["c1", "c2", "c3", "c4", "c5"] },
      entries: ["c6"],
    },
    {
      name: "what still runs stays where it stood",
      before: { live: ["c1"], record: [] as string[] },
      after: { live: ["c1"], record: ["c0"] },
      entries: ["c1"],
    },
    {
      name: "nothing live: the slot empties at once",
      before: { live: ["c1"], record: [] as string[] },
      after: { live: [] as string[], record: ["c1"] },
      entries: [] as string[],
    },
  ])("resyncs without a plop: $name", ({ before, after, entries }) => {
    const slot = slotStart({ at: 0, ...before });
    const synced = slotResync(slot, { at: 100, ...after });
    expect(synced.entries.map((entry) => entry.key)).toEqual(entries);
    expect(synced.entries.every((entry) => entry.endedAt === null)).toBe(true);
    expect(
      [...slotHoldsIn(synced, after.record)].filter((key) => after.record.includes(key)),
    ).toEqual(after.record.filter((key) => after.live.includes(key)));
    expect(slotDue(synced)).toBeNull();
    // Once synced, an unchanged offer changes nothing.
    expect(slotOffer(synced, { at: 200, ...after, final: false })).toBe(synced);
  });

  // "+N more running" counts what runs past the rows drawn, not past the
  // slot's first entries: an entry drawn in another line, or a question and
  // the answer under it, shift what is drawn (pass 35).
  it.each([
    { name: "four running: one more", rows: ["a", "b", "c", "d"], ended: [], more: 1 },
    { name: "three running: none more", rows: ["a", "b", "c"], ended: [], more: 0 },
    {
      name: "an ended entry past the three is no more running",
      rows: ["a", "b", "c", "d", "e"],
      ended: ["d"],
      more: 1,
    },
    {
      name: "a question and its answer are two rows of one entry",
      rows: ["q", "q", "b", "c"],
      ended: [],
      more: 1,
    },
  ])("counts what runs past the rows drawn: $name", ({ rows, ended, more }) => {
    const entries = new Map(
      rows.map((key) => [
        key,
        { key, shownAt: 0, endedAt: ended.includes(key) ? 10 : null, riders: [] },
      ]),
    );
    expect(slotRunningPast(rows.map((key) => ({ entry: entries.get(key)! })))).toBe(more);
  });

  it("leaves out of the history what arrived since the slot last heard, before it places it", () => {
    const slot = slotStart({ at: 0, live: [], record: ["c1"] });
    expect([...slotHoldsIn(slot, ["c1", "c2"])]).toEqual(["c2"]);
  });

  it("is never more than one minimum show time behind the Mate", () => {
    // Twenty quick reads back to back, 100 ms each, then a long command.
    const moments: Moment[] = [];
    const done: string[] = [];
    for (let read = 0; read < 20; read += 1) {
      moments.push({ at: read * 100, live: [`r${read}`], record: [...done] });
      done.push(`r${read}`);
      moments.push({ at: read * 100 + 90, live: [], record: [...done] });
    }
    moments.push({ at: 2000, live: ["build"], record: [...done] });
    const played = play(moments, 4000);
    expect(played.shown.build! - 2000).toBeLessThanOrEqual(SLOT_MIN_SHOW_MS);
  });
});
