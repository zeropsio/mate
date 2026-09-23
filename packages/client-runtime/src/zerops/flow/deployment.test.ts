import { describe, expect, it } from "vite-plus/test";

import { identity, project, service } from "../data/__fixtures__/index.ts";
import type { CollectionRead, ServiceDeployInfo, ServiceRecord } from "../data/types.ts";
import { ReceiptOrdinal } from "../data/types.ts";
import { serviceRecordToZeropsService } from "../data/dto.ts";
import type { EnvironmentRow } from "../groupRows.ts";
import type { Freshness, Shown, WithheldReason } from "../knowledge/known.ts";
import { projectTopology } from "../topology.ts";
import {
  CHECKING_WHAT_RUNS,
  NOTHING_DEPLOYED,
  stopDeployment,
  stopServices,
  stopView,
  type Deployment,
} from "./deployment.ts";
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

describe("stopDeployment", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly read: CollectionRead<ServiceRecord> | undefined;
    readonly expected: Shown<Deployment>["state"] | "none" | "running";
  }> = [
    { name: "nothing read for the project", read: undefined, expected: "unread" },
    {
      name: "the service list still being read",
      read: servicesRead([], { coverage: { kind: "none" } }),
      expected: "unread",
    },
    {
      name: "a service whose deployment facet is unresolved",
      read: servicesRead([record("s1", "app", UNRESOLVED_DEPLOYMENT)]),
      expected: "unread",
    },
    {
      name: "a service listed but not yet read",
      read: servicesRead([record("s1", "app", deployed(null)), "unresolved"]),
      expected: "unread",
    },
    {
      name: "every service observed with no active deploy",
      read: servicesRead([record("s1", "app", deployed(null))]),
      expected: "none",
    },
    {
      name: "a never-deployed runtime's NONE version",
      read: servicesRead([
        record("s1", "app", deployed({ ...PUSHED, source: "NONE", name: null })),
      ]),
      expected: "none",
    },
    {
      // A pushed frame states no source (A14): the deploy may be a NONE one.
      name: "an active version whose source nobody stated",
      read: servicesRead([record("s1", "app", deployed(UNSTATED))]),
      expected: "unread",
    },
    {
      name: "no services at all, completely listed",
      read: servicesRead([]),
      expected: "none",
    },
    {
      name: "a running service beside one still unread",
      read: servicesRead([record("s1", "app", deployed(PUSHED)), "unresolved"]),
      expected: "running",
    },
    {
      name: "the Mate's container and a system service are not what the stop runs",
      read: servicesRead([
        record("s1", "zcp", deployed(PUSHED), { type: "zcp@1" }),
        record("s2", "core", deployed(PUSHED), { isSystem: true }),
        record("s3", "app", deployed(null)),
      ]),
      expected: "none",
    },
    {
      // The platform refused to say what the service runs: that is no answer, not a none.
      name: "a service whose deployment the platform will not show",
      read: servicesRead([record("s1", "app", UNAVAILABLE_DEPLOYMENT)]),
      expected: "failed",
    },
    {
      name: "a running service beside one whose deployment the platform will not show",
      read: servicesRead([
        record("s1", "app", deployed(PUSHED)),
        record("s2", "api", UNAVAILABLE_DEPLOYMENT),
      ]),
      expected: "running",
    },
    {
      name: "a partial listing never proves none",
      read: servicesRead([record("s1", "app", deployed(null))], {
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
  ];

  it.each(cases)("$name", ({ read, expected }) => {
    const deployment = stopDeployment(read, NOW);
    const got = deployment.state === "known" ? deployment.value.kind : deployment.state;
    expect(got === "reading" ? "unread" : got).toBe(expected);
  });

  it("carries what the platform pushed: when, and the version it names", () => {
    const deployment = stopDeployment(servicesRead([record("s1", "app", deployed(PUSHED))]), NOW);
    expect(deployment).toMatchObject({
      state: "known",
      coverage: "complete",
      freshness: { kind: "live" },
      asOf: { ordinal: 4, atMs: 40 },
      value: {
        kind: "running",
        activatedAt: "2026-09-20T10:00:00Z",
        version: { name: "v1.4.0", commit: "3f9c1b2", sha: SHA, taggedBy: "ada", label: "v1.4.0" },
      },
    });
  });

  it("names a deploy by its commit when the platform pushed no name", () => {
    const deployment = stopDeployment(
      servicesRead([record("s1", "app", deployed({ ...PUSHED, name: null, commit: SHA }))]),
      NOW,
    );
    expect(deployment).toMatchObject({
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
      const deployment = stopDeployment(servicesRead([stated]), NOW);
      const topology = projectTopology(
        { id: "project-1", name: "project", status: "ACTIVE" },
        [serviceRecordToZeropsService(stated)!],
        [],
      );

      expect(deployment.state === "known" ? deployment.value.kind : deployment.state).toBe(stop);
      expect(topology.services[0]?.deploy?.source).toBe(topologySource);
    });
  });

  it("marks a value the paused or recovering source no longer vouches for", () => {
    const paused = stopDeployment(
      servicesRead([record("s1", "app", deployed(null))], {
        interest: { status: "paused", identity: identity(), reason: "background" },
      }),
      NOW,
    );
    expect(paused).toMatchObject({
      state: "known",
      freshness: { kind: "paused", by: "background" },
    });
    const recovering = stopDeployment(
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
      NOW,
    );
    expect(recovering).toMatchObject({
      state: "known",
      freshness: { kind: "stale", reason: { kind: "source-recovering", retryAtMs: NOW } },
    });
  });

  it("fails what was never read when the source gave up", () => {
    const deployment = stopDeployment(
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
      NOW,
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

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly read: CollectionRead<ServiceRecord> | undefined;
    /** The list's state, else each listed service's hostname and deployment. */
    readonly expected: string | ReadonlyArray<readonly [string, string]>;
  }> = [
    { name: "nothing read for the project", read: undefined, expected: "unread" },
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
      name: "the Mate's container and a system service are no stop",
      read: listed([
        record("s1", "zcp", deployed(PUSHED), { type: "zcp@1" }),
        record("s2", "core", deployed(PUSHED), { isSystem: true }),
      ]),
      expected: [],
    },
  ];

  it.each(cases)("$name", ({ read, expected }) => {
    const stops = stopServices(read, NOW);
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

  it("names each service by its ref", () => {
    const stops = stopServices(
      listed([record("s1", "app", deployed(PUSHED), { project: PROJECT })]),
      NOW,
    );
    expect(stops.state === "known" ? stops.value[0]?.service : undefined).toEqual(
      service("s1", PROJECT),
    );
  });
});
