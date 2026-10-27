import { describe, expect, it } from "vite-plus/test";

import type { FailureReason, Known } from "./known.ts";
import { foldMateFeed, mateFeed, mateFeedKnown, type MateFeedEvent } from "./mateFeed.ts";

const UNSUPPORTED: FailureReason = { kind: "unsupported", capability: "subscribeZeropsAgentAuth" };
const REFUSED: FailureReason = {
  kind: "refused",
  code: "EnvironmentAuthorizationError",
  words: "Not allowed.",
};

const asked = (atMs: number): MateFeedEvent<string> => ({ kind: "asked", atMs });
const frame = (value: string, atMs: number): MateFeedEvent<string> => ({
  kind: "frame",
  value,
  atMs,
});
const disconnected = (atMs: number): MateFeedEvent<string> => ({ kind: "disconnected", atMs });
const failed = (failure: FailureReason, atMs: number): MateFeedEvent<string> => ({
  kind: "failed",
  failure,
  atMs,
});

const knownOf = (events: ReadonlyArray<MateFeedEvent<string>>): Known<string> =>
  mateFeedKnown(events.reduce(foldMateFeed, mateFeed<string>()));

/** DESIGN §2.C C12–C13 and the §3.5 "Mate feed" bridge row, one event sequence per row. */
const SEQUENCES: ReadonlyArray<{
  readonly name: string;
  readonly events: ReadonlyArray<MateFeedEvent<string>>;
  readonly known: Known<string>;
}> = [
  {
    name: "nothing asked yet is unread",
    events: [],
    known: { state: "unread", waitingFor: null },
  },
  {
    name: "no session before the first ask waits for the Mate",
    events: [disconnected(1_000)],
    known: { state: "unread", waitingFor: "mate-session" },
  },
  {
    name: "an ask is reading until the first frame",
    events: [asked(1_000)],
    known: { state: "reading", sinceMs: 1_000, attempt: 1 },
  },
  {
    name: "a disconnect before the first frame is still reading",
    events: [asked(1_000), disconnected(2_000)],
    known: { state: "reading", sinceMs: 1_000, attempt: 1 },
  },
  {
    name: "the first frame is a complete, live value",
    events: [asked(1_000), frame("a", 2_000)],
    known: {
      state: "known",
      value: "a",
      asOf: { ordinal: 2, atMs: 2_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    },
  },
  {
    name: "a disconnected feed keeps its value as stale",
    events: [asked(1_000), frame("a", 2_000), disconnected(3_000)],
    known: {
      state: "known",
      value: "a",
      asOf: { ordinal: 2, atMs: 2_000 },
      coverage: "complete",
      freshness: {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: null },
        sinceMs: 3_000,
      },
    },
  },
  {
    name: "a new session's ask revalidates the kept value",
    events: [asked(1_000), frame("a", 2_000), disconnected(3_000), asked(4_000)],
    known: {
      state: "known",
      value: "a",
      asOf: { ordinal: 2, atMs: 2_000 },
      coverage: "complete",
      freshness: { kind: "revalidating", sinceMs: 4_000 },
    },
  },
  {
    name: "the new session's first frame is live again",
    events: [asked(1_000), frame("a", 2_000), disconnected(3_000), asked(4_000), frame("b", 5_000)],
    known: {
      state: "known",
      value: "b",
      asOf: { ordinal: 3, atMs: 5_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    },
  },
  {
    name: "an old Mate without the RPC is failed(unsupported) and never retried",
    events: [asked(1_000), failed(UNSUPPORTED, 1_500)],
    known: {
      state: "failed",
      failure: UNSUPPORTED,
      atMs: 1_500,
      attempt: 1,
      retryAtMs: null,
    },
  },
  {
    name: "a new session to an old Mate keeps the failure rather than reading again",
    events: [asked(1_000), failed(UNSUPPORTED, 1_500), disconnected(2_000), asked(3_000)],
    known: {
      state: "failed",
      failure: UNSUPPORTED,
      atMs: 1_500,
      attempt: 1,
      retryAtMs: null,
    },
  },
  {
    name: "a Mate updated since answers a new session's ask, replacing the unsupported failure",
    events: [
      asked(1_000),
      failed(UNSUPPORTED, 1_500),
      disconnected(2_000),
      asked(3_000),
      frame("a", 4_000),
    ],
    known: {
      state: "known",
      value: "a",
      asOf: { ordinal: 3, atMs: 4_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    },
  },
  {
    name: "a refusal before any frame is failed with its cause, waiting for a new session",
    events: [asked(1_000), failed(REFUSED, 1_500)],
    known: { state: "failed", failure: REFUSED, atMs: 1_500, attempt: 1, retryAtMs: null },
  },
  {
    name: "a new session asks again after a refusal",
    events: [asked(1_000), failed(REFUSED, 1_500), asked(3_000)],
    known: { state: "reading", sinceMs: 3_000, attempt: 2 },
  },
  {
    name: "a failure after a frame keeps the value as stale with its cause",
    events: [asked(1_000), frame("a", 2_000), failed(REFUSED, 3_000)],
    known: {
      state: "known",
      value: "a",
      asOf: { ordinal: 2, atMs: 2_000 },
      coverage: "complete",
      freshness: {
        kind: "stale",
        reason: { kind: "revalidation-failed", failure: REFUSED, attempt: 1, retryAtMs: null },
        sinceMs: 3_000,
      },
    },
  },
];

describe("foldMateFeed", () => {
  it.each(SEQUENCES)("$name", ({ events, known }) => {
    expect(knownOf(events)).toEqual(known);
  });

  it("keeps its cell private: a feed is read only through mateFeedKnown (§3.6)", () => {
    const feed = mateFeed<string>();

    // @ts-expect-error a feed's cell is not part of its public shape
    expect(feed.cell).toBeUndefined();
    expect(Object.keys(feed)).toEqual([]);
  });

  it("never turns a known value back into reading or failed (M1)", () => {
    const tails: ReadonlyArray<MateFeedEvent<string>> = [
      asked(9_000),
      disconnected(9_000),
      failed(UNSUPPORTED, 9_000),
      failed(REFUSED, 9_000),
    ];
    for (const tail of tails) {
      expect(knownOf([asked(1_000), frame("a", 2_000), tail]).state).toBe("known");
    }
  });
});
