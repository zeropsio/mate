// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "./dto.ts";
import type { AttributionResult } from "./attribution.ts";
import { type ObservationInput, observe } from "./observe.ts";

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

const baseInput = (overrides: Partial<ObservationInput> = {}): ObservationInput => ({
  attributable: true,
  startedAtMs: NOW,
  ...overrides,
});

const lastReadOf = (
  attribution: AttributionResult,
  atMs = NOW,
): NonNullable<ObservationInput["lastRead"]> => ({ attribution, atMs });

describe("observe — the three-state observation layer", () => {
  it("off: no-target when not attributable and no reason was given", () => {
    expect(observe(baseInput({ attributable: false }), NOW)).toEqual({
      kind: "off",
      reason: "no-target",
    });
  });

  it("off carries the caller's own reason when not attributable (e.g. no-session)", () => {
    expect(
      observe(baseInput({ attributable: false, unavailableReason: "no-session" }), NOW),
    ).toEqual({ kind: "off", reason: "no-session" });
  });

  it("observing with empty steps/processes before the first read — the elapsed clock only", () => {
    expect(observe(baseInput(), NOW + 3_000)).toEqual({
      kind: "observing",
      observation: { steps: [], processes: [], readAtMs: expect.any(Number) },
      elapsedMs: 3_000,
    });
  });

  it("off: ceiling once the 30-minute default ceiling is exceeded", () => {
    expect(observe(baseInput(), NOW + 31 * 60_000)).toEqual({ kind: "off", reason: "ceiling" });
  });

  it("a custom ceilingMs is honoured", () => {
    expect(observe(baseInput({ ceilingMs: 60_000 }), NOW + 61_000)).toEqual({
      kind: "off",
      reason: "ceiling",
    });
    expect(observe(baseInput({ ceilingMs: 60_000 }), NOW + 59_000).kind).toBe("observing");
  });

  it("off with the poller's own reason (401/403/404/mismatch), even before any read", () => {
    expect(observe(baseInput({ unavailableReason: "unauthorized" }), NOW)).toEqual({
      kind: "off",
      reason: "unauthorized",
    });
  });

  it("observing once a live process is attributed — steps come from the step source", () => {
    const p = process({ appVersion: { status: "BUILDING", build: { pipelineStart: "t1" } } });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind).toBe("observing");
    expect(state.kind === "observing" && state.observation.steps.length).toBeGreaterThan(0);
    expect(state.kind === "observing" && state.observation.processes).toEqual([p]);
    expect(state.kind === "observing" && state.observation.outcome).toBeUndefined();
  });

  it("processes lists the step source first, then the chips", () => {
    const stepSource = process({ id: "p-deploy" });
    const chip = process({ id: "p-subdomain", actionName: "stack.enableSubdomainAccess" });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource, chips: [chip], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.processes).toEqual([stepSource, chip]);
  });

  it("carries the outcome once the attributed process's pipeline is terminal", () => {
    const p = process({ appVersion: { status: "ACTIVE" } });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("finished");
  });

  it("outcome failed for a DEPLOY_FAILED pipeline", () => {
    const p = process({ appVersion: { status: "DEPLOY_FAILED" } });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("failed");
  });

  it("outcome cancelled when the process itself is CANCELED, independent of the appVersion", () => {
    const p = process({ status: "CANCELED", appVersion: { status: "BUILDING" } });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("cancelled");
  });

  it("stale after 10s with no fresh read, keeping the last observation", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const input = baseInput({
      lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }, NOW),
    });
    const state = observe(input, NOW + 11_000);
    expect(state).toMatchObject({ kind: "stale", ageMs: 11_000 });
  });

  it("off: stale-timeout after 60s with no fresh read", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const input = baseInput({
      lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }, NOW),
    });
    expect(observe(input, NOW + 61_000)).toEqual({ kind: "off", reason: "stale-timeout" });
  });

  it("stale recovers to observing once a fresh read lands", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const stale = observe(
      baseInput({
        lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }, NOW),
      }),
      NOW + 11_000,
    );
    expect(stale.kind).toBe("stale");

    const fresh = observe(
      baseInput({
        lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }, NOW + 11_000),
      }),
      NOW + 11_000,
    );
    expect(fresh.kind).toBe("observing");
  });

  /**
   * A settled pipeline never goes stale — the poller has already stopped
   * polling for exactly that reason (nothing left to learn), so re-applying
   * the staleness rule here would make a finished/failed/cancelled operation
   * flicker in and out as its last read ages, unlike an operation still in
   * flight.
   */
  it("never goes stale once the outcome is set, however old the last read", () => {
    const p = process({ appVersion: { status: "ACTIVE" } });
    const input = baseInput({
      lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }, NOW),
    });
    const past10s = observe(input, NOW + 11_000);
    expect(past10s.kind).toBe("observing");
    const past60s = observe(input, NOW + 61_000);
    expect(past60s.kind).toBe("observing");
    // Still well inside the 30-minute ceiling — the outcome exemption is
    // about staleness (10s/60s), not the per-operation ceiling.
    const past5min = observe(input, NOW + 5 * 60_000);
    expect(past5min.kind).toBe("observing");
    expect(past5min.kind === "observing" && past5min.observation.outcome).toBe("finished");
  });

  it("carries the build log query once the step source's appVersion has id + build.serviceStackId", () => {
    const p = process({
      appVersion: {
        id: "av-1",
        status: "BUILDING",
        build: { pipelineStart: "2026-09-02T09:59:55.000Z", serviceStackId: "build-svc-1" },
      },
    });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.buildLog).toEqual({
      buildServiceStackId: "build-svc-1",
      appVersionId: "av-1",
      fromIso: "2026-09-02T09:59:50.000Z",
    });
  });

  it("has no build log query when the appVersion is missing id or build.serviceStackId", () => {
    const p = process({
      appVersion: { status: "BUILDING", build: { serviceStackId: "build-svc-1" } },
    });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.buildLog).toBeUndefined();
  });

  it("has no build log fromIso when the appVersion has no pipelineStart yet", () => {
    const p = process({
      appVersion: { id: "av-1", status: "BUILDING", build: { serviceStackId: "build-svc-1" } },
    });
    const state = observe(
      baseInput({ lastRead: lastReadOf({ stepSource: p, chips: [], projectMismatch: false }) }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.buildLog).toEqual({
      buildServiceStackId: "build-svc-1",
      appVersionId: "av-1",
    });
  });
});
