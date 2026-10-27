import { RunId, type RunEnd } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { turnStateOf, runStatusOf } from "./runState.ts";

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
    ({ end, state }) => expect(turnStateOf({ state: "ended", end })).toBe(state),
  );

  it.each(["admitted", "sending", "running", "waiting", "queued", "unknown"] as const)(
    "only admitted work carries a running turn, including $state",
    (state) =>
      expect(turnStateOf({ state, end: null })).toBe(
        ["queued", "unknown"].includes(state) ? null : "running",
      ),
  );

  it("the current run verdict uses active work and the last recorded end", () => {
    const active = { id: RunId.make("run") };
    const failed = { end: { kind: "failed" as const, reason: "Refused", next: null } };
    expect(runStatusOf({ activeRun: active, lastEnded: failed })).toBe("running");
    expect(runStatusOf({ activeRun: null, lastEnded: failed })).toBe("error");
    expect(runStatusOf({ activeRun: null, lastEnded: null })).toBe("ready");
  });
});
