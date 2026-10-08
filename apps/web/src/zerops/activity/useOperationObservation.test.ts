// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";

import type { ProjectActivitySnapshot } from "./useProjectActivity.ts";
import {
  OPERATION_OBSERVATION_CEILING_MS,
  deriveOperationObservation,
  type DeriveOperationObservationInput,
  type ObservationTarget,
} from "./useOperationObservation.ts";

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

function target(overrides: Partial<ObservationTarget> = {}): ObservationTarget {
  return {
    key: "deploy:weatherdash:1",
    kind: "deploy",
    hostnames: ["weatherdash"],
    startedAtMs: NOW,
    running: true,
    ...overrides,
  };
}

const BUILDING = process({
  appVersion: {
    id: "av-1",
    status: "BUILDING",
    build: { pipelineStart: "2026-09-02T10:00:01.000Z", serviceStackId: "svc-build" },
  },
});
const DEPLOYED = process({ status: "FINISHED", appVersion: { id: "av-1", status: "ACTIVE" } });

/** What the store holds of the project, and how its feed stands. */
const held = (
  processes: ReadonlyArray<ActivityProcess> | undefined,
  feed: Partial<ProjectActivitySnapshot> = {},
): ProjectActivitySnapshot => ({ processes, live: true, processHistory: "read", ...feed });
const CATCHING_UP = { live: false, reconnecting: true } as const;
const CONNECTING = { live: false, processHistory: "reading" } as const;

function baseInput(
  overrides: Partial<DeriveOperationObservationInput> = {},
): DeriveOperationObservationInput {
  return {
    target: target(),
    attributable: true,
    notAttributableReason: "no-target",
    serviceIds: ["svc-1"],
    projectId: "proj-1",
    snapshot: held([]),
    ...overrides,
  };
}

const derive = (overrides: Partial<DeriveOperationObservationInput>, nowMs = NOW) =>
  deriveOperationObservation(baseInput(overrides), nowMs);

describe("deriveOperationObservation — what the store holds, as its feed stands", () => {
  it("off: no-target when there is no target at all", () => {
    expect(derive({ target: null }).state).toEqual({ kind: "off", reason: "no-target" });
  });

  it("off with the caller's reason when the operation cannot be attributed", () => {
    expect(derive({ attributable: false, notAttributableReason: "no-session" }).state).toEqual({
      kind: "off",
      reason: "no-session",
    });
  });

  it.each([
    {
      name: "live, a build running: its pipeline and its log",
      snapshot: held([BUILDING]),
      kind: "observing",
      pipeline: true,
    },
    {
      name: "catching up after it was read: what it held, said to be not current",
      snapshot: held([BUILDING], CATCHING_UP),
      kind: "stale",
      pipeline: true,
    },
    {
      name: "catching up, never read: stale with nothing, never an invented off",
      snapshot: held(undefined, CATCHING_UP),
      kind: "stale",
      pipeline: false,
    },
    {
      name: "first connecting, never read: waiting",
      snapshot: held(undefined, CONNECTING),
      kind: "observing",
      pipeline: false,
    },
    {
      name: "settled by the platform while catching up: its outcome stands",
      snapshot: held([DEPLOYED], CATCHING_UP),
      kind: "observing",
      pipeline: true,
    },
  ])("$name", ({ snapshot, kind, pipeline }) => {
    // However long it lasts: the feed's phase decides, never the time since a read.
    for (const nowMs of [NOW + 5_000, NOW + 20 * 60_000]) {
      const { state } = derive({ snapshot }, nowMs);
      expect(state.kind).toBe(kind);
      expect(state.kind !== "off" && state.observation.pipeline !== undefined).toBe(pipeline);
    }
  });

  it("carries the build's log query while the store holds the build", () => {
    expect(derive({ snapshot: held([BUILDING], CATCHING_UP) }).buildLogQuery).toEqual({
      buildServiceStackId: "svc-build",
      appVersionId: "av-1",
      fromIso: "2026-09-02T09:59:56.000Z",
    });
    expect(derive({}).buildLogQuery).toBeUndefined();
  });

  it.each([
    { reason: "expired-session", off: "unauthorized" },
    { reason: "forbidden", off: "unauthorized" },
    { reason: "refused", off: "feed-error" },
  ] as const)("off: the store's $reason refusal reads as $off", ({ reason, off }) => {
    const { state, settledRead } = derive({
      snapshot: held([BUILDING], { live: false, unavailableReason: reason }),
    });
    expect(state).toEqual({ kind: "off", reason: off });
    expect(settledRead).toBe("failed");
  });

  it("off: project-mismatch when what it holds is another project's", () => {
    expect(derive({ snapshot: held([process({ projectId: "other" })]) }).state).toEqual({
      kind: "off",
      reason: "project-mismatch",
    });
  });

  it("off: ceiling past it for one known only by its service and start", () => {
    expect(derive({}, NOW + OPERATION_OBSERVATION_CEILING_MS + 1).state).toEqual({
      kind: "off",
      reason: "ceiling",
    });
    expect(
      derive(
        { target: target({ exact: { appVersionId: "av-1" } }) },
        NOW + OPERATION_OBSERVATION_CEILING_MS + 1,
      ).state.kind,
    ).toBe("observing");
  });

  it.each([
    { history: "read", settled: "read" },
    { history: "reading", settled: "pending" },
    { history: "unread", settled: "pending" },
    { history: "failed", settled: "failed" },
  ] as const)(
    "a settled one's read is $settled while its history is $history",
    ({ history, settled }) => {
      expect(
        derive({
          target: target({ running: false, exact: { appVersionId: "av-1" } }),
          snapshot: held([], { processHistory: history }),
        }).settledRead,
      ).toBe(settled);
    },
  );
});

describe("deriveOperationObservation — a result's own ids pin the attributed process", () => {
  const own = process({ id: "p-own", appVersion: { id: "av-own", status: "ACTIVE" } });
  const later = process({
    id: "p-later",
    created: "2026-09-02T10:00:30.000Z",
    appVersion: { id: "av-later", status: "BUILDING", build: { pipelineStart: "t1" } },
  });

  it.each([
    { name: "no ids: the newest in the window", exact: undefined, outcome: undefined },
    {
      name: "the shipped version: that process",
      exact: { appVersionId: "av-own" },
      outcome: "finished",
    },
  ])("$name", ({ exact, outcome }) => {
    const { state } = derive({
      target: target(exact === undefined ? {} : { exact }),
      snapshot: held([own, later]),
    });
    expect(state.kind !== "off" && state.observation.outcome).toBe(outcome);
  });
});

it("a reopened restart reads its terminal history by process identity while its service is running", () => {
  const failed = process({
    id: "restart",
    actionName: "stack.restart",
    status: "FAILED",
    created: "2026-09-01T10:00:00Z",
    finished: "2026-09-01T10:15:00Z",
  });
  const later = process({ id: "later", actionName: "stack.restart", status: "RUNNING" });
  const result = derive({
    target: target({
      kind: "manage",
      running: false,
      startedAtMs: Date.parse(failed.created),
      exact: { processIds: [failed.id] },
    }),
    snapshot: held([later, failed]),
  });
  expect(result.settledRead).toBe("read");
  expect(result.state).toMatchObject({
    kind: "observing",
    observation: { process: failed, outcome: "failed" },
  });
});
