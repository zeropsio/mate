// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  Observation,
  ObservationState,
  ObservedPipeline,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { readPipeline } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const browserStreamSpy = vi.hoisted(() =>
  vi.fn<() => unknown>(() => ({ kind: "unknown", frame: null, freshness: "unknown" })),
);
const topologySpy = vi.hoisted(() => vi.fn<() => unknown>(() => undefined));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useEffect: reactHookHarness.useEffect,
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
}));

vi.mock("../browserStreamLinks.tsx", () => ({ useMateBrowserCallFrame: browserStreamSpy }));

vi.mock("../useNowMs.ts", () => ({
  useSecondsNowMs: () => Date.parse("2026-09-01T00:00:42.000Z"),
}));

const observationSpy = vi.hoisted(() =>
  vi.fn<() => unknown>(() => ({
    state: { kind: "off", reason: "not-found" },
    buildLog: { status: "idle", lines: [] },
    settledRead: "pending",
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
  pipelineServiceFor,
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
  return { chips: [], ...overrides };
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

  it("a settled deploy its result named carries running: false and those ids", () => {
    const target = observationTargetFor(
      operation({ phase: "done", version: { id: "av-1", name: "abc123" } }),
    );
    expect(target?.running).toBe(false);
    expect(target?.exact).toEqual({ appVersionId: "av-1" });
  });

  // A settled operation is read only by the ids its result named, and only a
  // deploy: a guess by time and service took a later deploy's pipeline (pass 36).
  it.each([
    { name: "a deploy that named nothing", fields: {} },
    { name: "a deploy that named only its version's name", fields: { version: { name: "abc" } } },
    { name: "a failed deploy that named nothing", fields: { phase: "failed" as const } },
    { name: "an import, named or not", fields: { kind: "import" as const, processIds: ["p-1"] } },
    { name: "a subdomain toggle", fields: { kind: "subdomain" as const, processIds: ["p-1"] } },
    { name: "a scale", fields: { kind: "scale" as const } },
  ])("a settled one with no read: $name", ({ fields }) => {
    expect(observationTargetFor(operation({ phase: "done", ...fields }))).toBeNull();
  });

  it("a running one is read by its services, whatever its result named", () => {
    expect(
      observationTargetFor(operation({ kind: "import", processIds: ["p-1", "p-2"] }))?.exact,
    ).toEqual({ processIds: ["p-1", "p-2"] });
  });

  // A batch's card follows the service the platform says is building; once
  // settled it is read by the versions its entries named, or not at all.
  it.each([
    {
      name: "running: by all its services",
      fields: {},
      target: { hostnames: ["api", "web"], batch: true, running: true },
    },
    {
      name: "settled, its entries' versions named: by those",
      fields: { phase: "done" as const, appVersionIds: ["av-a", "av-w"] },
      target: { batch: true, running: false, exact: { appVersionIds: ["av-a", "av-w"] } },
    },
    { name: "settled, none named: not read", fields: { phase: "done" as const }, target: null },
  ])("a batch deploy $name", ({ fields, target }) => {
    const batch = operation({
      batch: true,
      subject: "api, web",
      steps: ["api", "web"].map((host) => ({
        id: host,
        label: host,
        state: "running" as const,
        stateLabel: "Running",
      })),
      ...fields,
    });
    const built = observationTargetFor(batch);
    if (target === null) expect(built).toBeNull();
    else expect(built).toMatchObject(target);
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
const BUILDING: ObservedPipeline = {
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
      observation: observation({ pipeline: BUILDING }),
      elapsedMs: 42_000,
    };
    const region = deriveObservedStepsRegion("import", "running", state, NOW);

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
      observation: observation({ pipeline: BUILDING }),
      elapsedMs: 42_000,
    };
    const buildAt = (nowMs: number) =>
      deriveObservedStepsRegion("import", "running", state, nowMs)?.steps.find(
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
    const region = deriveObservedStepsRegion("import", "running", state, NOW);

    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });

  it("observing before the first read (no pipeline, no chips): undefined — the card shows its own body", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation(),
      elapsedMs: 2_000,
    };
    expect(deriveObservedStepsRegion("import", "running", state, NOW)).toBeUndefined();
  });

  // A running card that holds nothing says so while the feed catches up or failed, as the feed's
  // phase says, never after a timer.
  it.each([
    {
      name: "the feed catches up",
      state: { kind: "stale", observation: observation() } as const,
    },
    { name: "the feed failed", state: { kind: "off", reason: "feed-error" } as const },
  ])("nothing held, $name: it says Zerops isn't answering", ({ state }) => {
    expect(deriveObservedStepsRegion("import", "running", state, NOW)).toEqual({
      steps: [],
      chips: [],
      provenance: "Zerops isn't answering",
    });
  });

  it("off with nothing seen, for another reason: undefined", () => {
    const state: ObservationState = { kind: "off", reason: "not-found" };
    expect(deriveObservedStepsRegion("import", "running", state, NOW)).toBeUndefined();
  });

  it.each([
    {
      name: "catching up: what it holds, said once",
      state: { kind: "stale", observation: observation({ pipeline: BUILDING }) } as const,
      provenance: "Zerops isn't answering",
    },
    {
      name: "observing: nothing said",
      state: {
        kind: "observing",
        observation: observation({ pipeline: BUILDING }),
        elapsedMs: 2_000,
      } as const,
      provenance: "",
    },
  ])("a running card's feed: $name", ({ state, provenance }) => {
    const region = deriveObservedStepsRegion("import", "running", state, NOW);
    expect(region?.provenance).toBe(provenance);
    expect(region?.steps.find((entry) => entry.state === "running")?.id).toBe("RUN_BUILD_COMMANDS");
  });

  it("settled with its outcome read: its steps and log, with no provenance", () => {
    const state: ObservationState = {
      kind: "stale",
      observation: observation({
        pipeline: BUILDING,
        outcome: "finished",
        buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
      }),
    };
    const region = deriveObservedStepsRegion("import", "done", state, NOW);

    expect(region?.steps).toHaveLength(5);
    expect(region?.provenance).toBe("");
    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });

  // A mid-run row held while the feed catches up is never drawn as live under the verdict: its
  // steps leave, what it named of the build stays (pass 36).
  it("settled, only a mid-run row held while catching up: its log, never its steps", () => {
    const state: ObservationState = {
      kind: "stale",
      observation: observation({
        pipeline: BUILDING,
        buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
      }),
    };
    const region = deriveObservedStepsRegion("deploy", "done", state, NOW);
    expect(region?.pipeline).toBeUndefined();
    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });

  it("settled operation, nothing held: undefined", () => {
    const state: ObservationState = { kind: "off", reason: "ceiling" };
    expect(deriveObservedStepsRegion("import", "failed", state, NOW)).toBeUndefined();
  });

  it("a settled operation whose build still runs draws what the store holds", () => {
    const state: ObservationState = {
      kind: "observing",
      observation: observation({ pipeline: { appVersion: { status: "DEPLOYING" } } }),
      elapsedMs: 0,
    };
    const region = deriveObservedStepsRegion("import", "done", state, NOW);
    expect(region?.steps.find((entry) => entry.state === "running")?.id).toBe("DEPLOY");
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
      observation: observation({ pipeline: BUILDING, chips: [subdomainChip] }),
    },
    {
      name: "running, a kind with no pipeline steps at all",
      kind: "scale" as const,
      phase: "running" as const,
      observation: observation({ chips: [subdomainChip] }),
    },
    {
      name: "settled, its outcome read",
      kind: "deploy" as const,
      phase: "done" as const,
      observation: observation({ pipeline: BUILDING, chips: [subdomainChip], outcome: "finished" }),
    },
  ])("$name", ({ kind, phase, observation: held }) => {
    const state: ObservationState = { kind: "observing", observation: held, elapsedMs: 2_000 };
    expect(deriveObservedStepsRegion(kind, phase, state, NOW)?.chips).toEqual([chipRow]);
  });
});

describe("deriveObservedStepsRegion — the build log rides on while the feed catches up", () => {
  it("a running deploy keeps its build log query", () => {
    const region = deriveObservedStepsRegion(
      "deploy",
      "running",
      {
        kind: "stale",
        observation: observation({
          pipeline: BUILDING,
          buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
        }),
      },
      NOW,
    );
    expect(region?.buildLogQuery).toEqual({ buildServiceStackId: "svc-1", appVersionId: "av-1" });
  });
});

describe("deriveObservedStepsRegion — a deploy reads its pipeline the way the Zerops GUI does", () => {
  const SERVICE = { name: "weatherdash", type: "Node.js", hadContainers: true };
  const observingOf = (pipeline: ObservedPipeline): ObservationState => ({
    kind: "observing",
    observation: observation({ pipeline }),
    elapsedMs: 42_000,
  });

  it.each([
    {
      name: "before the first read",
      state: { kind: "observing", observation: observation(), elapsedMs: 2_000 } as const,
    },
    { name: "with the feed off", state: { kind: "off", reason: "no-target" } as const },
  ])("$name: no region — the card says it is calculating the steps", ({ state }) => {
    expect(deriveObservedStepsRegion("deploy", "running", state, NOW, SERVICE)).toBeUndefined();
  });

  it("once the build runs: the readout, read against the render clock, and no slot steps", () => {
    const region = deriveObservedStepsRegion(
      "deploy",
      "running",
      observingOf(BUILDING),
      NOW,
      SERVICE,
    );

    expect(region?.steps).toEqual([]);
    expect(region?.pipeline).toEqual(
      readPipeline(BUILDING.appVersion, {
        nowMs: NOW,
        serviceName: "weatherdash",
        serviceType: "Node.js",
        hadContainers: true,
      }),
    );
  });

  it("the deploy step names the service, and a deploy-only pipeline starts at its process", () => {
    const deploying = {
      appVersion: { name: "abc123", status: "DEPLOYING" },
      startedAt: "2026-09-01T00:00:30.000Z",
    };
    const region = deriveObservedStepsRegion(
      "deploy",
      "running",
      observingOf(deploying),
      NOW,
      SERVICE,
    );

    expect(region?.pipeline?.steps).toEqual([
      expect.objectContaining({
        id: "DEPLOY",
        state: "running",
        sentence: "Creating app version abc123 and upgrading Node.js service weatherdash",
        note: "Preparing upgrade…",
        durationMs: 12_000,
      }),
    ]);
  });

  it("a settled deploy keeps the readout the store holds once its outcome was read", () => {
    const region = deriveObservedStepsRegion(
      "deploy",
      "done",
      { kind: "stale", observation: observation({ pipeline: BUILDING, outcome: "failed" }) },
      NOW,
      SERVICE,
    );
    expect(region?.pipeline?.currentStepId).toBe("RUN_BUILD_COMMANDS");
  });

  it("another kind carries no readout", () => {
    const region = deriveObservedStepsRegion(
      "import",
      "running",
      observingOf(BUILDING),
      NOW,
      SERVICE,
    );
    expect(region).not.toHaveProperty("pipeline");
  });
});

describe("pipelineServiceFor — what the readout names the deployed service by", () => {
  const appstage = {
    hostname: "appstage",
    serviceId: "svc-1",
    type: "nodejs@22",
    typeName: "Node.js",
    status: "ACTIVE",
    group: "runtimes",
    transient: false,
    ports: [],
    routes: [],
  } as const satisfies ZeropsTopologyView["services"][number];

  it.each([
    {
      name: "a service that runs a deploy",
      view: topology({ services: [{ ...appstage, deploy: { source: "CLI" } }] }),
      expected: { name: "appstage", type: "Node.js", hadContainers: true },
    },
    {
      name: "a service with no deploy it states: whether it ran containers is not known",
      view: topology({ services: [appstage] }),
      expected: { name: "appstage", type: "Node.js", hadContainers: undefined },
    },
    {
      name: "before the topology view loads",
      view: undefined,
      expected: { name: "appstage", type: undefined, hadContainers: undefined },
    },
  ])("$name", ({ view, expected }) => {
    expect(pipelineServiceFor(operation({ target: { hostname: "appstage" } }), view)).toEqual(
      expected,
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
    browserStreamSpy.mockReturnValue({ kind: "unknown", frame: null, freshness: "unknown" });
  });

  it("demands frames only while running and always reads the exact call identity", () => {
    hooks.beginRender();
    useOperationCard(operation({ kind: "browser", phase: "done" }), ENVIRONMENT_ID);
    expect(browserStreamSpy).toHaveBeenLastCalledWith(ENVIRONMENT_ID, "e1", false, null, "t1");

    hooks.beginRender();
    useOperationCard(operation({ kind: "deploy", phase: "running" }), ENVIRONMENT_ID);
    expect(browserStreamSpy).toHaveBeenLastCalledWith(ENVIRONMENT_ID, null, false, null, "t1");

    hooks.beginRender();
    useOperationCard(operation({ kind: "browser", phase: "running" }), ENVIRONMENT_ID);
    expect(browserStreamSpy).toHaveBeenLastCalledWith(ENVIRONMENT_ID, "e1", true, null, "t1");
    expect(browserStreamSpy).toHaveBeenCalledTimes(3);
  });

  it("passes thread and turn identity to the keyed result projection", () => {
    hooks.beginRender();
    useOperationCard(
      operation({ kind: "browser", phase: "running", callIds: ["call"], turnId: "turn" }),
      ENVIRONMENT_ID,
      undefined,
      true,
      "thread",
    );
    expect(browserStreamSpy).toHaveBeenLastCalledWith(
      ENVIRONMENT_ID,
      "call",
      true,
      "thread",
      "turn",
    );
  });

  it("passes the latest frame as liveFrame while the call is running, and live: true", () => {
    browserStreamSpy.mockReturnValue({ kind: "known", frame: FRAME, freshness: "live" });
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

  it("reads the retained source slot after completion and after the card remounts", () => {
    const running = operation({
      key: "op:brw1",
      callIds: ["brw1"],
      kind: "browser",
      phase: "running",
    });
    browserStreamSpy.mockReturnValue({ kind: "known", frame: FRAME, freshness: "live" });
    hooks.beginRender();
    useOperationCard(running, ENVIRONMENT_ID);

    const done = operation({ key: "op:brw1", callIds: ["brw1"], kind: "browser", phase: "done" });
    hooks.reset();
    browserStreamSpy.mockReturnValue({ kind: "known", frame: FRAME, freshness: "stale" });
    hooks.beginRender();
    const region = useOperationCard(done, ENVIRONMENT_ID);

    expect(region.live).toBe(false);
    expect(region.liveFrame).toEqual({
      src: "data:image/jpeg;base64,AAAA",
      width: 640,
      height: 360,
    });
  });

  it("never gives an unknown second call the first call's frame", () => {
    const first = operation({
      key: "op:brw1",
      callIds: ["brw1"],
      kind: "browser",
      phase: "running",
    });
    browserStreamSpy.mockReturnValue({ kind: "known", frame: FRAME, freshness: "live" });
    hooks.beginRender();
    useOperationCard(first, ENVIRONMENT_ID);

    const second = operation({ key: "op:brw2", callIds: ["brw2"], kind: "browser", phase: "done" });
    browserStreamSpy.mockReturnValue({ kind: "unknown", frame: null, freshness: "unknown" });
    hooks.beginRender();
    const region = useOperationCard(second, ENVIRONMENT_ID);

    expect(region.liveFrame).toBeUndefined();
  });

  it("shows no stale frame when the source proves absence or cannot identify the call", () => {
    for (const kind of ["unknown", "absent", "refused"]) {
      browserStreamSpy.mockReturnValue({ kind, frame: null, freshness: "unknown" });
      hooks.beginRender();
      expect(
        useOperationCard(operation({ kind: "browser" }), ENVIRONMENT_ID).liveFrame,
      ).toBeUndefined();
    }
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

describe("useOperationCard — the whole build log opens in a dialog, only when asked (hook)", () => {
  const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
  const held = observation({
    pipeline: BUILDING,
    outcome: "finished",
    buildLog: { buildServiceStackId: "svc-1", appVersionId: "av-1" },
  });
  const LINE = { id: "l1", at: "2026-09-01T00:00:10.000Z", text: "> npm ci", severity: 6 };
  const observed = (status: string, lines: ReadonlyArray<typeof LINE> = [LINE]) => ({
    state: { kind: "stale", observation: held },
    buildLog: { status, lines },
    settledRead: "read",
  });
  const logOf = (region: ReturnType<typeof useOperationCard>) =>
    region.observed?.log as { props: { open: boolean; onToggle: () => void } } | undefined;

  beforeEach(() => {
    hooks.reset();
  });

  it.each([
    { name: "a running deploy's live log", phase: "running" as const, status: "live" },
    { name: "a settled deploy's ended log", phase: "done" as const, status: "ended" },
  ])("keeps it closed for $name: a dialog never opens by itself", ({ phase, status }) => {
    observationSpy.mockReturnValueOnce(observed(status));
    hooks.beginRender();
    const region = useOperationCard(operation({ phase }), ENVIRONMENT_ID);
    expect(logOf(region)?.props.open).toBe(false);
  });

  // The log stands as soon as the card knows the build — a running one's
  // newest lines' room, a settled one's way to it — so the card's height is
  // final as it opens and as it lands (pass 36).
  it.each([
    {
      name: "a running build that wrote nothing yet",
      phase: "running" as const,
      lines: 0,
      log: true,
    },
    { name: "a running build's lines", phase: "running" as const, lines: 1, log: true },
    {
      name: "a settled build before its lines are read",
      phase: "done" as const,
      lines: 0,
      log: true,
    },
  ])("the way to the log: $name", ({ phase, lines, log }) => {
    observationSpy.mockReturnValueOnce(observed("idle", lines === 0 ? [] : [LINE]));
    hooks.beginRender();
    expect(logOf(useOperationCard(operation({ phase }), ENVIRONMENT_ID)) !== undefined).toBe(log);
  });

  // The person opened it: whoever holds its open state (its line, through a
  // plop) keeps it open, and closing it reaches them.
  it("holds it open where its caller keeps it", () => {
    observationSpy.mockReturnValueOnce(observed("live"));
    const kept: boolean[] = [];
    hooks.beginRender();
    const region = useOperationCard(operation({ phase: "done" }), ENVIRONMENT_ID, [
      true,
      (open) => kept.push(open),
    ]);
    expect(logOf(region)?.props.open).toBe(true);
    logOf(region)?.props.onToggle();
    expect(kept).toEqual([false]);
  });

  it("opens it when asked", () => {
    observationSpy.mockReturnValue(observed("live"));
    hooks.beginRender();
    logOf(useOperationCard(operation({ phase: "running" }), ENVIRONMENT_ID))?.props.onToggle();
    hooks.beginRender();
    const reopened = useOperationCard(operation({ phase: "running" }), ENVIRONMENT_ID);
    expect(logOf(reopened)?.props.open).toBe(true);
    observationSpy.mockReset();
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
