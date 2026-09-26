// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  Observation,
  ObservationState,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const browserStreamSpy = vi.hoisted(() => vi.fn<() => unknown>(() => undefined));
const topologySpy = vi.hoisted(() => vi.fn<() => unknown>(() => undefined));

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
  useZeropsTopology: topologySpy,
  useZeropsBrowserStream: browserStreamSpy,
}));

vi.mock("../useNowMs.ts", () => ({
  useSecondsNowMs: () => Date.parse("2026-09-01T00:00:42.000Z"),
}));

const observationSpy = vi.hoisted(() =>
  vi.fn<() => unknown>(() => ({
    state: { kind: "off", reason: "not-found" },
    history: undefined,
    buildLog: { status: "idle", lines: [] },
  })),
);

vi.mock("./useOperationObservation.ts", () => ({
  useOperationObservation: observationSpy,
}));

import {
  browserScreenshotFor,
  browserSubjectHostFor,
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
    target: { hostname: "weatherdash" },
    hasResult: false,
    ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    chips: [],
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

  it.each([
    { name: "nothing named yet", fields: {}, exact: undefined },
    {
      name: "the version a deploy shipped",
      fields: { version: { id: "av-1", name: "abc123" } },
      exact: { appVersionId: "av-1" },
    },
    {
      name: "a version name alone pins nothing",
      fields: { version: { name: "abc123" } },
      exact: undefined,
    },
    {
      name: "the processes an import started",
      fields: { kind: "import" as const, processIds: ["p-1", "p-2"] },
      exact: { processIds: ["p-1", "p-2"] },
    },
  ])("the result's own ids pin the observation: $name", ({ fields, exact }) => {
    expect(observationTargetFor(operation({ phase: "done", ...fields }))?.exact).toEqual(exact);
  });

  it("a batch deploy has no target: its per-target rows stand from birth to settle", () => {
    expect(observationTargetFor(operation({ batch: true, subject: "api, web" }))).toBeNull();
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

describe("browserSubjectHostFor — the service a checked page belongs to", () => {
  const kanbandev = {
    hostname: "kanbandev",
    serviceId: "svc-1",
    type: "nodejs@22",
    status: "ACTIVE",
    group: "runtimes",
    transient: false,
    subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
    ports: [],
    routes: [
      {
        port: 3000,
        url: "https://kanbandev-26a7-3000.prg1.zerops.app",
        host: "kanbandev-26a7-3000.prg1.zerops.app",
      },
      {
        port: 8080,
        url: "https://kanbandev-26a7-8080.prg1.zerops.app",
        host: "kanbandev-26a7-8080.prg1.zerops.app",
      },
    ],
  } as const satisfies ZeropsTopologyView["services"][number];
  const browser = (subject: string) => operation({ kind: "browser", subject });

  it.each([
    {
      name: "a route's host names its service",
      operation: browser("https://kanbandev-26a7-8080.prg1.zerops.app/cz/products?x=1"),
      view: topology({ services: [kanbandev] }),
      host: "kanbandev",
    },
    {
      name: "a host no service answers stays unresolved",
      operation: browser("https://example.com/cz"),
      view: topology({ services: [kanbandev] }),
      host: undefined,
    },
    {
      name: "before the topology view loads",
      operation: browser("https://kanbandev-26a7-3000.prg1.zerops.app/"),
      view: undefined,
      host: undefined,
    },
    {
      name: "before the URL arrives",
      operation: browser("the page"),
      view: topology({ services: [kanbandev] }),
      host: undefined,
    },
    {
      name: "a kind that is not a browser check",
      operation: operation({
        kind: "deploy",
        subject: "https://kanbandev-26a7-3000.prg1.zerops.app",
      }),
      view: topology({ services: [kanbandev] }),
      host: undefined,
    },
  ])("$name", ({ operation: op, view, host }) => {
    expect(browserSubjectHostFor(op, view)).toBe(host);
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

/** A build 42 s in at `NOW`: its container took 4 s, its commands have run 38 s. */
const BUILDING: Observation["pipeline"] = {
  appVersion: {
    status: "BUILDING",
    build: {
      pipelineStart: "2026-09-01T00:00:00.000Z",
      startDate: "2026-09-01T00:00:04.000Z",
    },
  },
};

describe("deriveObservedStepsRegion — mapping ObservationState to the card's region", () => {
  it("observing a live feed: the pipeline's steps, and nothing said about the feed", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({ pipeline: BUILDING, readAtMs: NOW }),
      elapsedMs: 42_000,
    };
    const region = deriveObservedStepsRegion("import", "running", state, undefined, NOW);

    expect(region).toEqual({
      steps: [
        {
          id: "INIT_BUILD_CONTAINER",
          label: "Build container",
          state: "done",
          stateLabel: "Done",
          durationMs: 4_000,
        },
        {
          id: "RUN_BUILD_COMMANDS",
          label: "Build",
          state: "running",
          stateLabel: "Running",
          durationMs: 38_000,
        },
        {
          id: "INIT_PREPARE_CONTAINER",
          label: "Prepare container",
          state: "queued",
          stateLabel: "Queued",
        },
        {
          id: "RUN_PREPARE_COMMANDS",
          label: "Prepare runtime",
          state: "queued",
          stateLabel: "Queued",
        },
        { id: "DEPLOY", label: "Deploy", state: "queued", stateLabel: "Queued" },
      ],
      chips: [],
      provenance: "",
    });
  });

  it("a running step's duration is the render clock's, never the read's", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({ pipeline: BUILDING, readAtMs: NOW }),
      elapsedMs: 42_000,
    };
    const buildAt = (nowMs: number) =>
      deriveObservedStepsRegion("import", "running", state, undefined, nowMs)?.steps.find(
        (entry) => entry.id === "RUN_BUILD_COMMANDS",
      )?.durationMs;

    expect([buildAt(NOW), buildAt(NOW + 60_000)]).toEqual([38_000, 98_000]);
  });

  it("carries the build log query for the caller to attach a log", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({
        pipeline: BUILDING,
        buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
      }),
      elapsedMs: 42_000,
    };
    const region = deriveObservedStepsRegion("import", "running", state, undefined, NOW);

    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });

  it("observing before the first read (no pipeline, no chips): undefined — the card shows its own body", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation(),
      elapsedMs: 2_000,
    };
    expect(deriveObservedStepsRegion("import", "running", state, undefined, NOW)).toBeUndefined();
  });

  it("off with nothing seen: undefined, regardless of reason", () => {
    const state: ObservationState = { kind: "off", reason: "not-found" };
    expect(deriveObservedStepsRegion("import", "running", state, undefined, NOW)).toBeUndefined();
  });

  it.each([
    {
      name: "stale",
      state: {
        kind: "stale",
        observation: observation({ pipeline: BUILDING, readAtMs: NOW - 12_000 }),
        ageMs: 12_000,
      } as const,
      provenance: "Zerops isn't answering · last update 12s ago",
    },
    {
      name: "off past its timeout",
      state: { kind: "off", reason: "stale-timeout" } as const,
      provenance: "Zerops isn't answering · last update 2m 5s ago",
    },
    {
      name: "off, the feed failed",
      state: { kind: "off", reason: "feed-error" } as const,
      provenance: "Zerops isn't answering · last update 2m 5s ago",
    },
    {
      name: "off past the ceiling: it stopped looking, Zerops did not stop answering",
      state: { kind: "off", reason: "ceiling" } as const,
      provenance: "",
    },
    {
      name: "observing, nothing new for this card yet",
      state: { kind: "observing", observation: observation(), elapsedMs: 2_000 } as const,
      provenance: "",
    },
  ])("a feed that is not observing says so, once: $name", ({ state, provenance }) => {
    const history = observation({ pipeline: BUILDING, readAtMs: NOW - 125_000 });
    const region = deriveObservedStepsRegion("import", "running", state, history, NOW);
    expect(region?.provenance).toBe(provenance);
  });

  it("settled operation with history: the history's steps and log stay, with no provenance", () => {
    const state: ObservationState = { kind: "off", reason: "ceiling" };
    const history = observation({
      pipeline: BUILDING,
      buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
    });
    const region = deriveObservedStepsRegion("import", "done", state, history, NOW);

    expect(region?.steps).toHaveLength(5);
    expect(region?.provenance).toBe("");
    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });

  it("settled operation, no history at all: undefined", () => {
    const state: ObservationState = { kind: "off", reason: "ceiling" };
    expect(deriveObservedStepsRegion("import", "failed", state, undefined, NOW)).toBeUndefined();
  });

  it("a settled operation prefers its history over a live state that might still be computing", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({ pipeline: { appVersion: { status: "DEPLOYING" } } }),
      elapsedMs: 0,
    };
    const history = observation({ pipeline: BUILDING });
    const region = deriveObservedStepsRegion("import", "done", state, history, NOW);
    expect(region?.steps.find((entry) => entry.state === "running")?.id).toBe("RUN_BUILD_COMMANDS");
  });
});

describe("deriveObservedStepsRegion — secondary processes ride as compact rows", () => {
  const subdomainChip: ActivityProcess = {
    id: "p-subdomain",
    projectId: "proj-1",
    serviceStackIds: ["svc-1"],
    status: "RUNNING",
    actionName: "stack.enableSubdomainAccess",
    created: "2026-09-01T00:00:01.000Z",
  };
  const chipRow = {
    id: "p-subdomain",
    label: "Enable subdomain access",
    state: "running",
    stateLabel: "Running",
  };

  it.each([
    {
      name: "running, beside observed steps",
      kind: "deploy" as const,
      phase: "running" as const,
      state: {
        kind: "observing",
        observation: observation({ pipeline: BUILDING, chips: [subdomainChip] }),
        elapsedMs: 2_000,
      } as const,
      history: undefined,
    },
    {
      name: "running, a kind with no pipeline steps at all",
      kind: "scale" as const,
      phase: "running" as const,
      state: {
        kind: "observing",
        observation: observation({ chips: [subdomainChip] }),
        elapsedMs: 2_000,
      } as const,
      history: undefined,
    },
    {
      name: "settled, frozen with the history",
      kind: "deploy" as const,
      phase: "done" as const,
      state: { kind: "off", reason: "ceiling" } as const,
      history: observation({ pipeline: BUILDING, chips: [subdomainChip] }),
    },
  ])("$name", ({ kind, phase, state, history }) => {
    const region = deriveObservedStepsRegion(kind, phase, state, history, NOW);
    expect(region?.chips).toEqual([chipRow]);
  });
});

describe("deriveObservedStepsRegion — steps once seen never leave a running card", () => {
  it.each([
    { name: "the feed goes off", state: { kind: "off", reason: "stale-timeout" } as const },
    {
      name: "a read attributes nothing yet",
      state: {
        kind: "observing",
        observation: observation(),
        elapsedMs: 2_000,
      } as const,
    },
  ])("$name: the last observed steps stay", ({ state }) => {
    const history = observation({ pipeline: BUILDING, readAtMs: NOW - 70_000 });
    const region = deriveObservedStepsRegion("import", "running", state, history, NOW);

    expect(region?.steps.find((entry) => entry.state === "running")?.id).toBe("RUN_BUILD_COMMANDS");
  });
});

describe("deriveObservedStepsRegion — the build log once shown stays while the deploy runs", () => {
  it("the feed goes off: the history's build log query rides on", () => {
    const history = observation({
      pipeline: BUILDING,
      buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
    });
    const region = deriveObservedStepsRegion(
      "deploy",
      "running",
      { kind: "off", reason: "stale-timeout" },
      history,
      NOW,
    );
    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });
});

describe("deriveObservedStepsRegion — a deploy holds its five pipeline slots from birth", () => {
  const SLOT_IDS = [
    "INIT_BUILD_CONTAINER",
    "RUN_BUILD_COMMANDS",
    "INIT_PREPARE_CONTAINER",
    "RUN_PREPARE_COMMANDS",
    "DEPLOY",
  ];
  const before: ObservationState = {
    kind: "observing",
    observation: observation(),
    elapsedMs: 2_000,
  };
  const off: ObservationState = { kind: "off", reason: "no-target" };
  const building: ObservationState = {
    kind: "observing",
    observation: observation({ pipeline: BUILDING, readAtMs: NOW }),
    elapsedMs: 42_000,
  };

  it.each([
    { name: "before the first read", state: before },
    { name: "with the feed off", state: off },
  ])("$name: no region — the card draws the operation's own five slots", ({ state }) => {
    expect(deriveObservedStepsRegion("deploy", "running", state, undefined, NOW)).toBeUndefined();
  });

  it("once the build runs: five slots, the observed one filled in place", () => {
    const region = deriveObservedStepsRegion("deploy", "running", building, undefined, NOW);

    expect(region?.steps.map((slot) => slot.id)).toEqual(SLOT_IDS);
    expect(region?.steps.filter((slot) => slot.state === "running").map((slot) => slot.id)).toEqual(
      ["RUN_BUILD_COMMANDS"],
    );
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

describe("useOperationCard — a build log opened while live stays open at settle (hook)", () => {
  const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
  const history = observation({
    pipeline: BUILDING,
    buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
  });
  const observed = (status: string) => ({
    state: { kind: "off", reason: "stale-timeout" },
    history,
    buildLog: { status, lines: [] },
  });

  beforeEach(() => {
    hooks.reset();
  });

  it("stays open once the deploy settles and the log is no longer live", () => {
    observationSpy.mockReturnValueOnce(observed("live"));
    hooks.beginRender();
    const running = useOperationCard(operation({ phase: "running" }), ENVIRONMENT_ID);
    observationSpy.mockReturnValueOnce(observed("ended"));
    hooks.beginRender();
    const settled = useOperationCard(operation({ phase: "done" }), ENVIRONMENT_ID);

    const openOf = (region: typeof running) =>
      (region.observed?.log as { props: { open: boolean } } | undefined)?.props.open;
    expect([openOf(running), openOf(settled)]).toEqual([true, true]);
  });
});

describe("useOperationCard — the browser check's subject host (hook)", () => {
  const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

  beforeEach(() => {
    hooks.reset();
    topologySpy.mockReset();
  });

  it.each([
    {
      name: "a page on a service's route carries that service's hostname",
      view: topology({
        services: [
          {
            hostname: "kanbandev",
            serviceId: "svc-1",
            type: "nodejs@22",
            status: "ACTIVE",
            group: "runtimes",
            transient: false,
            ports: [],
            routes: [
              {
                port: 3000,
                url: "https://kanbandev-26a7-3000.prg1.zerops.app",
                host: "kanbandev-26a7-3000.prg1.zerops.app",
              },
            ],
          },
        ],
      }),
      subjectHost: "kanbandev",
    },
    { name: "no topology yet: no subjectHost at all", view: undefined, subjectHost: undefined },
  ])("$name", ({ view, subjectHost }) => {
    topologySpy.mockReturnValue(view);
    hooks.beginRender();
    const region = useOperationCard(
      operation({ kind: "browser", subject: "https://kanbandev-26a7-3000.prg1.zerops.app/cz" }),
      ENVIRONMENT_ID,
    );
    expect(region.subjectHost).toBe(subjectHost);
    expect("subjectHost" in region).toBe(subjectHost !== undefined);
  });
});
