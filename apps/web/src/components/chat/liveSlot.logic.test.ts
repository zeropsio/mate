import { describe, expect, it } from "vite-plus/test";

import {
  SLOT_HOLD_MS,
  SLOT_MIN_SHOW_MS,
  slotClock,
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
      name: "a quick read with nothing after it stands its hold past its end, then plops",
      moments: [
        { at: 0, live: ["read"], record: [] },
        { at: 300, live: [], record: ["read"] },
      ],
      until: 3000,
      shown: { read: 0 },
      plopped: { read: 300 + SLOT_HOLD_MS },
    },
    {
      name: "a long command with nothing after it stands its hold past its end",
      moments: [
        { at: 0, live: ["build"], record: [] },
        { at: 2000, live: [], record: ["build"] },
      ],
      until: 5000,
      shown: { build: 0 },
      plopped: { build: 2000 + SLOT_HOLD_MS },
    },
    {
      // Run 9: the slot read step, Thinking, step, Thinking, every 1–4 s.
      name: "an item that ended holds the slot until the next takes its place: no Thinking between",
      moments: [
        { at: 0, live: ["a"], record: [] },
        { at: 300, live: [], record: ["a"] },
        { at: 1400, live: ["b"], record: ["a"] },
        { at: 5000, live: [], record: ["a", "b"] },
      ],
      until: 8000,
      shown: { a: 0, b: 1400 },
      plopped: { a: 1400, b: 5000 + SLOT_HOLD_MS },
    },
    {
      name: "the next waits for the one that ended to stand its minimum",
      moments: [
        { at: 0, live: ["a"], record: [] },
        { at: 100, live: [], record: ["a"] },
        { at: 400, live: ["b"], record: ["a"] },
        { at: 5000, live: [], record: ["a", "b"] },
      ],
      until: 8000,
      shown: { a: 0, b: SLOT_MIN_SHOW_MS },
      plopped: { a: SLOT_MIN_SHOW_MS, b: 5000 + SLOT_HOLD_MS },
    },
    {
      // "Thinking" said for a moment is a flicker: once said, it stands.
      name: "past its hold the slot says Thinking, which stands its minimum before the next enters",
      moments: [
        { at: 0, live: ["a"], record: [] },
        { at: 300, live: [], record: ["a"] },
        { at: 1600, live: ["b"], record: ["a"] },
        { at: 6000, live: [], record: ["a", "b"] },
      ],
      until: 9000,
      shown: { a: 0, b: 300 + SLOT_HOLD_MS + SLOT_MIN_SHOW_MS },
      plopped: { a: 300 + SLOT_HOLD_MS, b: 6000 + SLOT_HOLD_MS },
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
      until: 9000,
      shown: { r1: 0, tests: SLOT_MIN_SHOW_MS },
      plopped: {
        r1: SLOT_MIN_SHOW_MS,
        r2: SLOT_MIN_SHOW_MS,
        r3: SLOT_MIN_SHOW_MS,
        tests: 6550 + SLOT_HOLD_MS,
      },
    },
    {
      name: "calls at once show together, each plopping on its own",
      moments: [
        { at: 0, live: ["a", "b"], record: [] },
        { at: 1000, live: ["b"], record: ["a"] },
        { at: 3000, live: [], record: ["a", "b"] },
      ],
      until: 6000,
      shown: { a: 0, b: 0 },
      // One ending while another runs never empties the slot: no hold.
      plopped: { a: SLOT_MIN_SHOW_MS, b: 3000 + SLOT_HOLD_MS },
    },
    {
      // The answer rises in under the question, and the pair plops as one.
      name: "a question stands its minimum from its answer, and the answer plops with it",
      moments: [
        { at: 0, live: ["question:q"], record: ["question:q"] },
        { at: 5000, live: [], record: ["question:q", "person:a"] },
      ],
      until: 8000,
      shown: { "question:q": 0 },
      plopped: {
        "question:q": 5000 + SLOT_MIN_SHOW_MS,
        "person:a": 5000 + SLOT_MIN_SHOW_MS,
      },
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
      until: 4000,
      // "Thinking" from the first draw stands its minimum before c1 takes its place.
      shown: { c1: SLOT_MIN_SHOW_MS },
      plopped: {
        c1: SLOT_MIN_SHOW_MS + SLOT_HOLD_MS,
        c2: SLOT_MIN_SHOW_MS + SLOT_HOLD_MS,
        note: SLOT_MIN_SHOW_MS + SLOT_HOLD_MS,
      },
    },
    {
      // Run 9 on this build: a note placed 1 s into "Thinking" took its place at once.
      name: "what is first seen whole waits for Thinking to stand its minimum too",
      moments: [
        { at: 0, live: ["a"], record: [] },
        { at: 300, live: [], record: ["a"] },
        { at: 1700, live: [], record: ["a", "note"] },
      ],
      until: 6000,
      shown: { a: 0, note: 300 + SLOT_HOLD_MS + SLOT_MIN_SHOW_MS },
      plopped: {
        a: 300 + SLOT_HOLD_MS,
        note: 300 + SLOT_HOLD_MS + SLOT_MIN_SHOW_MS + SLOT_HOLD_MS,
      },
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

// Bodhi: "Screenshot the Atlas with the new dock · 1:57" settled as 1m 11s —
// the clock beside a step was the run's. It counts what the slot's first
// line shows, so the row lands with its own time in the same column.
describe("slotClock", () => {
  const slot = (entries: LiveSlot["entries"], quietSince: number | null = null): LiveSlot => ({
    entries,
    live: [],
    seen: new Set(),
    quietSince,
    pending: [],
  });
  it.each<{
    readonly name: string;
    readonly slot: LiveSlot;
    readonly first: { readonly key: string; readonly at: string } | null;
    readonly clock: { readonly from: string; readonly stopped: string | null } | null;
  }>([
    {
      name: "a step running: since it started",
      slot: slot([{ key: "s1", shownAt: 1000, endedAt: null, riders: [] }]),
      first: { key: "s1", at: "2026-10-04T10:00:00.000Z" },
      clock: { from: "2026-10-04T10:00:00.000Z", stopped: null },
    },
    {
      name: "a step that ended, holding its place: stopped where it ended",
      slot: slot([
        { key: "s1", shownAt: 1000, endedAt: Date.parse("2026-10-04T10:01:11.000Z"), riders: [] },
      ]),
      first: { key: "s1", at: "2026-10-04T10:00:00.000Z" },
      clock: { from: "2026-10-04T10:00:00.000Z", stopped: "2026-10-04T10:01:11.000Z" },
    },
    {
      name: "a note first seen whole: no time of its own",
      slot: slot([{ key: "n1", shownAt: 5000, endedAt: 5000, riders: [] }]),
      first: { key: "n1", at: "2026-10-04T10:00:00.000Z" },
      clock: null,
    },
    {
      name: "Thinking: since the quiet began",
      slot: slot([], Date.parse("2026-10-04T10:02:00.000Z")),
      first: null,
      clock: { from: "2026-10-04T10:02:00.000Z", stopped: null },
    },
  ])("$name", ({ slot: given, first, clock }) => {
    expect(slotClock(given, first)).toEqual(clock);
  });
});
