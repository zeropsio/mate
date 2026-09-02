import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "./dto.ts";
import type { AttributionResult } from "./attribution.ts";
import {
  type ActivityReducerInput,
  RESULT_STATUSES_WITH_PLATFORM_CONTINUATION,
  reduceActivityState,
} from "./reducer.ts";

const NOW = Date.parse("2026-09-02T10:00:00.000Z");

function process(overrides: Partial<ActivityProcess>): ActivityProcess {
  return {
    id: "p1",
    projectId: "proj-1",
    serviceStackIds: ["svc-1"],
    status: "RUNNING",
    actionName: "stack.deploy",
    created: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

const baseInput = (overrides: Partial<ActivityReducerInput> = {}): ActivityReducerInput => ({
  hasResult: false,
  attributable: true,
  toolStartedAtMs: NOW,
  ceilingExceeded: false,
  ...overrides,
});

const observationOf = (
  attribution: AttributionResult,
  atMs = NOW,
): ActivityReducerInput["lastObservation"] => ({
  attribution,
  atMs,
});

describe("reduceActivityState — §5 the per-card state machine", () => {
  it("idle when not attributable — no session, no hostname, no topology", () => {
    expect(reduceActivityState(baseInput({ attributable: false }), NOW)).toEqual({ kind: "idle" });
  });

  it("searching before any process has been attributed, with elapsed time", () => {
    expect(reduceActivityState(baseInput(), NOW + 3_000)).toEqual({
      kind: "searching",
      elapsedMs: 3_000,
    });
  });

  it("observed once a live process is attributed", () => {
    const p = process({ actionName: "stack.deploy", appVersion: { status: "BUILDING" } });
    const input = baseInput({ lastObservation: observationOf({ stepSource: p, chips: [] }) });
    const state = reduceActivityState(input, NOW);
    expect(state.kind).toBe("observed");
  });

  it("settledOnPlatform once the attributed process's pipeline is terminal", () => {
    const p = process({ appVersion: { status: "ACTIVE" } });
    const input = baseInput({ lastObservation: observationOf({ stepSource: p, chips: [] }) });
    const state = reduceActivityState(input, NOW);
    expect(state).toMatchObject({ kind: "settledOnPlatform", outcome: "finished" });
  });

  it("settledOnPlatform with outcome failed for a DEPLOY_FAILED pipeline", () => {
    const p = process({ appVersion: { status: "DEPLOY_FAILED" } });
    const input = baseInput({ lastObservation: observationOf({ stepSource: p, chips: [] }) });
    expect(reduceActivityState(input, NOW)).toMatchObject({
      kind: "settledOnPlatform",
      outcome: "failed",
    });
  });

  /** §7 edge 9: a GUI cancel is a process-level CANCELED, independent of the appVersion shape. */
  it("settledOnPlatform 'cancelled' when the process itself is CANCELED, even mid-build", () => {
    const p = process({ status: "CANCELED", appVersion: { status: "BUILDING" } });
    const input = baseInput({ lastObservation: observationOf({ stepSource: p, chips: [] }) });
    expect(reduceActivityState(input, NOW)).toMatchObject({
      kind: "settledOnPlatform",
      outcome: "cancelled",
    });
  });

  it("stale after 10s with no fresh read, keeping the last pipeline", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const input = baseInput({ lastObservation: observationOf({ stepSource: p, chips: [] }, NOW) });
    const state = reduceActivityState(input, NOW + 11_000);
    expect(state).toMatchObject({ kind: "stale", staleMs: 11_000 });
  });

  it("unavailable after 60s with no fresh read", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const input = baseInput({ lastObservation: observationOf({ stepSource: p, chips: [] }, NOW) });
    expect(reduceActivityState(input, NOW + 61_000)).toEqual({
      kind: "unavailable",
      reason: "stale-timeout",
    });
  });

  it("stale recovers to observed/settledOnPlatform once a good read lands (fresh atMs)", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const staleInput = baseInput({
      lastObservation: observationOf({ stepSource: p, chips: [] }, NOW),
    });
    expect(reduceActivityState(staleInput, NOW + 11_000).kind).toBe("stale");

    const freshInput = baseInput({
      lastObservation: observationOf({ stepSource: p, chips: [] }, NOW + 11_000),
    });
    expect(reduceActivityState(freshInput, NOW + 11_000).kind).toBe("observed");
  });

  it("unavailable on the 30-minute per-call ceiling, regardless of last observation", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const input = baseInput({
      ceilingExceeded: true,
      lastObservation: observationOf({ stepSource: p, chips: [] }),
    });
    expect(reduceActivityState(input, NOW)).toEqual({ kind: "unavailable", reason: "ceiling" });
  });

  it("unavailable when the poller reports a reason (401/403/404/mismatch)", () => {
    expect(reduceActivityState(baseInput({ unavailableReason: "forbidden" }), NOW)).toEqual({
      kind: "unavailable",
      reason: "forbidden",
    });
  });

  it("resolved with no continuation once the result lands, freezing the overlay", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const input = baseInput({
      hasResult: true,
      resultStatus: "DEPLOYED",
      lastObservation: observationOf({ stepSource: p, chips: [] }),
    });
    expect(reduceActivityState(input, NOW)).toEqual({ kind: "resolved" });
  });

  it("resolved wins over ceiling/unavailable/searching — a landed result is never overridden", () => {
    const input = baseInput({ hasResult: true, resultStatus: "DEPLOYED", ceilingExceeded: true });
    expect(reduceActivityState(input, NOW)).toEqual({ kind: "resolved" });
  });

  /** §4's one exception: BUILD_TRIGGERED keeps the overlay below its own verdict. */
  it("resolved WITH continuation for the BUILD_TRIGGERED allowlist exception", () => {
    expect(RESULT_STATUSES_WITH_PLATFORM_CONTINUATION.has("BUILD_TRIGGERED")).toBe(true);
    const p = process({ appVersion: { status: "BUILDING" } });
    const input = baseInput({
      hasResult: true,
      resultStatus: "BUILD_TRIGGERED",
      lastObservation: observationOf({ stepSource: p, chips: [] }),
    });
    const state = reduceActivityState(input, NOW);
    expect(state.kind).toBe("resolved");
    expect(state.kind === "resolved" && state.continuation).toBeDefined();
  });

  it("BUILD_TRIGGERED with no platform data yet has no continuation to show", () => {
    const input = baseInput({ hasResult: true, resultStatus: "BUILD_TRIGGERED" });
    expect(reduceActivityState(input, NOW)).toEqual({ kind: "resolved" });
  });

  it("any other resolved status never carries a continuation, even with platform data", () => {
    const p = process({ appVersion: { status: "DEPLOYING" } });
    const input = baseInput({
      hasResult: true,
      resultStatus: "BUILD_FAILED",
      lastObservation: observationOf({ stepSource: p, chips: [] }),
    });
    expect(reduceActivityState(input, NOW)).toEqual({ kind: "resolved" });
  });

  /** §7 edge 2: a failure before any process exists stays `searching`, not an error. */
  it("stays searching, not unavailable, when nothing has been attributed yet", () => {
    expect(reduceActivityState(baseInput(), NOW)).toEqual({ kind: "searching", elapsedMs: 0 });
  });
});
