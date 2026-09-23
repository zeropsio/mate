import { describe, expect, it } from "vite-plus/test";

import {
  advance,
  newCell,
  read,
  type Cell,
  type Coverage,
  type Known,
  type KnownEvent,
} from "./known.ts";

/**
 * DESIGN §3.3 M1–M3, M5, M7 and §4.0's superseded attempts (§11.3 I1, I11) over every event
 * sequence a store can send, breadth first, deduplicated by state. The domains are bounded: at
 * most two reads in flight, one prerequisite, one value per ordinal, one withholding reason.
 * Ordinals are allocated the way a store allocates them — strictly increasing across read starts,
 * pushes, invalidations and removals — and a read result names a read that is in flight.
 */
const DEPTH = 8;
const MAX_OPEN_READS = 2;

interface ModelState {
  readonly cell: Cell<string>;
  readonly nextOrdinal: number;
  readonly openReads: ReadonlyArray<number>;
  /** The coverage the newest admitted source statement gave the held value; `null` without one. */
  readonly stated: Coverage | null;
}

const eventsFrom = (state: ModelState): ReadonlyArray<KnownEvent<string>> => {
  const next = state.nextOrdinal;
  const events: Array<KnownEvent<string>> = [
    { kind: "waiting", on: "gitea-session" },
    { kind: "pushed", ordinal: next, value: `push-${next}`, atMs: next * 1_000 },
    {
      kind: "pushed",
      ordinal: next,
      value: `push-${next}`,
      coverage: "complete",
      atMs: next * 1_000,
    },
    { kind: "invalidated", ordinal: next },
    { kind: "proven-absent", evidence: "authoritative-removal", ordinal: next, atMs: next * 1_000 },
    { kind: "source", freshness: "live" },
    { kind: "source", freshness: "revalidating" },
    { kind: "source", freshness: "paused-background" },
    { kind: "source", freshness: "paused-offline" },
    { kind: "source", freshness: "recovering", retryAtMs: 90_000 },
    { kind: "withhold", reason: "access-lapsed", cause: null },
    { kind: "restore-authority" },
  ];
  if (state.openReads.length < MAX_OPEN_READS) {
    events.push({ kind: "read-started", ordinal: next, atMs: next * 1_000 });
  }
  for (const ordinal of state.openReads) {
    events.push(
      {
        kind: "read-succeeded",
        ordinal,
        value: `read-${ordinal}`,
        coverage: "complete",
        atMs: ordinal * 1_000,
      },
      {
        kind: "read-succeeded",
        ordinal,
        value: `read-${ordinal}`,
        coverage: "partial",
        atMs: ordinal * 1_000,
      },
      {
        kind: "read-failed",
        ordinal,
        failure: { kind: "timeout", afterMs: 15_000 },
        retryAtMs: 80_000,
      },
      {
        kind: "read-failed",
        ordinal,
        failure: { kind: "unsupported", capability: "feed" },
        retryAtMs: 80_000,
      },
      { kind: "proven-absent", evidence: "direct-not-found", ordinal, atMs: ordinal * 1_000 },
    );
  }
  return events;
};

const step = (state: ModelState, event: KnownEvent<string>, nowMs: number): ModelState => {
  const allocates =
    event.kind === "read-started" ||
    event.kind === "pushed" ||
    event.kind === "invalidated" ||
    (event.kind === "proven-absent" && !state.openReads.includes(event.ordinal));
  const completes =
    event.kind === "read-succeeded" ||
    event.kind === "read-failed" ||
    (event.kind === "proven-absent" && state.openReads.includes(event.ordinal));
  const cell = advance(state.cell, event, nowMs);
  const admitted =
    (event.kind === "read-succeeded" || event.kind === "pushed") &&
    cell.held.state === "known" &&
    cell.held.asOf.ordinal === event.ordinal;
  return {
    cell,
    stated:
      cell.held.state !== "known"
        ? null
        : admitted && event.coverage !== undefined
          ? event.coverage
          : state.stated,
    nextOrdinal: allocates ? state.nextOrdinal + 1 : state.nextOrdinal,
    openReads:
      event.kind === "read-started"
        ? [...state.openReads, event.ordinal]
        : completes
          ? state.openReads.filter((ordinal) => ordinal !== event.ordinal)
          : state.openReads,
  };
};

const stampOf = (held: Known<string>): number | null =>
  held.state === "known" || held.state === "gone" ? held.asOf.ordinal : null;

/** Every violation of M1–M3, M5 and M7 in one transition, as readable strings. */
const violations = (
  before: Cell<string>,
  event: KnownEvent<string>,
  after: Cell<string>,
  stated: Coverage | null,
): ReadonlyArray<string> => {
  const found: Array<string> = [];
  // M5: coverage no source stated is never complete, and never stranded partial: a read stays
  // owed until one proves it.
  if (after.held.state === "known" && after.held.coverage !== stated) {
    if (after.held.coverage === "complete") found.push("M5: complete coverage no source stated");
    else if (!after.dirty) found.push("M5: unproven partial coverage with no read owed");
  }
  // M1: within one identity, known leaves only through gone.
  if (
    before.held.state === "known" &&
    after.held.state !== "known" &&
    after.held.state !== "gone"
  ) {
    found.push(`M1: known became ${after.held.state}`);
  }
  // M2: the stamp never decreases.
  const was = stampOf(before.held);
  const is = stampOf(after.held);
  if (was !== null && is !== null && is < was) found.push(`M2: ordinal ${was} → ${is}`);
  // M6 (the part M2 needs): gone reopens only on a newer direct read, never on a push.
  if (before.held.state === "gone" && after.held.state === "known") {
    if (event.kind !== "read-succeeded") found.push(`M6: ${event.kind} reopened gone`);
    if (was !== null && is !== null && is <= was) found.push("M6: reopened by an older read");
  }
  // M3: a read that started before an admitted invalidation stores its value but never fresh.
  if (
    event.kind === "read-succeeded" &&
    event.ordinal < after.lastInvalidation &&
    after.held.state === "known" &&
    after.held.asOf.ordinal === event.ordinal
  ) {
    const freshness = after.held.freshness;
    if (freshness.kind !== "stale" || freshness.reason.kind !== "invalidated") {
      found.push(`M3: read ${event.ordinal} before invalidation marked ${freshness.kind}`);
    }
    if (!after.dirty) found.push(`M3: read ${event.ordinal} before invalidation left clean`);
  }
  // §4.0: a failure of a read superseded by one still in flight is dropped.
  if (
    event.kind === "read-failed" &&
    before.lastReadStart !== null &&
    before.lastReadStart > event.ordinal &&
    JSON.stringify(after.held) !== JSON.stringify(before.held)
  ) {
    found.push(`§4.0: superseded read ${event.ordinal} failed over read ${before.lastReadStart}`);
  }
  // M3: no event marks a value older than an admitted invalidation fresh.
  if (
    after.held.state === "known" &&
    after.held.asOf.ordinal < after.lastInvalidation &&
    (after.held.freshness.kind === "live" || after.held.freshness.kind === "settled")
  ) {
    found.push(`M3: ${event.kind} marked a value older than the invalidation fresh`);
  }
  // M3: an invalidation never aborts the read in flight.
  if (event.kind === "invalidated" && after.lastReadStart !== before.lastReadStart) {
    found.push("M3: an invalidation aborted the read in flight");
  }
  // M7 / I11: withholding never changes what is held and lives only on the public read.
  if (event.kind === "withhold" || event.kind === "restore-authority") {
    if (JSON.stringify(after.held) !== JSON.stringify(before.held)) {
      found.push(`M7: ${event.kind} changed held`);
    }
    if (
      after.lastReadStart !== before.lastReadStart ||
      after.lastInvalidation !== before.lastInvalidation ||
      after.dirty !== before.dirty
    ) {
      found.push(`M7: ${event.kind} changed read bookkeeping`);
    }
  } else if (after.withheld !== before.withheld) {
    found.push(`M7: ${event.kind} changed the withholding`);
  }
  const shown = read(after);
  if ((after.withheld !== null) !== (shown.state === "withheld")) {
    found.push("M7: the public read disagrees with the withholding");
  }
  if (shown.state === "withheld" && "value" in shown) {
    found.push("M7: a withheld read exposes a value");
  }
  return found;
};

describe("Known monotonicity (DESIGN §3.3 M1–M3, M5, M7) over enumerated event sequences", () => {
  for (const scope of ["account", null] as const) {
    it(`holds for every sequence to depth ${DEPTH} (scope ${scope ?? "none"})`, () => {
      let layer = new Map<string, { state: ModelState; path: ReadonlyArray<string> }>();
      const initial: ModelState = {
        cell: newCell(scope),
        nextOrdinal: 1,
        openReads: [],
        stated: null,
      };
      layer.set(JSON.stringify(initial), { state: initial, path: [] });
      const found: Array<string> = [];
      let transitions = 0;
      for (let depth = 1; depth <= DEPTH && found.length === 0; depth += 1) {
        const nowMs = 100_000 + depth * 1_000;
        const nextLayer = new Map<string, { state: ModelState; path: ReadonlyArray<string> }>();
        for (const { state, path } of layer.values()) {
          for (const event of eventsFrom(state)) {
            const after = step(state, event, nowMs);
            transitions += 1;
            const trail = [...path, JSON.stringify(event)];
            for (const violation of violations(state.cell, event, after.cell, after.stated)) {
              found.push(`${violation}\n  after ${trail.join("\n  ")}`);
            }
            nextLayer.set(JSON.stringify(after), { state: after, path: trail });
          }
        }
        layer = nextLayer;
      }
      expect(found.slice(0, 3)).toEqual([]);
      expect(transitions).toBeGreaterThan(10_000);
    });
  }
});
