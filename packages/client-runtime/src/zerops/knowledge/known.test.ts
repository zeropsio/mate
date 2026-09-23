import { describe, expect, it } from "vite-plus/test";

import {
  advance,
  newCell,
  read,
  type Cell,
  type FailureReason,
  type Freshness,
  type Known,
  type KnownEvent,
} from "./known.ts";

const NOW = 50_000;
const TIMEOUT: FailureReason = { kind: "timeout", afterMs: 15_000 };
const UNSUPPORTED: FailureReason = { kind: "unsupported", capability: "deploymentFeed" };
const SETTLED: Freshness = { kind: "settled" };

const cellOf = (held: Known<string>, patch: Partial<Cell<string>> = {}): Cell<string> => ({
  ...newCell<string>("account"),
  held,
  ...patch,
});

const knownAt = (
  value: string,
  ordinal: number,
  freshness: Freshness = SETTLED,
  coverage: "complete" | "partial" = "complete",
): Known<string> => ({
  state: "known",
  value,
  asOf: { ordinal, atMs: ordinal * 1_000 },
  coverage,
  freshness,
});

const READING: Known<string> = { state: "reading", sinceMs: 1_000, attempt: 1 };
const GONE: Known<string> = {
  state: "gone",
  evidence: "direct-not-found",
  asOf: { ordinal: 2, atMs: 2_000 },
};

interface TransitionRow {
  readonly name: string;
  readonly from: Cell<string>;
  readonly event: KnownEvent<string>;
  readonly to: Cell<string>;
}

/** DESIGN §3.2, one row per line of the table; the store-level rows name the event the store sends. */
const TRANSITIONS: ReadonlyArray<TransitionRow> = [
  {
    name: "unread, prerequisite missing → unread(waitingFor), no failure recorded",
    from: newCell("account"),
    event: { kind: "waiting", on: "gitea-session" },
    to: cellOf({ state: "unread", waitingFor: "gitea-session" }),
  },
  {
    name: "unread, demanded with prerequisites met (the store starts a read) → reading",
    from: cellOf({ state: "unread", waitingFor: "gitea-session" }),
    event: { kind: "read-started", ordinal: 1, atMs: 1_000 },
    to: cellOf(READING, { lastReadStart: 1 }),
  },
  {
    name: "reading, read-succeeded → known(settled)",
    from: cellOf(READING, { lastReadStart: 1 }),
    event: {
      kind: "read-succeeded",
      ordinal: 1,
      value: "a",
      coverage: "partial",
      atMs: 1_000,
    },
    to: cellOf(knownAt("a", 1, SETTLED, "partial")),
  },
  {
    name: "reading, read-succeeded older than an admitted invalidation → known(stale(invalidated)) + dirty (M3)",
    from: cellOf(READING, { lastReadStart: 1, lastInvalidation: 2, dirty: true }),
    event: {
      kind: "read-succeeded",
      ordinal: 1,
      value: "a",
      coverage: "complete",
      atMs: 1_000,
    },
    to: cellOf(knownAt("a", 1, { kind: "stale", reason: { kind: "invalidated" }, sinceMs: NOW }), {
      lastInvalidation: 2,
      dirty: true,
    }),
  },
  {
    name: "reading, read-failed → failed(reason, retryAt)",
    from: cellOf(READING, { lastReadStart: 1 }),
    event: { kind: "read-failed", ordinal: 1, failure: TIMEOUT, retryAtMs: 54_000 },
    to: cellOf({
      state: "failed",
      failure: TIMEOUT,
      atMs: NOW,
      attempt: 1,
      retryAtMs: 54_000,
    }),
  },
  {
    name: "reading, read-failed(unsupported) → failed with retryAt = null",
    from: cellOf(READING, { lastReadStart: 1 }),
    event: { kind: "read-failed", ordinal: 1, failure: UNSUPPORTED, retryAtMs: 54_000 },
    to: cellOf({
      state: "failed",
      failure: UNSUPPORTED,
      atMs: NOW,
      attempt: 1,
      retryAtMs: null,
    }),
  },
  {
    name: "reading, proven-absent → gone(evidence)",
    from: cellOf(READING, { lastReadStart: 2 }),
    event: { kind: "proven-absent", evidence: "direct-not-found", ordinal: 2, atMs: 2_000 },
    to: cellOf(GONE),
  },
  {
    name: "known, proven-absent → gone(evidence)",
    from: cellOf(knownAt("a", 1)),
    event: { kind: "proven-absent", evidence: "authoritative-removal", ordinal: 2, atMs: 2_000 },
    to: cellOf({ ...GONE, evidence: "authoritative-removal" }),
  },
  {
    name: "known, read-started → known(revalidating)",
    from: cellOf(knownAt("a", 1)),
    event: { kind: "read-started", ordinal: 2, atMs: 2_000 },
    to: cellOf(knownAt("a", 1, { kind: "revalidating", sinceMs: 2_000 }), { lastReadStart: 2 }),
  },
  {
    name: "known, source(revalidating) → known(revalidating)",
    from: cellOf(knownAt("a", 1, { kind: "live" })),
    event: { kind: "source", freshness: "revalidating" },
    to: cellOf(knownAt("a", 1, { kind: "revalidating", sinceMs: NOW })),
  },
  {
    name: "known, read-succeeded(o > asOf) → known(v′, o)",
    from: cellOf(knownAt("a", 1, { kind: "revalidating", sinceMs: 2_000 }), { lastReadStart: 2 }),
    event: {
      kind: "read-succeeded",
      ordinal: 2,
      value: "b",
      coverage: "complete",
      atMs: 2_000,
    },
    to: cellOf(knownAt("b", 2)),
  },
  {
    name: "known, read-succeeded(o ≤ asOf) → unchanged, the read is complete and its value suppressed (M2)",
    from: cellOf(knownAt("b", 3, { kind: "live" }), { lastReadStart: 2 }),
    event: {
      kind: "read-succeeded",
      ordinal: 2,
      value: "a",
      coverage: "complete",
      atMs: 2_000,
    },
    to: cellOf(knownAt("b", 3, { kind: "live" })),
  },
  {
    name: "known(revalidating), read-failed → known(stale(revalidation-failed)), the value is kept",
    from: cellOf(knownAt("a", 1, { kind: "revalidating", sinceMs: 2_000 }), { lastReadStart: 2 }),
    event: { kind: "read-failed", ordinal: 2, failure: TIMEOUT, retryAtMs: 54_000 },
    to: cellOf(
      knownAt("a", 1, {
        kind: "stale",
        reason: {
          kind: "revalidation-failed",
          failure: TIMEOUT,
          attempt: 1,
          retryAtMs: 54_000,
        },
        sinceMs: NOW,
      }),
    ),
  },
  {
    name: "known, read-failed older than the applied value → unchanged, the read is complete (M2)",
    from: cellOf(knownAt("b", 3, { kind: "live" }), { lastReadStart: 2 }),
    event: { kind: "read-failed", ordinal: 2, failure: TIMEOUT, retryAtMs: 54_000 },
    to: cellOf(knownAt("b", 3, { kind: "live" })),
  },
  {
    name: "known(stale(revalidation-failed)), read-failed again → the failed attempt is counted",
    from: cellOf(
      knownAt("a", 1, {
        kind: "stale",
        reason: {
          kind: "revalidation-failed",
          failure: TIMEOUT,
          attempt: 1,
          retryAtMs: 54_000,
        },
        sinceMs: 40_000,
      }),
      { lastReadStart: 2 },
    ),
    event: { kind: "read-failed", ordinal: 2, failure: TIMEOUT, retryAtMs: 58_000 },
    to: cellOf(
      knownAt("a", 1, {
        kind: "stale",
        reason: {
          kind: "revalidation-failed",
          failure: TIMEOUT,
          attempt: 2,
          retryAtMs: 58_000,
        },
        sinceMs: NOW,
      }),
    ),
  },
  {
    name: "known, source(paused-background) → known(paused by background)",
    from: cellOf(knownAt("a", 1, { kind: "live" })),
    event: { kind: "source", freshness: "paused-background" },
    to: cellOf(knownAt("a", 1, { kind: "paused", by: "background" })),
  },
  {
    name: "known, source(paused-offline) → known(paused by offline)",
    from: cellOf(knownAt("a", 1, { kind: "live" })),
    event: { kind: "source", freshness: "paused-offline" },
    to: cellOf(knownAt("a", 1, { kind: "paused", by: "offline" })),
  },
  {
    name: "known, source(recovering) → known(stale(source-recovering))",
    from: cellOf(knownAt("a", 1, { kind: "live" })),
    event: { kind: "source", freshness: "recovering", retryAtMs: 57_000 },
    to: cellOf(
      knownAt("a", 1, {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: 57_000 },
        sinceMs: NOW,
      }),
    ),
  },
  {
    name: "known(paused), source(live) → known(live)",
    from: cellOf(knownAt("a", 1, { kind: "paused", by: "background" })),
    event: { kind: "source", freshness: "live" },
    to: cellOf(knownAt("a", 1, { kind: "live" })),
  },
  {
    name: "known(stale), source(live) → known(live)",
    from: cellOf(
      knownAt("a", 1, {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: null },
        sinceMs: 3_000,
      }),
    ),
    event: { kind: "source", freshness: "live" },
    to: cellOf(knownAt("a", 1, { kind: "live" })),
  },
  {
    name: "known(revalidating), source(live) → known(live)",
    from: cellOf(knownAt("a", 1, { kind: "revalidating", sinceMs: 3_000 })),
    event: { kind: "source", freshness: "live" },
    to: cellOf(knownAt("a", 1, { kind: "live" })),
  },
  {
    name: "known(paused), a read succeeds → known(settled)",
    from: cellOf(knownAt("a", 1, { kind: "paused", by: "offline" }), { lastReadStart: 2 }),
    event: {
      kind: "read-succeeded",
      ordinal: 2,
      value: "b",
      coverage: "complete",
      atMs: 2_000,
    },
    to: cellOf(knownAt("b", 2)),
  },
  {
    name: "known, invalidated → known(stale(invalidated))",
    from: cellOf(knownAt("a", 1)),
    event: { kind: "invalidated", ordinal: 2 },
    to: cellOf(knownAt("a", 1, { kind: "stale", reason: { kind: "invalidated" }, sinceMs: NOW }), {
      lastInvalidation: 2,
    }),
  },
  {
    name: "known(revalidating), invalidated during the read → stale(invalidated) + dirty, the read is not aborted (M3)",
    from: cellOf(knownAt("a", 1, { kind: "revalidating", sinceMs: 2_000 }), { lastReadStart: 2 }),
    event: { kind: "invalidated", ordinal: 3 },
    to: cellOf(knownAt("a", 1, { kind: "stale", reason: { kind: "invalidated" }, sinceMs: NOW }), {
      lastReadStart: 2,
      lastInvalidation: 3,
      dirty: true,
    }),
  },
  {
    name: "known, invalidated older than the value's read start → unchanged freshness",
    from: cellOf(knownAt("a", 3)),
    event: { kind: "invalidated", ordinal: 2 },
    to: cellOf(knownAt("a", 3), { lastInvalidation: 2 }),
  },
  {
    name: "failed, a retry trigger (the store starts a read) → reading, attempt counted",
    from: cellOf(
      { state: "failed", failure: TIMEOUT, atMs: 4_000, attempt: 1, retryAtMs: 6_000 },
      { lastInvalidation: 2 },
    ),
    event: { kind: "read-started", ordinal: 3, atMs: 6_000 },
    to: cellOf(
      { state: "reading", sinceMs: 6_000, attempt: 2 },
      { lastReadStart: 3, lastInvalidation: 2 },
    ),
  },
  {
    name: "failed, invalidated → failed, the invalidation is admitted for the next read",
    from: cellOf({
      state: "failed",
      failure: TIMEOUT,
      atMs: 4_000,
      attempt: 1,
      retryAtMs: 6_000,
    }),
    event: { kind: "invalidated", ordinal: 2 },
    to: cellOf(
      { state: "failed", failure: TIMEOUT, atMs: 4_000, attempt: 1, retryAtMs: 6_000 },
      { lastInvalidation: 2 },
    ),
  },
  {
    name: "gone, a direct verified read admitted after the absence → known",
    from: cellOf(GONE, { lastReadStart: 3 }),
    event: {
      kind: "read-succeeded",
      ordinal: 3,
      value: "back",
      coverage: "complete",
      atMs: 3_000,
    },
    to: cellOf(knownAt("back", 3)),
  },
  {
    name: "gone, a read that started before the absence → gone (M6)",
    from: cellOf(GONE, { lastReadStart: 1 }),
    event: {
      kind: "read-succeeded",
      ordinal: 1,
      value: "old",
      coverage: "complete",
      atMs: 1_000,
    },
    to: cellOf(GONE),
  },
  {
    name: "gone, a push → gone (M6: absence is sticky)",
    from: cellOf(GONE),
    event: { kind: "pushed", ordinal: 3, value: "pushed", atMs: 3_000 },
    to: cellOf(GONE),
  },
  {
    name: "unread, pushed → known(live, partial): a push never earns a complete negative",
    from: newCell("account"),
    event: { kind: "pushed", ordinal: 1, value: "a", atMs: 1_000 },
    to: cellOf(knownAt("a", 1, { kind: "live" }, "partial")),
  },
  {
    name: "known(paused), pushed newer → known(v′, live), coverage kept",
    from: cellOf(knownAt("a", 1, { kind: "paused", by: "background" })),
    event: { kind: "pushed", ordinal: 2, value: "b", atMs: 2_000 },
    to: cellOf(knownAt("b", 2, { kind: "live" })),
  },
  {
    name: "any cell, withhold → sets withheld, held and its stamp unchanged",
    from: cellOf(knownAt("a", 1)),
    event: { kind: "withhold", reason: "access-lapsed", cause: null },
    to: cellOf(knownAt("a", 1), { withheld: { reason: "access-lapsed", cause: null } }),
  },
  {
    name: "any cell, restore-authority → clears withheld, held and its stamp unchanged",
    from: cellOf(knownAt("a", 1), {
      withheld: { reason: "access-denied", cause: null },
    }),
    event: { kind: "restore-authority" },
    to: cellOf(knownAt("a", 1)),
  },
  {
    name: "a cell outside any access scope is never withheld",
    from: { ...newCell<string>(null), held: knownAt("a", 1) },
    event: { kind: "withhold", reason: "access-lapsed", cause: null },
    to: { ...newCell<string>(null), held: knownAt("a", 1) },
  },
];

describe("Known transitions (DESIGN §3.2)", () => {
  it.each(TRANSITIONS)("$name", ({ from, event, to }) => {
    expect(advance(from, event, NOW)).toEqual(to);
  });

  it("a key change or an eviction starts a new identity at unread", () => {
    expect(newCell("account")).toEqual({
      held: { state: "unread", waitingFor: null },
      scope: "account",
      withheld: null,
      lastReadStart: null,
      lastInvalidation: 0,
      dirty: false,
    });
  });

  it("a read after the invalidation clears dirty", () => {
    const dirty = cellOf(
      knownAt("a", 1, { kind: "stale", reason: { kind: "invalidated" }, sinceMs: NOW }),
      { lastInvalidation: 2, dirty: true },
    );
    expect(advance(dirty, { kind: "read-started", ordinal: 3, atMs: 3_000 }, NOW)).toEqual(
      cellOf(knownAt("a", 1, { kind: "revalidating", sinceMs: 3_000 }), {
        lastReadStart: 3,
        lastInvalidation: 2,
      }),
    );
  });
});

describe("read — the public read applies withholding (fail-closed)", () => {
  it("shows the held knowledge when nothing is withheld", () => {
    expect(read(cellOf(knownAt("a", 1)))).toEqual(knownAt("a", 1));
  });

  it("shows withheld, never the held value, when withheld", () => {
    const cause = { failure: TIMEOUT, retryAtMs: 60_000 };
    expect(read(cellOf(knownAt("a", 1), { withheld: { reason: "access-lapsed", cause } }))).toEqual(
      { state: "withheld", reason: "access-lapsed", cause },
    );
  });
});
