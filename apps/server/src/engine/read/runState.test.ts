import { Run, type RunEnd } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { turnStateOf, runStatusOf } from "./runState.ts";

const decodeRun = Schema.decodeUnknownSync(Run);
const fixtureRun = (state: string, end: RunEnd | null, id = "run") =>
  decodeRun({
    id,
    conversationId: "conversation",
    ordinal: 1,
    seq: 1,
    rev: 1,
    trigger: { kind: "person", itemId: "item" },
    joins: null,
    principal: { kind: "engine" },
    state,
    maintenance: false,
    waitingOn: state === "waiting" ? { kind: "request", requestId: "request" } : null,
    stopAsked: null,
    end,
    endSource: null,
    sessionId: null,
    providerTurnId: null,
    queuedAt: 0,
    admittedAt: ["admitted", "sending", "running", "waiting", "ended"].includes(state) ? 1 : null,
    startedAt: ["running", "waiting", "ended"].includes(state) ? 2 : null,
    endedAt: state === "ended" ? 3 : null,
    unresponsiveSince: null,
  });

describe("the server's run verdict", () => {
  // Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).
  it.each([
    { end: { kind: "completed" }, state: "completed" },
    { end: { kind: "stopped", by: { kind: "engine" } }, state: "interrupted" },
    { end: { kind: "failed", reason: "Refused", next: "Choose another model" }, state: "error" },
    { end: { kind: "crashed", reason: "Exited" }, state: "error" },
    { end: { kind: "usage-limit", resetsAt: null }, state: "interrupted" },
    { end: { kind: "cut-by-restart", continuedBy: null }, state: "interrupted" },
    { end: { kind: "unknown", type: "future" }, state: null },
    { end: null, state: null },
  ] satisfies Array<{ end: RunEnd | null; state: string | null }>)(
    "an ended run carries $end.kind as $state without inventing an unknown ending",
    ({ end, state }) => expect(turnStateOf(fixtureRun("ended", end))).toBe(state),
  );

  it.each(["admitted", "sending", "running", "waiting", "queued", "unknown"] as const)(
    "only admitted work carries a running turn, including $state",
    (state) =>
      expect(turnStateOf(fixtureRun(state, null))).toBe(
        ["queued", "unknown"].includes(state) ? null : "running",
      ),
  );

  it("the current run verdict uses active work and the last recorded end", () => {
    const active = fixtureRun("running", null, "active-run");
    const failed = fixtureRun(
      "ended",
      { kind: "failed", reason: "Refused", next: null },
      "ended-run",
    );
    expect(runStatusOf({ activeRun: active, lastEnded: failed })).toBe("running");
    expect(runStatusOf({ activeRun: null, lastEnded: failed })).toBe("error");
    expect(runStatusOf({ activeRun: null, lastEnded: null })).toBe("ready");
  });
});
