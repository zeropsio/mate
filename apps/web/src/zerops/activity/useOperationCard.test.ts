// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  Observation,
  ObservationState,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { ObservedStep } from "@t3tools/client-runtime/zerops/activity/observedSteps";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const browserStreamSpy = vi.hoisted(() => vi.fn<() => unknown>(() => undefined));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../useZeropsFeeds.ts", () => ({
  useZeropsTopology: () => undefined,
  useZeropsBrowserStream: browserStreamSpy,
}));

vi.mock("./useOperationObservation.ts", () => ({
  useOperationObservation: () => ({
    state: { kind: "off", reason: "not-found" },
    history: undefined,
    buildLog: { status: "idle", lines: [] },
  }),
}));

import {
  browserScreenshotFor,
  deriveObservedStepsRegion,
  devServerUrlFor,
  isBrowserOperationLive,
  observationTargetFor,
  useOperationCard,
} from "./useOperationCard.ts";

const NOW = Date.parse("2026-09-01T00:00:42.000Z");

function operation(overrides: Partial<ZeropsOperation> = {}): ZeropsOperation {
  return {
    key: "call:e1",
    kind: "deploy",
    phase: "running",
    anchorAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: "e1",
    turnId: "t1",
    subject: "weatherdash",
    kicker: "DEPLOY · WEATHERDASH",
    voice: "Deploying weatherdash…",
    voiceSource: "mate",
    statusWord: "Deploying",
    steps: [],
    links: [],
    callIds: ["e1"],
    attempts: 1,
    target: { hostname: "weatherdash" },
    hasResult: false,
    ...overrides,
  };
}

function step(overrides: Partial<ObservedStep> = {}): ObservedStep {
  return {
    id: "RUN_BUILD_COMMANDS",
    label: "Build",
    state: "running",
    stateLabel: "Running",
    durationMs: 38_000,
    ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    steps: [],
    processes: [],
    readAtMs: NOW,
    ...overrides,
  };
}

describe("observationTargetFor — building the ObservationTarget from an operation", () => {
  it("deploy: kind, hostnames from target.hostname, startedAtMs, running", () => {
    const target = observationTargetFor(
      operation({ kind: "deploy", phase: "running", anchorAt: "2026-09-01T00:00:00.000Z" }),
    );
    expect(target).toEqual({
      key: "call:e1",
      kind: "deploy",
      hostnames: ["weatherdash"],
      startedAtMs: Date.parse("2026-09-01T00:00:00.000Z"),
      running: true,
    });
  });

  it("import: hostnames split from subject on ', ' — an import can name several services", () => {
    const target = observationTargetFor(
      operation({ kind: "import", subject: "weatherdash, mariadb" }),
    );
    expect(target?.hostnames).toEqual(["weatherdash", "mariadb"]);
  });

  it("a settled operation carries running: false", () => {
    const target = observationTargetFor(operation({ phase: "done" }));
    expect(target?.running).toBe(false);
  });

  it("a non-observed kind (verify) has no target at all", () => {
    expect(observationTargetFor(operation({ kind: "verify" }))).toBeNull();
  });

  it("bootstrap, mount, env and error are also not observed", () => {
    for (const kind of ["bootstrap", "mount", "env", "error"] as const) {
      expect(observationTargetFor(operation({ kind }))).toBeNull();
    }
  });
});

function topology(overrides: Partial<ZeropsTopologyView> = {}): ZeropsTopologyView {
  return {
    project: { id: "proj-1", name: "z3-eval" },
    services: [],
    warnings: [],
    usageRead: false,
    ...overrides,
  };
}

describe("browserScreenshotFor — the thumbnail from a browser operation's own screenshot", () => {
  it("resolves the screenshot for a browser operation that has one", () => {
    const screenshot = { src: "data:image/jpeg;base64,AAAA", width: 640, height: 360 };
    expect(browserScreenshotFor(operation({ kind: "browser", screenshot }))).toEqual(screenshot);
  });

  it("is undefined for a browser operation with no screenshot", () => {
    expect(browserScreenshotFor(operation({ kind: "browser" }))).toBeUndefined();
  });

  it("is undefined for a non-browser operation even if it somehow carried a screenshot field", () => {
    const screenshot = { src: "data:image/jpeg;base64,AAAA" };
    expect(browserScreenshotFor(operation({ kind: "deploy", screenshot }))).toBeUndefined();
  });
});

describe("devServerUrlFor — the Open link from the topology view", () => {
  it("resolves the dev-server Open link from the topology view by hostname", () => {
    const view = topology({
      services: [
        {
          hostname: "apidev",
          serviceId: "svc-1",
          type: "nodejs@22",
          status: "ACTIVE",
          group: "runtimes",
          transient: false,
          subdomainUrl: "https://apidev-26a7-3000.prg1.zerops.app",
          ports: [],
          routes: [],
        },
      ],
    });
    const op = operation({ kind: "devServer", target: { hostname: "apidev" } });
    expect(devServerUrlFor(op, view)).toBe("https://apidev-26a7-3000.prg1.zerops.app");
  });

  it("is undefined for a non-devServer operation, even with a matching service", () => {
    const view = topology({
      services: [
        {
          hostname: "weatherdash",
          serviceId: "svc-1",
          type: "nodejs@22",
          status: "ACTIVE",
          group: "runtimes",
          transient: false,
          subdomainUrl: "https://weatherdash-26a7.prg1.zerops.app",
          ports: [],
          routes: [],
        },
      ],
    });
    const op = operation({ kind: "deploy", target: { hostname: "weatherdash" } });
    expect(devServerUrlFor(op, view)).toBeUndefined();
  });

  it("is undefined when the topology view has not loaded yet", () => {
    const op = operation({ kind: "devServer", target: { hostname: "apidev" } });
    expect(devServerUrlFor(op, undefined)).toBeUndefined();
  });

  it("is undefined when no service in the topology matches the operation's hostname", () => {
    const view = topology({
      services: [
        {
          hostname: "other",
          serviceId: "svc-2",
          type: "nodejs@22",
          status: "ACTIVE",
          group: "runtimes",
          transient: false,
          ports: [],
          routes: [],
        },
      ],
    });
    const op = operation({ kind: "devServer", target: { hostname: "apidev" } });
    expect(devServerUrlFor(op, view)).toBeUndefined();
  });

  it("is undefined when the matching service has no subdomainUrl", () => {
    const view = topology({
      services: [
        {
          hostname: "apidev",
          serviceId: "svc-1",
          type: "nodejs@22",
          status: "ACTIVE",
          group: "runtimes",
          transient: false,
          ports: [],
          routes: [],
        },
      ],
    });
    const op = operation({ kind: "devServer", target: { hostname: "apidev" } });
    expect(devServerUrlFor(op, view)).toBeUndefined();
  });
});

describe("deriveObservedStepsRegion — mapping ObservationState to the card's region", () => {
  it("observing, non-empty steps: maps steps and writes a live provenance line", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({ steps: [step()], readAtMs: NOW - 2_000 }),
      elapsedMs: 42_000,
    };
    const region = deriveObservedStepsRegion("running", state, undefined, NOW);

    expect(region).toEqual({
      steps: [
        {
          id: "RUN_BUILD_COMMANDS",
          label: "Build",
          state: "running",
          stateLabel: "Running",
          durationMs: 38_000,
        },
      ],
      provenance: "live from Zerops · 2 s ago",
    });
  });

  it("observing, non-empty steps, with a build log query: carries buildLogQuery for the caller to attach a log", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({
        steps: [step()],
        readAtMs: NOW,
        buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
      }),
      elapsedMs: 42_000,
    };
    const region = deriveObservedStepsRegion("running", state, undefined, NOW);

    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });

  it("observing before the first read (empty steps): undefined — the card shows its own steps and clock", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({ steps: [] }),
      elapsedMs: 2_000,
    };
    expect(deriveObservedStepsRegion("running", state, undefined, NOW)).toBeUndefined();
  });

  it("off: undefined, regardless of reason", () => {
    const state: ObservationState = { kind: "off", reason: "not-found" };
    expect(deriveObservedStepsRegion("running", state, undefined, NOW)).toBeUndefined();
  });

  it("stale: 'last read N s ago' instead of the live wording", () => {
    const state: ObservationState = {
      kind: "stale",
      observation: observation({ steps: [step()], readAtMs: NOW - 12_000 }),
      ageMs: 12_000,
    };
    const region = deriveObservedStepsRegion("running", state, undefined, NOW);
    expect(region?.provenance).toBe("last read 12 s ago");
  });

  it("settled operation with history: the history's steps stay, no provenance line, no log", () => {
    const state: ObservationState = { kind: "off", reason: "ceiling" };
    const history = observation({
      steps: [step({ state: "done", stateLabel: "Done", durationMs: 52_000 })],
      buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
    });
    const region = deriveObservedStepsRegion("done", state, history, NOW);

    expect(region).toEqual({
      steps: [
        {
          id: "RUN_BUILD_COMMANDS",
          label: "Build",
          state: "done",
          stateLabel: "Done",
          durationMs: 52_000,
        },
      ],
      provenance: "",
    });
    expect(region?.buildLogQuery).toBeUndefined();
  });

  it("settled operation, no history at all: undefined", () => {
    const state: ObservationState = { kind: "off", reason: "ceiling" };
    expect(deriveObservedStepsRegion("failed", state, undefined, NOW)).toBeUndefined();
  });

  it("a settled operation prefers its history over a live state that might still be computing", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({ steps: [step({ id: "DEPLOY", label: "Deploy" })] }),
      elapsedMs: 0,
    };
    const history = observation({ steps: [step({ id: "RUN_BUILD_COMMANDS", label: "Build" })] });
    const region = deriveObservedStepsRegion("done", state, history, NOW);
    expect(region?.steps).toEqual([
      expect.objectContaining({ id: "RUN_BUILD_COMMANDS", label: "Build" }),
    ]);
  });
});

describe("isBrowserOperationLive", () => {
  it("true only for a browser operation whose own call is still running", () => {
    expect(isBrowserOperationLive(operation({ kind: "browser", phase: "running" }))).toBe(true);
    expect(isBrowserOperationLive(operation({ kind: "browser", phase: "done" }))).toBe(false);
    expect(isBrowserOperationLive(operation({ kind: "browser", phase: "failed" }))).toBe(false);
    expect(isBrowserOperationLive(operation({ kind: "deploy", phase: "running" }))).toBe(false);
  });
});

describe("useOperationCard — the browser card's live viewport (hook)", () => {
  const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
  const FRAME = { type: "frame" as const, data: "AAAA", width: 640, height: 360 };

  beforeEach(() => {
    hooks.reset();
    browserStreamSpy.mockReset();
    browserStreamSpy.mockReturnValue(undefined);
  });

  it("subscribes to the browser feed only for an in-progress browser call, once per thread", () => {
    hooks.beginRender();
    useOperationCard(operation({ kind: "browser", phase: "done" }), ENVIRONMENT_ID);
    expect(browserStreamSpy).toHaveBeenLastCalledWith(null);

    hooks.beginRender();
    useOperationCard(operation({ kind: "deploy", phase: "running" }), ENVIRONMENT_ID);
    expect(browserStreamSpy).toHaveBeenLastCalledWith(null);

    hooks.beginRender();
    useOperationCard(operation({ kind: "browser", phase: "running" }), ENVIRONMENT_ID);
    expect(browserStreamSpy).toHaveBeenLastCalledWith(ENVIRONMENT_ID);
    expect(browserStreamSpy).toHaveBeenCalledTimes(3);
  });

  it("passes the latest frame as liveFrame while the call is running, and live: true", () => {
    browserStreamSpy.mockReturnValue({ status: "live", frame: FRAME });
    hooks.beginRender();
    const region = useOperationCard(
      operation({ kind: "browser", phase: "running" }),
      ENVIRONMENT_ID,
    );
    expect(region.live).toBe(true);
    expect(region.liveFrame).toEqual({
      src: "data:image/jpeg;base64,AAAA",
      width: 640,
      height: 360,
    });
  });

  it("keeps the last frame once the call completes, so a result without a screenshot still shows it", () => {
    const running = operation({ key: "call:brw1", kind: "browser", phase: "running" });
    browserStreamSpy.mockReturnValue({ status: "live", frame: FRAME });
    hooks.beginRender();
    useOperationCard(running, ENVIRONMENT_ID);

    const done = operation({ key: "call:brw1", kind: "browser", phase: "done" });
    browserStreamSpy.mockReturnValue(undefined);
    hooks.beginRender();
    const region = useOperationCard(done, ENVIRONMENT_ID);

    expect(region.live).toBe(false);
    expect(region.liveFrame).toEqual({
      src: "data:image/jpeg;base64,AAAA",
      width: 640,
      height: 360,
    });
  });

  it("never carries a remembered frame across two different browser operations", () => {
    const first = operation({ key: "call:brw1", kind: "browser", phase: "running" });
    browserStreamSpy.mockReturnValue({ status: "live", frame: FRAME });
    hooks.beginRender();
    useOperationCard(first, ENVIRONMENT_ID);

    const second = operation({ key: "call:brw2", kind: "browser", phase: "done" });
    browserStreamSpy.mockReturnValue(undefined);
    hooks.beginRender();
    const region = useOperationCard(second, ENVIRONMENT_ID);

    expect(region.liveFrame).toBeUndefined();
  });

  it("carries neither live nor liveFrame for a non-browser operation", () => {
    hooks.beginRender();
    const region = useOperationCard(
      operation({ kind: "deploy", phase: "running" }),
      ENVIRONMENT_ID,
    );
    expect(region.live).toBeUndefined();
    expect(region.liveFrame).toBeUndefined();
  });
});
