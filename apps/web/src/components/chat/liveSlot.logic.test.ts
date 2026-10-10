import { describe, expect, it } from "vite-plus/test";

import {
  SLOT_BUSY_SHOW_MS,
  SLOT_HOLD_MS,
  SLOT_MIN_SHOW_MS,
  SLOT_RUSH_SHOW_MS,
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
      // Run 12: seven times the line read "Thinking" 0.8 s, a short command
      // already finished 1.2 s, "Thinking" again — the command had waited out
      // Thinking's minimum and ended meanwhile. A call takes Thinking's place
      // once Thinking has stood the pace, so it shows as it runs.
      name: "past its hold the slot says Thinking, and a call going live takes its place after the pace",
      moments: [
        { at: 0, live: ["step:a"], record: [] },
        { at: 300, live: [], record: ["step:a"] },
        { at: 1600, live: ["step:b"], record: ["step:a"] },
        { at: 2400, live: [], record: ["step:a", "step:b"] },
      ],
      until: 5000,
      shown: { "step:a": 0, "step:b": 300 + SLOT_HOLD_MS + SLOT_BUSY_SHOW_MS },
      plopped: { "step:a": 300 + SLOT_HOLD_MS, "step:b": 2400 + SLOT_HOLD_MS },
    },
    {
      name: "a call going live once Thinking stood the pace takes its place at once",
      moments: [
        { at: 0, live: ["step:a"], record: [] },
        { at: 300, live: [], record: ["step:a"] },
        { at: 1900, live: ["step:b"], record: ["step:a"] },
        { at: 2400, live: [], record: ["step:a", "step:b"] },
      ],
      until: 5000,
      shown: { "step:a": 0, "step:b": 1900 },
      plopped: { "step:a": 300 + SLOT_HOLD_MS, "step:b": 2400 + SLOT_HOLD_MS },
    },
    {
      // Review of pass 43: a call 10 ms after Thinking showed it for 10 ms.
      name: "Thinking stands the pace before even a call takes its place",
      moments: [
        { at: 0, live: ["step:a"], record: [] },
        { at: 300, live: [], record: ["step:a"] },
        { at: 1510, live: ["step:b"], record: ["step:a"] },
      ],
      until: 3000,
      shown: { "step:a": 0, "step:b": 300 + SLOT_HOLD_MS + SLOT_BUSY_SHOW_MS },
      plopped: { "step:a": 300 + SLOT_HOLD_MS },
    },
    {
      name: "a call first seen ended never waits out Thinking's minimum",
      moments: [
        { at: 0, live: ["step:a"], record: [] },
        { at: 300, live: [], record: ["step:a"] },
        { at: 1600, live: [], record: ["step:a", "call:c"] },
      ],
      until: 5000,
      shown: { "step:a": 0, "call:c": 300 + SLOT_HOLD_MS + SLOT_BUSY_SHOW_MS },
      plopped: {
        "step:a": 300 + SLOT_HOLD_MS,
        "call:c": 300 + SLOT_HOLD_MS + SLOT_BUSY_SHOW_MS + SLOT_HOLD_MS,
      },
    },
    {
      // Run 11: "one plop and 5 messages". A burst no longer rides along with
      // the item that stands: each read stands in the slot on its own, in the
      // order it came, quicker while three or more wait, and plops alone.
      name: "a burst passes the slot one at a time, quicker while three or more wait",
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
      // r2, r3 and the tests waiting make three: r1 has stood its quarter second.
      shown: { r1: 0, r2: 550, r3: 550 + SLOT_MIN_SHOW_MS, tests: 550 + 2 * SLOT_MIN_SHOW_MS },
      plopped: {
        r1: 550,
        r2: 550 + SLOT_MIN_SHOW_MS,
        r3: 550 + 2 * SLOT_MIN_SHOW_MS,
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
      plopped: { a: 1000, b: 3000 + SLOT_HOLD_MS },
    },
    {
      name: "calls that end together plop one after another, never as one",
      moments: [
        { at: 0, live: ["a", "b", "c"], record: [] },
        { at: 2000, live: [], record: ["a", "b", "c"] },
      ],
      until: 6000,
      shown: { a: 0, b: 0, c: 0 },
      plopped: {
        a: 2000,
        b: 2000 + SLOT_BUSY_SHOW_MS,
        c: Math.max(2000 + 2 * SLOT_BUSY_SHOW_MS, 2000 + SLOT_HOLD_MS),
      },
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
        "question:q": 5000 + SLOT_HOLD_MS,
        "person:a": 5000 + SLOT_HOLD_MS,
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
      // once its words are known. Each stands on its own, in the order it came.
      name: "what is first seen ended stands its minimum, one at a time",
      moments: [
        { at: 0, live: [], record: [] },
        { at: 1000, live: [], record: ["c1", "c2"] },
        { at: 1300, live: [], record: ["c1", "c2", "note"] },
      ],
      until: 6000,
      // "Thinking" from the first draw has stood its minimum when c1 arrives.
      shown: {
        c1: 1000,
        c2: 1000 + SLOT_MIN_SHOW_MS,
        note: 1000 + 2 * SLOT_MIN_SHOW_MS,
      },
      plopped: {
        c1: 1000 + SLOT_MIN_SHOW_MS,
        c2: 1000 + 2 * SLOT_MIN_SHOW_MS,
        note: 1000 + 2 * SLOT_MIN_SHOW_MS + SLOT_HOLD_MS,
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

  // Review of pass 43: only a call cuts a fresh Thinking short — words
  // streaming, a thought, a question wait out its minimum as before.
  it.each([
    { name: "words", key: "note:n" },
    { name: "a thought", key: "thought:t" },
    { name: "a question", key: "question:q" },
  ])("$name going live into a fresh Thinking wait out its minimum", ({ key }) => {
    const played = play(
      [
        { at: 0, live: ["step:a"], record: [] },
        { at: 300, live: [], record: ["step:a"] },
        { at: 1600, live: [key], record: ["step:a"] },
      ],
      4000,
    );
    expect(played.shown).toEqual({
      "step:a": 0,
      [key]: 300 + SLOT_HOLD_MS + SLOT_MIN_SHOW_MS,
    });
  });

  it("words beside a call going live into a fresh Thinking enter with it", () => {
    const played = play(
      [
        { at: 0, live: ["step:a"], record: [] },
        { at: 300, live: [], record: ["step:a"] },
        { at: 1900, live: ["note:n", "step:b"], record: ["step:a"] },
      ],
      4000,
    );
    expect(played.shown).toEqual({ "step:a": 0, "note:n": 1900, "step:b": 1900 });
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
      rows.map((key) => [key, { key, shownAt: 0, endedAt: ended.includes(key) ? 10 : null }]),
    );
    expect(slotRunningPast(rows.map((key) => ({ entry: entries.get(key)! })))).toBe(more);
  });

  // Review of pass 42: a call that went live while notes waited their turn,
  // and ended before its own came, was drawn in the history at once — above
  // the notes still waiting to plop.
  it("queues a live item that ended before its turn, after what waited before it", () => {
    const played = play(
      [
        { at: 0, live: ["a"], record: [] },
        { at: 100, live: [], record: ["a", "n1", "n2", "n3"] },
        { at: 150, live: ["b"], record: ["a", "n1", "n2", "n3", "b"] },
        { at: 400, live: [], record: ["a", "n1", "n2", "n3", "b"] },
      ],
      8000,
    );
    expect(played.shown.b).toBeGreaterThan(played.shown.n3!);
    expect(played.plopped.b).toBeGreaterThan(played.plopped.n3!);
  });

  it("leaves out of the history what arrived since the slot last heard, before it places it", () => {
    const slot = slotStart({ at: 0, live: [], record: ["c1"] });
    expect([...slotHoldsIn(slot, ["c1", "c2"])]).toEqual(["c2"]);
  });

  // Twenty quick reads back to back, then a long command: each read stands in
  // the slot, a quarter second each while three or more wait, and the
  // command shows once they passed: about 3 s behind, never a pile in one plop.
  it("passes a long burst a quarter second an item, and the next call after it", () => {
    const moments: Moment[] = [];
    const done: string[] = [];
    for (let read = 0; read < 20; read += 1) {
      moments.push({ at: read * 100, live: [`r${read}`], record: [...done] });
      done.push(`r${read}`);
      moments.push({ at: read * 100 + 90, live: [], record: [...done] });
    }
    moments.push({ at: 2000, live: ["build"], record: [...done] });
    const played = play(moments, 9000);
    const plops = Object.values(played.plopped).toSorted((a, b) => a - b);
    // One at a time: never two plops at once.
    for (let index = 1; index < plops.length; index += 1) {
      expect(plops[index]! - plops[index - 1]!).toBeGreaterThanOrEqual(SLOT_RUSH_SHOW_MS);
    }
    expect(Object.keys(played.shown)).toHaveLength(21);
    expect(played.shown.build! - 2000).toBeLessThanOrEqual(3200);
  });
});

// Review of pass 39: "Thinking"'s clock restarted on every catch-up and every
// reload, and held the first item back as if Thinking had just been said.
describe("the quiet's start, from the data", () => {
  it.each([
    { name: "a reload mid-quiet", start: true },
    { name: "a catch-up batch", start: false },
  ])("carries when the quiet began through $name", ({ start }) => {
    const offer = { at: 60_000, live: [] as string[], record: ["c1"], quietFrom: 20_000 };
    const slot = start
      ? slotStart(offer)
      : slotResync(slotStart({ at: 0, live: ["c1"], record: [] }), offer);
    expect(slot.quietSince).toBe(20_000);
    // An item now enters at once: Thinking stood long ago.
    const next = slotOffer(slot, { at: 60_100, live: ["c2"], record: ["c1"], final: false });
    expect(next.entries.map((entry) => entry.key)).toEqual(["c2"]);
  });
});
