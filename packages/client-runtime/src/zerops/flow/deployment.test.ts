import { describe, expect, it } from "vite-plus/test";

import { identity, project, service } from "../data/__fixtures__/index.ts";
import type {
  CollectionRead,
  ProcessRecord,
  ServiceDeployInfo,
  ServiceRecord,
} from "../data/types.ts";
import { ReceiptOrdinal } from "../data/types.ts";
import { serviceRecordToZeropsService } from "../data/dto.ts";
import type { EnvironmentRow } from "../groupRows.ts";
import type { Freshness, Shown, WithheldReason } from "../knowledge/known.ts";
import { projectTopology } from "../topology.ts";
import {
  buildNames,
  CHECKING_WHAT_RUNS,
  NOTHING_DEPLOYED,
  stopServices,
  stopView,
  type Deployment,
  type StopReads,
} from "./deployment.ts";
import { processesRead, runningProcess } from "./__fixtures__/processes.ts";
import {
  deployed,
  record,
  servicesRead,
  UNAVAILABLE_DEPLOYMENT,
  UNRESOLVED_DEPLOYMENT,
} from "./__fixtures__/services.ts";

const NOW = 100_000;
const SHA = "3f9c1b2000000000000000000000000000000000";

const RUNNING: Deployment = {
  kind: "running",
  activatedAt: "2026-09-20T10:00:00Z",
  version: {
    name: "v1.4.0",
    commit: "3f9c1b2",
    sha: SHA,
    taggedBy: "ada",
    label: "v1.4.0",
  },
};

const known = (
  value: Deployment,
  coverage: "complete" | "partial" = "complete",
  freshness: Freshness = { kind: "live" },
): Shown<Deployment> => ({
  state: "known",
  value,
  asOf: { ordinal: 3, atMs: 30 },
  coverage,
  freshness,
});

const withheld = (reason: WithheldReason): Shown<Deployment> => ({
  state: "withheld",
  reason,
  cause: null,
});

/** Every state a stop's deployment can reach a surface in. */
const STATES: ReadonlyArray<{ readonly name: string; readonly shown: Shown<Deployment> }> = [
  { name: "unread", shown: { state: "unread", waitingFor: null } },
  { name: "unread, waiting for access", shown: { state: "unread", waitingFor: "access-grant" } },
  { name: "reading", shown: { state: "reading", sinceMs: 0, attempt: 1 } },
  {
    name: "failed",
    shown: {
      state: "failed",
      failure: { kind: "server", status: 503 },
      atMs: 0,
      attempt: 2,
      retryAtMs: NOW + 4_000,
    },
  },
  {
    name: "gone",
    shown: { state: "gone", evidence: "direct-not-found", asOf: { ordinal: 1, atMs: 0 } },
  },
  { name: "withheld, lapsed", shown: withheld("access-lapsed") },
  { name: "withheld, unverified", shown: withheld("access-unverified") },
  { name: "withheld, denied", shown: withheld("access-denied") },
  { name: "known none, partial", shown: known({ kind: "none" }, "partial") },
  { name: "known none", shown: known({ kind: "none" }) },
  {
    name: "known none, paused",
    shown: known({ kind: "none" }, "complete", { kind: "paused", by: "background" }),
  },
  {
    name: "known none, stale",
    shown: known({ kind: "none" }, "complete", {
      kind: "stale",
      reason: { kind: "source-recovering", retryAtMs: NOW + 2_000 },
      sinceMs: 0,
    }),
  },
  { name: "known running", shown: known(RUNNING) },
  {
    name: "known deploying",
    shown: known({ kind: "deploying", version: RUNNING.version, previous: null }),
  },
];

const row = (version: EnvironmentRow["version"], tone: EnvironmentRow["tone"]): EnvironmentRow => ({
  kind: "environment",
  projectId: "stage",
  name: "stage",
  tier: "stage",
  source: "main",
  commit: version.commit,
  version,
  versionRepository: "appdev",
  line: "main",
  tone,
});

const NO_VERSION: EnvironmentRow["version"] = {
  name: undefined,
  commit: undefined,
  sha: undefined,
  taggedBy: undefined,
  label: undefined,
};

const ROWS: ReadonlyArray<{ readonly name: string; readonly row: EnvironmentRow | undefined }> = [
  { name: "no row", row: undefined },
  { name: "a row with nothing read", row: row(NO_VERSION, "neutral") },
  {
    name: "a row naming a version",
    row: row(
      { name: undefined, commit: "3f9c1b2", sha: SHA, taggedBy: undefined, label: "3f9c1b2" },
      "good",
    ),
  },
];

describe("stopView", () => {
  it("unknown never reads Nothing deployed yet", () => {
    for (const { name, shown } of STATES) {
      for (const entry of ROWS) {
        const view = stopView({ deployment: shown, row: entry.row, nowMs: NOW });
        const earned =
          shown.state === "known" && shown.coverage === "complete" && shown.value.kind === "none";
        const says = [view.word, view.line].some((text) => text.includes(NOTHING_DEPLOYED));
        expect(says, `${name}, ${entry.name}`).toBe(earned);
      }
    }
  });

  it("holds the line for what is still being read, and says so only after a beat", () => {
    const view = stopView({
      deployment: { state: "unread", waitingFor: null },
      row: undefined,
      nowMs: NOW,
    });
    expect(view).toMatchObject({ tone: "neutral", line: CHECKING_WHAT_RUNS, version: undefined });
    expect(view.afterMs).toBeGreaterThan(0);
  });

  it("names a failed read's cause in the stop's own line", () => {
    const view = stopView({ deployment: STATES[3]!.shown, row: undefined, nowMs: NOW });
    expect(view.line).toBe("Couldn't read what runs here. Zerops didn't answer.");
    expect(view.afterMs).toBe(0);
  });

  it("runs the name the deploy half read, over the one the platform pushed", () => {
    const read = ROWS[2]!.row;
    const view = stopView({ deployment: known(RUNNING), row: read, nowMs: NOW });
    expect(view).toMatchObject({ tone: "good", word: "Deployed", line: "3f9c1b2" });
    expect(stopView({ deployment: known(RUNNING), row: undefined, nowMs: NOW })).toMatchObject({
      tone: "neutral",
      word: "Running",
      line: "v1.4.0",
      version: RUNNING.version,
    });
  });

  it("lets the platform's none win over a version the deploy half read earlier", () => {
    const view = stopView({ deployment: known({ kind: "none" }), row: ROWS[2]!.row, nowMs: NOW });
    expect(view).toMatchObject({ tone: "neutral", line: NOTHING_DEPLOYED, version: undefined });
  });

  it("says what a running build deploys, over what the deploy half read before it", () => {
    const deploying = known({ kind: "deploying", version: RUNNING.version, previous: null });
    for (const entry of ROWS) {
      expect(
        stopView({ deployment: deploying, row: entry.row, nowMs: NOW }),
        entry.name,
      ).toMatchObject({ tone: "pending", word: "Deploying", line: "v1.4.0", afterMs: 0 });
    }
    const unnamed = known({
      kind: "deploying",
      version: {
        name: undefined,
        commit: undefined,
        sha: undefined,
        taggedBy: undefined,
        label: undefined,
      },
      previous: null,
    });
    expect(stopView({ deployment: unnamed, row: undefined, nowMs: NOW })).toMatchObject({
      line: "Deploying",
      version: undefined,
    });
  });

  it("takes a version the deploy half read as running while the platform is still unread", () => {
    const view = stopView({
      deployment: { state: "unread", waitingFor: null },
      row: ROWS[2]!.row,
      nowMs: NOW,
    });
    expect(view).toMatchObject({ tone: "good", word: "Deployed", line: "3f9c1b2", afterMs: 0 });
  });
});

const PUSHED: ServiceDeployInfo = {
  id: "app-version",
  status: "ACTIVE",
  source: "GIT",
  activatedAt: "2026-09-20T10:00:00Z",
  name: `${SHA} v1.4.0 ada`,
  branch: "main",
  commit: null,
  tag: "v1.4.0",
  repository: null,
};

/** What a native service frame states of the active version: its id, status and times. */
const UNSTATED: ServiceDeployInfo = {
  id: "app-version",
  status: "ACTIVE",
  source: null,
  activatedAt: "2026-09-20T10:00:00Z",
  name: null,
  branch: null,
  commit: null,
  tag: null,
  repository: null,
};

/** The one listed service's deployment, its processes read and none of them a build. */
function serviceDeployment(read: CollectionRead<ServiceRecord>): Shown<Deployment> | undefined {
  const stops = stopServices(
    { services: read, processes: processesRead([]), names: new Map(), refused: null },
    NOW,
  );
  return stops.state === "known" ? stops.value[0]?.deployment : stops;
}

describe("a service's deployment", () => {
  it("carries what the platform pushed: when, and the version it names", () => {
    expect(serviceDeployment(servicesRead([record("s1", "app", deployed(PUSHED))]))).toMatchObject({
      state: "known",
      coverage: "complete",
      freshness: { kind: "live" },
      asOf: { ordinal: 4, atMs: 40 },
      value: {
        kind: "running",
        activatedAt: "2026-09-20T10:00:00Z",
        version: {
          name: "v1.4.0",
          commit: "3f9c1b2",
          sha: SHA,
          taggedBy: "ada",
          label: "v1.4.0",
        },
      },
    });
  });

  it("names a deploy by its commit when the platform pushed no name", () => {
    expect(
      serviceDeployment(
        servicesRead([record("s1", "app", deployed({ ...PUSHED, name: null, commit: SHA }))]),
      ),
    ).toMatchObject({
      state: "known",
      value: { kind: "running", version: { commit: "3f9c1b2", sha: SHA, label: "3f9c1b2" } },
    });
  });

  describe("reads each deploy as the topology does (A14)", () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly deploy: ServiceDeployInfo;
      readonly stop: "unread" | "none" | "running";
      readonly topologySource: string | undefined;
    }> = [
      {
        name: "a version with its source stated",
        deploy: PUSHED,
        stop: "running",
        topologySource: "GIT",
      },
      {
        name: "a never-deployed runtime's NONE version",
        deploy: { ...PUSHED, source: "NONE" },
        stop: "none",
        topologySource: undefined,
      },
      {
        name: "a version whose source nobody stated",
        deploy: UNSTATED,
        stop: "unread",
        topologySource: undefined,
      },
    ];

    it.each(cases)("$name", ({ deploy, stop, topologySource }) => {
      const stated = record("s1", "app", deployed(deploy));
      const deployment = serviceDeployment(servicesRead([stated]));
      const topology = projectTopology(
        { id: "project-1", name: "project", status: "ACTIVE" },
        [serviceRecordToZeropsService(stated)!],
        [],
      );

      expect(deployment?.state === "known" ? deployment.value.kind : deployment?.state).toBe(stop);
      expect(topology.services[0]?.deploy?.source).toBe(topologySource);
    });
  });

  it("marks a value the paused or recovering source no longer vouches for", () => {
    const paused = serviceDeployment(
      servicesRead([record("s1", "app", deployed(null))], {
        interest: { status: "paused", identity: identity(), reason: "background" },
      }),
    );
    expect(paused).toMatchObject({
      state: "known",
      freshness: { kind: "paused", by: "background" },
    });
    const recovering = serviceDeployment(
      servicesRead([record("s1", "app", deployed(null))], {
        interest: {
          status: "recovering",
          identity: identity(),
          reason: "disconnect",
          attempt: 2,
          nextRetryAtMs: NOW,
          progress: {
            requiredRegistrations: 1,
            completedRegistrations: 0,
            requiredReads: 1,
            completedReads: 0,
            crossedReceiptOrdinal: ReceiptOrdinal.make(1),
          },
        },
      }),
    );
    expect(recovering).toMatchObject({
      state: "known",
      freshness: { kind: "stale", reason: { kind: "source-recovering", retryAtMs: NOW } },
    });
  });

  it("fails what was never read when the source gave up", () => {
    const deployment = serviceDeployment(
      servicesRead([], {
        coverage: { kind: "none" },
        interest: {
          status: "failed",
          identity: identity(),
          reason: "registration refused",
          retryable: true,
          attempts: 3,
          retryAtMs: NOW + 8_000,
        },
      }),
    );
    expect(deployment).toMatchObject({ state: "failed", attempt: 3, retryAtMs: NOW + 8_000 });
  });
});

describe("stopServices", () => {
  const PROJECT = project("project-stage");
  const listed = (
    records: ReadonlyArray<ServiceRecord | "unresolved">,
    options: Parameters<typeof servicesRead>[1] = {},
  ) => servicesRead(records, { project: PROJECT, ...options });
  const NO_PROCESSES = processesRead([], { project: PROJECT });
  const build = (appVersion?: { readonly id: string; readonly name?: string }) =>
    runningProcess("build", {
      serviceIds: ["build-helper", "s1"],
      project: PROJECT,
      ...(appVersion === undefined ? {} : { appVersion }),
    });

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly read: CollectionRead<ServiceRecord>;
    readonly processes?: CollectionRead<ProcessRecord>;
    readonly names?: ReadonlyMap<string, string>;
    readonly refused?: StopReads["refused"];
    /** The list's state, else each listed service's hostname and deployment. */
    readonly expected: string | ReadonlyArray<readonly [string, string]>;
  }> = [
    {
      name: "a listing still being read",
      read: listed([], { coverage: { kind: "none" } }),
      expected: "unread",
    },
    {
      name: "a listed service not yet identified holds the list",
      read: listed([record("s1", "app", deployed(PUSHED)), "unresolved"]),
      expected: "unread",
    },
    {
      name: "each service answers for itself, by hostname",
      read: listed([
        record("s2", "web", UNRESOLVED_DEPLOYMENT),
        record("s1", "app", deployed(PUSHED)),
        record("s3", "worker", deployed(null)),
        record("s4", "api", UNAVAILABLE_DEPLOYMENT),
      ]),
      expected: [
        ["api", "failed"],
        ["app", "running"],
        ["web", "unread"],
        ["worker", "none"],
      ],
    },
    {
      name: "a never-deployed runtime's NONE version runs nothing",
      read: listed([record("s1", "app", deployed({ ...PUSHED, source: "NONE", name: null }))]),
      expected: [["app", "none"]],
    },
    {
      name: "a partial listing is no list",
      read: listed([record("s1", "app", deployed(null))], {
        coverage: {
          kind: "partial-window",
          offset: 0,
          limit: 1,
          traversedPages: 1,
          observedTotal: 2,
        },
      }),
      expected: "unread",
    },
    {
      name: "the Mate's container and a system service are no stop",
      read: listed([
        record("s1", "zcp", deployed(PUSHED), { type: "zcp@1" }),
        record("s2", "core", deployed(PUSHED), { isSystem: true }),
      ]),
      expected: [],
    },
    {
      name: "nothing active proves none only once the processes are read",
      read: listed([record("s1", "app", deployed(null))]),
      processes: processesRead([], { coverage: { kind: "none" }, project: PROJECT }),
      expected: [["app", "unread"]],
    },
    {
      name: "a process read that failed fails the none it could not prove",
      read: listed([record("s1", "app", deployed(null))]),
      processes: processesRead([], {
        coverage: { kind: "none" },
        project: PROJECT,
        interest: {
          status: "failed",
          identity: identity(),
          reason: "read refused",
          retryable: true,
          attempts: 2,
          retryAtMs: NOW + 4_000,
        },
      }),
      expected: [["app", "failed"]],
    },
    {
      name: "a refused process demand fails the none it could not prove",
      read: listed([record("s1", "app", deployed(null))]),
      processes: processesRead([], { coverage: { kind: "none" }, project: PROJECT }),
      refused: "account-capacity",
      expected: [["app", "failed"]],
    },
    {
      name: "a process not yet read may be a build",
      read: listed([record("s1", "app", deployed(null))]),
      processes: processesRead(["unresolved"], { project: PROJECT }),
      expected: [["app", "unread"]],
    },
    {
      name: "a running build deploys over what runs",
      read: listed([record("s1", "app", deployed(PUSHED))]),
      processes: processesRead([build({ id: "next", name: SHA })], { project: PROJECT }),
      expected: [["app", "deploying"]],
    },
    {
      name: "a build not yet read far enough to name its version still deploys",
      read: listed([record("s1", "app", deployed(null))]),
      processes: processesRead([build()], { project: PROJECT }),
      expected: [["app", "deploying"]],
    },
    {
      name: "a build whose version is already active has deployed",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      processes: processesRead([build({ id: UNSTATED.id!, name: SHA })], { project: PROJECT }),
      expected: [["app", "running"]],
    },
    {
      name: "a version a build named runs by that name after the build ended",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      names: new Map([[UNSTATED.id!, SHA]]),
      expected: [["app", "running"]],
    },
    {
      name: "a version nobody named or sourced stays pending",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      expected: [["app", "unread"]],
    },
  ];

  it.each(cases)("$name", ({ read, processes, names, refused, expected }) => {
    const stops = stopServices(
      {
        services: read,
        processes: processes ?? NO_PROCESSES,
        names: names ?? new Map(),
        refused: refused ?? null,
      },
      NOW,
    );
    if (typeof expected === "string") {
      expect(stops.state).toBe(expected);
      return;
    }
    expect(stops.state).toBe("known");
    expect(
      (stops.state === "known" ? stops.value : []).map(({ hostname, deployment }) => [
        hostname,
        deployment.state === "known" ? deployment.value.kind : deployment.state,
      ]),
    ).toEqual(expected);
  });

  describe("a running build keeps what ran when it started (DESIGN §4.7)", () => {
    const previousCases: ReadonlyArray<{
      readonly name: string;
      readonly deploy: ServiceDeployInfo;
      readonly names?: ReadonlyMap<string, string>;
      readonly previous: unknown;
    }> = [
      {
        name: "a version the platform named",
        deploy: PUSHED,
        previous: { kind: "running", version: { name: "v1.4.0", label: "v1.4.0" } },
      },
      {
        name: "a version an earlier build named",
        deploy: UNSTATED,
        names: new Map([[UNSTATED.id!, SHA]]),
        previous: { kind: "running", version: { sha: SHA, label: "3f9c1b2" } },
      },
      {
        name: "a never-deployed runtime's NONE version",
        deploy: { ...PUSHED, source: "NONE", name: null },
        previous: { kind: "none" },
      },
      { name: "a version nobody named or sourced", deploy: UNSTATED, previous: null },
    ];

    it.each(previousCases)("$name", ({ deploy, names, previous }) => {
      const stops = stopServices(
        {
          services: listed([record("s1", "app", deployed(deploy))]),
          processes: processesRead([build({ id: "next", name: SHA })], { project: PROJECT }),
          names: names ?? new Map(),
          refused: null,
        },
        NOW,
      );
      const deployment = stops.state === "known" ? stops.value[0]?.deployment : undefined;
      expect(deployment).toMatchObject({ state: "known", value: { kind: "deploying" } });
      if (previous === null) {
        expect(deployment).toMatchObject({ value: { previous: null } });
      } else {
        expect(deployment).toMatchObject({ value: { previous } });
      }
    });
  });

  it("a build that ends without activating keeps what ran before it, by its name", () => {
    // The build named `next`, the service still runs `app-version`, and the build is gone.
    const stops = stopServices(
      {
        services: listed([record("s1", "app", deployed(UNSTATED))]),
        processes: NO_PROCESSES,
        names: new Map([
          [UNSTATED.id!, "1a2b3c4000000000000000000000000000000000"],
          ["next", SHA],
        ]),
        refused: null,
      },
      NOW,
    );
    expect(stops.state === "known" ? stops.value[0]?.deployment : undefined).toMatchObject({
      state: "known",
      value: { kind: "running", version: { commit: "1a2b3c4" } },
    });
  });

  it("names each service by its ref", () => {
    const stops = stopServices(
      {
        services: listed([record("s1", "app", deployed(PUSHED), { project: PROJECT })]),
        processes: NO_PROCESSES,
        names: new Map(),
        refused: null,
      },
      NOW,
    );
    expect(stops.state === "known" ? stops.value[0]?.service : undefined).toEqual(
      service("s1", PROJECT),
    );
  });

  it("names a running version by its build over the name the platform pushed", () => {
    const stops = stopServices(
      {
        services: listed([record("s1", "app", deployed(PUSHED))]),
        processes: NO_PROCESSES,
        names: new Map([[PUSHED.id!, SHA]]),
        refused: null,
      },
      NOW,
    );
    expect(stops.state === "known" ? stops.value[0]?.deployment : undefined).toMatchObject({
      state: "known",
      value: { kind: "running", version: { sha: SHA, label: "3f9c1b2" } },
    });
  });
});

describe("buildNames", () => {
  const PROJECT = project("project-stage");
  const builds = (...appVersions: ReadonlyArray<{ readonly id: string; readonly name?: string }>) =>
    processesRead(
      appVersions.map((appVersion, index) =>
        runningProcess(`build-${index}`, { serviceIds: ["s1"], appVersion, project: PROJECT }),
      ),
      { project: PROJECT },
    );

  it("keeps what earlier builds named and adds what a running build names", () => {
    const held = new Map([["v1", "first"]]);
    expect([...buildNames(held, builds({ id: "v2", name: SHA }))]).toEqual([
      ["v1", "first"],
      ["v2", SHA],
    ]);
  });

  it("is the same map while no build names anything new", () => {
    const held = new Map([["v1", "first"]]);
    expect(buildNames(held, builds({ id: "v1", name: "first" }))).toBe(held);
    expect(buildNames(held, builds({ id: "v3" }))).toBe(held);
  });
});
