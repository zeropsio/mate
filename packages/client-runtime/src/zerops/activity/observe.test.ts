// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "./dto.ts";
import { type ObservationInput, observe, operationReadCeilingMs } from "./observe.ts";

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
  feed: "live",
  ...overrides,
});

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

  it("observing with no pipeline or chips before the first read — the elapsed clock only", () => {
    expect(observe(baseInput(), NOW + 3_000)).toEqual({
      kind: "observing",
      observation: { chips: [] },
      elapsedMs: 3_000,
    });
  });

  // A card that never read says what the feed says, never what a timer guessed: catching up is
  // stale, however long; the first connect is still waiting.
  it.each([
    { name: "while the feed first connects: waiting", feed: "connecting", kind: "observing" },
    { name: "while the feed catches up: stale, after 5 s", feed: "catching-up", kind: "stale" },
    { name: "while the feed catches up: stale, after 5 min", feed: "catching-up", kind: "stale" },
  ] as const)("never read — $name", ({ feed, kind }) => {
    const state = observe(baseInput({ feed }), NOW + 5 * 60_000);
    expect(state.kind).toBe(kind);
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

  it("observing once a live process is attributed — the step source's pipeline rides on it", () => {
    const appVersion = { status: "BUILDING", build: { pipelineStart: "t1" } };
    const p = process({ started: "2026-09-02T10:00:01.000Z", appVersion });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind).toBe("observing");
    expect(state.kind === "observing" && state.observation.pipeline).toEqual({
      appVersion,
      startedAt: "2026-09-02T10:00:01.000Z",
    });
    expect(state.kind === "observing" && state.observation.chips).toEqual([]);
    expect(state.kind === "observing" && state.observation.outcome).toBeUndefined();
  });

  /**
   * The steps are read off the pipeline where the card renders, against its
   * clock: an observation that carried them would freeze a running step's
   * duration at the moment of the read, and a quiet build changes nothing
   * for minutes.
   */
  it.each([
    { name: "no step source", stepSource: undefined },
    { name: "a step source with no appVersion", stepSource: process({ status: "RUNNING" }) },
    {
      name: "a status the pipeline has no step for",
      stepSource: process({ appVersion: { status: "UPLOADING" } }),
    },
  ])("carries no pipeline for $name", ({ stepSource }) => {
    const state = observe(
      baseInput({
        attribution: {
          ...(stepSource === undefined ? {} : { stepSource }),
          chips: [],
          projectMismatch: false,
        },
      }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation).not.toHaveProperty("pipeline");
  });

  it("chips are the secondary processes only — never the step source", () => {
    const stepSource = process({ id: "p-deploy" });
    const chip = process({ id: "p-subdomain", actionName: "stack.enableSubdomainAccess" });
    const state = observe(
      baseInput({ attribution: { stepSource, chips: [chip], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.chips).toEqual([chip]);
  });

  it("carries the outcome once the attributed process's pipeline is terminal", () => {
    const p = process({ appVersion: { status: "ACTIVE" } });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("finished");
  });

  it("outcome failed for a DEPLOY_FAILED pipeline", () => {
    const p = process({ appVersion: { status: "DEPLOY_FAILED" } });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("failed");
  });

  it("outcome cancelled when the process itself is CANCELED, independent of the appVersion", () => {
    const p = process({ status: "CANCELED", appVersion: { status: "BUILDING" } });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("cancelled");
  });

  /**
   * A kind without an appVersion at all (import's stack.create, subdomain,
   * delete, scale, manage) never gets a pipeline reading — it must still
   * settle off the process's own terminal status, or it ages into
   * off:stale-timeout despite the platform having already finished it.
   */
  it("outcome finished for a FINISHED process with no appVersion (e.g. stack.create)", () => {
    const p = process({ status: "FINISHED", actionName: "stack.create" });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("finished");
  });

  it("outcome failed for a FAILED process with no appVersion", () => {
    const p = process({ status: "FAILED", actionName: "stack.create" });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBe("failed");
  });

  it("no outcome for a still-RUNNING process with no appVersion", () => {
    const p = process({ status: "RUNNING", actionName: "stack.create" });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.outcome).toBeUndefined();
  });

  it.each([
    { feed: "live", kind: "observing" },
    { feed: "connecting", kind: "observing" },
    { feed: "catching-up", kind: "stale" },
  ] as const)(
    "a read observation is $kind while the feed is $feed, however old",
    ({ feed, kind }) => {
      const p = process({ appVersion: { status: "BUILDING" } });
      const state = observe(
        baseInput({ feed, attribution: { stepSource: p, chips: [], projectMismatch: false } }),
        NOW + 10 * 60_000,
      );
      expect(state.kind).toBe(kind);
      expect(state.kind !== "off" && state.observation.pipeline).toBeDefined();
    },
  );

  it("never goes stale once the outcome is set, the feed catching up or not", () => {
    const p = process({ appVersion: { status: "ACTIVE" } });
    const state = observe(
      baseInput({
        feed: "catching-up",
        attribution: { stepSource: p, chips: [], projectMismatch: false },
      }),
      NOW + 5 * 60_000,
    );
    expect(state.kind).toBe("observing");
    expect(state.kind === "observing" && state.observation.outcome).toBe("finished");
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
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
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
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.buildLog).toBeUndefined();
  });

  it("has no build log fromIso when the appVersion has no pipelineStart yet", () => {
    const p = process({
      appVersion: { id: "av-1", status: "BUILDING", build: { serviceStackId: "build-svc-1" } },
    });
    const state = observe(
      baseInput({ attribution: { stepSource: p, chips: [], projectMismatch: false } }),
      NOW,
    );
    expect(state.kind === "observing" && state.observation.buildLog).toEqual({
      buildServiceStackId: "build-svc-1",
      appVersionId: "av-1",
    });
  });
});

// A card reads its operation from the account store until its outcome is
// read: a step read as running stays running under "Deployed" otherwise, and
// a settled row opened after a reload, or in another window, opens onto
// nothing (pass 36).
describe("operationReadCeilingMs — how long after its start a card reads its operation", () => {
  const CEILING = 30 * 60 * 1000;
  it.each([
    { name: "a running one: up to the ceiling", running: true, exact: false, ms: CEILING },
    {
      name: "a running one its result named: followed by its handle until it ends, whatever its age",
      running: true,
      exact: true,
      ms: Number.POSITIVE_INFINITY,
    },
    {
      name: "a settled one with nothing to know it by: up to the ceiling",
      running: false,
      exact: false,
      ms: CEILING,
    },
    {
      name: "a settled one its result named by id: looked up by it, whatever its age",
      running: false,
      exact: true,
      ms: Number.POSITIVE_INFINITY,
    },
  ])("$name", ({ running, exact, ms }) => {
    expect(operationReadCeilingMs({ running, exact })).toBe(ms);
  });
});
