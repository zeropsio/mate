import { describe, expect, it } from "vite-plus/test";

import { identity, project, service } from "../data/__fixtures__/index.ts";
import type { CollectionRead, ServiceDeployInfo, ServiceRecord } from "../data/types.ts";
import { serviceRecordToZeropsService } from "../data/dto.ts";
import { deployWord } from "../groupDeploys.ts";
import { groupFlow } from "../groupFlow.ts";
import { deployedVersion, environmentRow, type EnvironmentRow } from "../groupRows.ts";
import type { Freshness, Shown, WithheldReason } from "../knowledge/known.ts";
import { projectTopology } from "../topology.ts";
import {
  CHECKING_WHAT_RUNS,
  deployActivatedAt,
  deployBuilding,
  NOTHING_DEPLOYED,
  stopServices,
  stopTone,
  stopView,
  type Deployment,
  type StopReads,
} from "./deployment.ts";
import { runningBuild, work } from "./__fixtures__/work.ts";
import type { ZeropsServiceDeployedVersion } from "../data/deployedVersion.ts";
import type { StopWork } from "../../data/projections/stopWork.ts";
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
  deploys: [],
  keyGap: false,
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
  it("colours a stop as stopTone does, in every state and with every row", () => {
    const toned = ROWS.flatMap((entry) =>
      entry.row === undefined
        ? [entry]
        : (["neutral", "pending", "good", "bad"] as const).map((tone) => ({
            name: `${entry.name}, ${tone}`,
            row: { ...entry.row!, tone },
          })),
    );
    for (const { name, shown } of STATES) {
      for (const entry of toned) {
        expect(stopTone(shown, entry.row), `${name}, ${entry.name}`).toBe(
          stopView({ deployment: shown, row: entry.row, nowMs: NOW }).tone,
        );
      }
    }
  });

  it("unknown never reads Nothing deployed yet", () => {
    for (const { name, shown } of STATES) {
      for (const entry of ROWS) {
        const view = stopView({ deployment: shown, row: entry.row, nowMs: NOW });
        const earned =
          shown.state === "known" &&
          shown.freshness.kind !== "stale" &&
          shown.coverage === "complete" &&
          shown.value.kind === "none";
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

  it.each([
    { name: "a running deploy", shown: known(RUNNING), expected: "2026-09-20T10:00:00Z" },
    {
      name: "a running deploy the platform gave no time",
      shown: known({ ...RUNNING, activatedAt: null }),
      expected: null,
    },
    {
      name: "a build that runs now",
      shown: known({ kind: "deploying", version: RUNNING.version, previous: RUNNING }),
      expected: null,
    },
    { name: "nothing deployed", shown: known({ kind: "none" }), expected: null },
    {
      name: "a deployment still being read",
      shown: { state: "unread", waitingFor: null } as Shown<Deployment>,
      expected: null,
    },
  ])("answers since when $name has run", ({ shown, expected }) => {
    for (const entry of ROWS) {
      expect(
        stopView({ deployment: shown, row: entry.row, nowMs: NOW }).activatedAt,
        entry.name,
      ).toBe(expected);
    }
  });

  it("names what runs by the platform's answer, coloured by the deploy half's row of it", () => {
    const read = ROWS[2]!.row;
    const view = stopView({ deployment: known(RUNNING), row: read, nowMs: NOW });
    expect(view).toMatchObject({
      tone: "good",
      word: "Deployed",
      line: "v1.4.0",
      version: RUNNING.version,
    });
    expect(stopView({ deployment: known(RUNNING), row: undefined, nowMs: NOW })).toMatchObject({
      tone: "neutral",
      word: "Deployed",
      line: "v1.4.0",
      version: RUNNING.version,
    });
  });

  it.each([
    {
      name: "the row named by a release on the commit the platform names draws the release",
      row: row({ ...RUNNING.version, name: "v1.6.0", label: "v1.6.0" }, "good"),
      expected: { tone: "good", word: "Deployed", line: "v1.6.0" },
    },
    {
      name: "the row's release, with no tone of its own, still names it",
      row: row({ ...RUNNING.version, name: "v1.6.0", label: "v1.6.0" }, "neutral"),
      expected: { tone: "neutral", word: "Deployed", line: "v1.6.0" },
    },
    {
      // A name written since 2026-09-30 spells the commit short; the platform's may be older.
      name: "the row's release, read under the short sha of the commit the platform names",
      row: row(
        { ...RUNNING.version, name: "v1.6.0", sha: SHA.slice(0, 7), label: "v1.6.0" },
        "good",
      ),
      expected: { tone: "good", word: "Deployed", line: "v1.6.0" },
    },
    {
      name: "a row naming another commit leaves the platform's name standing",
      row: row(
        {
          name: "v1.6.0",
          commit: "9d8e7f6",
          sha: "9d8e7f6000000000000000000000000000000000",
          taggedBy: undefined,
          label: "v1.6.0",
        },
        "good",
      ),
      // Named by the platform; HQ recorded a deploy, and the platform says it runs.
      expected: { tone: "good", word: "Deployed", line: "v1.4.0" },
    },
  ])("$name", ({ row: read, expected }) => {
    const view = stopView({ deployment: known(RUNNING), row: read, nowMs: NOW });
    expect(view).toMatchObject(expected);
    expect(view.version?.label).toBe(expected.line);
  });

  it("never names or fails a stop by a version the deploy half read that does not run there", () => {
    // userData moved to a build that then failed; the service still runs RUNNING (A11, A14).
    const failedBuild = "9d8e7f6000000000000000000000000000000000";
    const read = row(
      {
        name: undefined,
        commit: "9d8e7f6",
        sha: failedBuild,
        taggedBy: undefined,
        label: "9d8e7f6",
      },
      "bad",
    );
    expect(stopView({ deployment: known(RUNNING), row: read, nowMs: NOW })).toMatchObject({
      tone: "good",
      word: "Deployed",
      line: "v1.4.0",
      version: RUNNING.version,
    });
  });

  it("takes the deploy half's name for what runs where the platform's answer names none", () => {
    const unnamed = known({ ...RUNNING, version: NO_VERSION });
    expect(stopView({ deployment: unnamed, row: ROWS[2]!.row, nowMs: NOW })).toMatchObject({
      tone: "good",
      word: "Deployed",
      line: "3f9c1b2",
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
      ).toMatchObject({ tone: "pending", word: "Deploying…", line: "v1.4.0", afterMs: 0 });
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
      line: "Deploying…",
      version: undefined,
    });
  });

  it.each<Shown<Deployment>>([
    { state: "unread", waitingFor: null },
    { state: "reading", sinceMs: 0, attempt: 1 },
  ])("keeps the flow's own version while the platform is $state", (deployment) => {
    const view = stopView({
      deployment,
      row: ROWS[2]!.row,
      nowMs: NOW,
    });
    expect(view).toMatchObject({
      tone: "good",
      word: "Deployed",
      version: ROWS[2]!.row!.version,
    });
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

/** What the service's variables state of a version nothing named, before they answer. */
const ASKED = { state: "unread", waitingFor: null } as const;

function serviceDeployment(read: CollectionRead<ServiceRecord>): Shown<Deployment> | undefined {
  const stops = stopServices(
    {
      services: read,
      work: work(),
      versions: new Map(),
      refused: null,
      stated: new Map([[UNSTATED.id!, ASKED]]),
      detail: false,
    },
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

  it("marks a value the paused or failed source no longer vouches for", () => {
    const paused = serviceDeployment(
      servicesRead([record("s1", "app", deployed(null))], {
        interest: { status: "paused", identity: identity(), reason: "background" },
      }),
    );
    expect(paused).toMatchObject({
      state: "known",
      freshness: { kind: "paused", by: "background" },
    });
    const failed = serviceDeployment(
      servicesRead([record("s1", "app", deployed(null))], {
        interest: {
          status: "failed",
          identity: identity(),
          reason: "disconnect",
          attempts: 1,
          retryable: true,
          retryAtMs: null,
        },
      }),
    );
    expect(failed).toMatchObject({
      state: "known",
      freshness: { kind: "stale", reason: { kind: "revalidation-failed", retryAtMs: null } },
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
  const build = (appVersion?: { readonly id: string; readonly name?: string }) =>
    runningBuild(["build-helper", "s1"], appVersion);
  const version = (source: string | null) => ({
    id: UNSTATED.id!,
    projectId: "project-stage",
    serviceId: "s1",
    status: "ACTIVE",
    source,
  });
  /** What the organization's active versions state of the service's version. */
  const sourced = (source: string | null): StopReads["versions"] =>
    new Map([[UNSTATED.id!, { kind: "known", source }]]);
  const NAMED: Shown<ZeropsServiceDeployedVersion> = {
    state: "known",
    value: { activeId: UNSTATED.id!, source: "GIT", name: SHA },
    asOf: { ordinal: 5, atMs: 50 },
    coverage: "complete",
    freshness: { kind: "live" },
  };

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly read: CollectionRead<ServiceRecord>;
    readonly work?: StopWork;
    readonly refused?: StopReads["refused"];
    readonly stated?: StopReads["stated"];
    readonly detail?: boolean;
    readonly versions?: StopReads["versions"];
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
      name: "nothing active proves none only once the running work is read",
      read: listed([record("s1", "app", deployed(null))]),
      work: work({ complete: false, source: { kind: "establishing" } }),
      expected: [["app", "reading"]],
    },
    {
      name: "running work catching up fails the none it could not prove",
      read: listed([record("s1", "app", deployed(null))]),
      work: work({ complete: false, source: { kind: "catching-up" } }),
      expected: [["app", "failed"]],
    },
    {
      name: "a refused services demand fails the none it could not prove",
      read: listed([record("s1", "app", deployed(null))]),
      work: work({ complete: false }),
      refused: { reason: "account-capacity", attempt: 1 },
      expected: [["app", "failed"]],
    },
    {
      name: "a running build deploys over what runs",
      read: listed([record("s1", "app", deployed(PUSHED))]),
      work: work({ builds: [build({ id: "next", name: SHA })] }),
      expected: [["app", "deploying"]],
    },
    {
      name: "a build not yet read far enough to name its version still deploys",
      read: listed([record("s1", "app", deployed(null))]),
      work: work({ builds: [build()] }),
      expected: [["app", "deploying"]],
    },
    {
      name: "a build whose version is already active has deployed",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      work: work({
        builds: [build({ id: UNSTATED.id!, name: SHA })],
        names: { [UNSTATED.id!]: SHA },
      }),
      expected: [["app", "running"]],
    },
    {
      name: "a version a build named runs by that name after the build ended",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      work: work({ names: { [UNSTATED.id!]: SHA } }),
      expected: [["app", "running"]],
    },
    {
      name: "a version nobody named stays pending until the active versions state it",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      stated: new Map([[UNSTATED.id!, ASKED]]),
      expected: [["app", "unread"]],
    },
    {
      name: "a version the active versions source runs, named by the service's variables",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: sourced("GIT"),
      stated: new Map([[UNSTATED.id!, NAMED]]),
      expected: [["app", "running"]],
    },
    {
      name: "a version the active versions source runs, unnamed while nothing reads its variables",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: sourced("GIT"),
      stated: new Map([[UNSTATED.id!, ASKED]]),
      expected: [["app", "running"]],
    },
    {
      name: "in detail, a version the active versions source waits for its variables to name it",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: sourced("GIT"),
      stated: new Map([[UNSTATED.id!, ASKED]]),
      detail: true,
      expected: [["app", "unread"]],
    },
    {
      name: "a version the active versions say came with no code runs nothing",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: sourced("NONE"),
      expected: [["app", "none"]],
    },
    {
      name: "a runtime that ran nothing stays none while its next version is on its way (F5)",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      work: work({ active: { s1: { ...version("NONE"), id: "before" } } }),
      expected: [["app", "none"]],
    },
    {
      name: "in detail, a sourced version waiting for its name never reads as the none before it",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: sourced("GIT"),
      work: work({ active: { s1: { ...version("NONE"), id: "before" } } }),
      stated: new Map([[UNSTATED.id!, ASKED]]),
      detail: true,
      expected: [["app", "unread"]],
    },
    {
      name: "a version whose row states no source still runs code: only NONE runs nothing",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: sourced(null),
      expected: [["app", "running"]],
    },
    {
      name: "a version the platform does not have fails visibly, never Checking",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: new Map([[UNSTATED.id!, { kind: "not-listed" }]]),
      work: work({ active: { s1: { ...version("NONE"), id: "before" } } }),
      expected: [["app", "failed"]],
    },
    {
      name: "a version whose read answered a row Zerops sent unreadable fails visibly",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: new Map([[UNSTATED.id!, { kind: "unreadable" }]]),
      expected: [["app", "failed"]],
    },
    {
      name: "a version the refused active versions will never state fails",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      versions: new Map([[UNSTATED.id!, { kind: "refused" }]]),
      expected: [["app", "failed"]],
    },
    {
      name: "a variables read that failed fails the version nothing else states",
      read: listed([record("s1", "app", deployed(UNSTATED))]),
      stated: new Map([
        [
          UNSTATED.id!,
          {
            state: "failed",
            failure: { kind: "transport", detail: "Zerops did not answer." },
            atMs: NOW,
            attempt: 1,
            retryAtMs: NOW + 2_000,
          },
        ],
      ]),
      expected: [["app", "failed"]],
    },
  ];

  it.each(cases)("$name", ({ read, work: held, refused, stated, detail, versions, expected }) => {
    const stops = stopServices(
      {
        services: read,
        work: held ?? work(),
        versions: versions ?? new Map(),
        refused: refused ?? null,
        stated: stated ?? new Map(),
        detail: detail ?? false,
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

  const deploymentOf = (reads: Partial<StopReads> & Pick<StopReads, "services">) => {
    const stops = stopServices(
      {
        work: work(),
        versions: new Map(),
        refused: null,
        stated: new Map(),
        detail: false,
        ...reads,
      },
      NOW,
    );
    return stops.state === "known" ? stops.value[0]?.deployment : undefined;
  };

  describe("a running build keeps what ran when it started (DESIGN §4.7)", () => {
    const previousCases: ReadonlyArray<{
      readonly name: string;
      readonly deploy: ServiceDeployInfo;
      readonly names?: StopWork["names"];
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
        names: { [UNSTATED.id!]: SHA },
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
      const deployment = deploymentOf({
        services: listed([record("s1", "app", deployed(deploy))]),
        work: work({ builds: [build({ id: "next", name: SHA })], names: names ?? {} }),
      });
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
    expect(
      deploymentOf({
        services: listed([record("s1", "app", deployed(UNSTATED))]),
        work: work({
          names: { [UNSTATED.id!]: "1a2b3c4000000000000000000000000000000000", next: SHA },
        }),
      }),
    ).toMatchObject({
      state: "known",
      value: { kind: "running", version: { commit: "1a2b3c4" } },
    });
  });

  it.each([
    { status: "FAILED", reason: "Zerops reports its build failed" },
    { status: "CANCELED", reason: "Zerops reports its build was canceled" },
  ])("a service that runs nothing after its build ended $status says the build failed", (end) => {
    expect(
      deploymentOf({
        services: listed([record("s1", "app", deployed(null))]),
        work: work({ lastBuilds: { s1: { processId: "build-1", status: end.status } } }),
      }),
    ).toMatchObject({
      state: "known",
      value: { kind: "none", failedBuild: { processId: "build-1", reason: end.reason } },
    });
  });

  it.each([
    { name: "its build finished", deploy: null, status: "FINISHED", kind: "none" },
    { name: "it runs a version", deploy: PUSHED, status: "FAILED", kind: "running" },
  ])("a build's end says nothing more when $name", ({ deploy, status, kind }) => {
    const deployment = deploymentOf({
      services: listed([record("s1", "app", deployed(deploy))]),
      work: work({ lastBuilds: { s1: { processId: "build-1", status } } }),
    });
    expect(deployment).toMatchObject({ state: "known", value: { kind } });
    expect(deployment).not.toMatchObject({ value: { failedBuild: expect.anything() } });
  });

  it("names each service by its ref", () => {
    const stops = stopServices(
      {
        services: listed([record("s1", "app", deployed(PUSHED), { project: PROJECT })]),
        work: work(),
        versions: new Map(),
        refused: null,
        stated: new Map(),
        detail: false,
      },
      NOW,
    );
    expect(stops.state === "known" ? stops.value[0]?.service : undefined).toEqual(
      service("s1", PROJECT),
    );
  });

  it("names a running version by its build over the name the platform pushed", () => {
    expect(
      deploymentOf({
        services: listed([record("s1", "app", deployed(PUSHED))]),
        work: work({ names: { [PUSHED.id!]: SHA } }),
      }),
    ).toMatchObject({
      state: "known",
      value: { kind: "running", version: { sha: SHA, label: "3f9c1b2" } },
    });
  });
});

describe("what a surface reads off a stop's deployment", () => {
  const v1 = deployedVersion("v0.1.44");
  const v2 = deployedVersion("v0.1.45");
  const running: Deployment = {
    kind: "running",
    activatedAt: "2026-09-29T09:00:00.000Z",
    version: v1,
  };
  const building: Deployment = { kind: "deploying", version: v2, previous: running };

  it.each<{
    readonly name: string;
    readonly deployment: Shown<Deployment> | undefined;
    readonly activatedAt: string | null;
    readonly building: ReturnType<typeof deployBuilding>;
  }>([
    {
      name: "a running stop says when its version went live, and builds nothing",
      deployment: known(running),
      activatedAt: "2026-09-29T09:00:00.000Z",
      building: undefined,
    },
    {
      name: "a deploy on its way names what it builds and what served before it",
      deployment: known(building),
      activatedAt: null,
      building: { version: v2, previous: running },
    },
    {
      name: "a stop that runs nothing says neither",
      deployment: known({ kind: "none" }),
      activatedAt: null,
      building: undefined,
    },
    {
      name: "nothing read yet says neither",
      deployment: { state: "reading", sinceMs: 0, attempt: 1 },
      activatedAt: null,
      building: undefined,
    },
    {
      name: "no deployment at all says neither",
      deployment: undefined,
      activatedAt: null,
      building: undefined,
    },
  ])("$name", ({ deployment, activatedAt, building: expected }) => {
    expect(deployActivatedAt(deployment)).toBe(activatedAt);
    expect(deployBuilding(deployment)).toEqual(expected);
  });
});

describe("a deploy of a commit only moves forward", () => {
  // Invented commits: the one a stage ran, the one deployed over it, and a newer one after.
  const OLD = "a11ce5e0b0c0d0e0f0a1b2c3d4e5f60718293a4b";
  const NEW = "b0b5c0de1f2e3d4c5b6a79881726354453627180";
  const NEWER = "c4fe0011223344556677889900aabbccddeeff00";
  const runs = (sha: string): Shown<Deployment> =>
    known({ kind: "running", activatedAt: null, version: deployedVersion(sha) });
  const building = (sha: string, ran: string): Shown<Deployment> =>
    known({
      kind: "deploying",
      version: deployedVersion(sha),
      previous: { kind: "running", activatedAt: null, version: deployedVersion(ran) },
    });
  /** The deploy half's row: the commit a service runs and HQ's record of its deploy, as read. */
  const read = (sha: string, state: "queued" | "live" | "failed"): EnvironmentRow =>
    environmentRow({
      projectId: "p-stage",
      name: "stage",
      tier: "stage",
      sources: ["main"],
      services: [
        {
          hostname: "app",
          appVersionName: sha,
          deploy: {
            latest: {
              id: "1",
              kind: "deploy",
              service: "app",
              sha,
              state,
              cause: "merge",
              ref: sha,
              reason: null,
              appVersionId: null,
              processId: null,
              requestedBy: null,
              at: "2026-10-02T10:00:00.000Z",
              endedAt: state === "queued" ? null : "2026-10-02T10:04:00.000Z",
              supersededBy: null,
            },
            live: null,
          },
        },
      ],
    });
  /** What the menu and the chips read: the group flow's stop. */
  const flowState = (deployment: Shown<Deployment>, row: EnvironmentRow) =>
    groupFlow({
      groupId: "g",
      mates: [],
      pullRequests: [],
      merged: [],
      stops: [
        { projectId: "p-stage", name: "stage", tier: "stage", row, deployment, route: undefined },
      ],
      release: {
        gate: { allowed: false, reason: "" },
        suggestion: "v0.1.0",
        waiting: 0,
        waitingAtLeast: false,
        untold: [],
      },
      mainHasCode: true,
      mainHead: undefined,
      pending: [],
    }).stages[0]?.state;

  // The measured order: the platform's version went active before the deploy's record turned
  // live, and HQ's read from before that moment arrived after it.
  const STEPS = [
    {
      step: "the build runs",
      deployment: building(NEW, OLD),
      row: read(OLD, "live"),
      word: "Deploying…",
      state: "deploying",
    },
    {
      step: "the platform runs it, the row still reads the commit before",
      deployment: runs(NEW),
      row: read(OLD, "live"),
      word: "Deployed",
      state: "deployed",
    },
    {
      step: "a status read before that moment arrives after it",
      deployment: runs(NEW),
      row: read(NEW, "queued"),
      word: "Deployed",
      state: "deployed",
    },
    {
      step: "the platform's answer goes unknown on a reconnect, the stale read standing",
      deployment: { state: "reading", sinceMs: 0, attempt: 1 },
      row: read(NEW, "queued"),
      word: "Deployed",
      state: "deployed",
    },
    {
      step: "the active version arrives unstated, the stale read standing",
      deployment: { state: "unread", waitingFor: null },
      row: read(NEW, "queued"),
      word: "Deployed",
      state: "deployed",
    },
    {
      step: "HQ's record of it going live lands",
      deployment: runs(NEW),
      row: read(NEW, "live"),
      word: "Deployed",
      state: "deployed",
    },
    {
      step: "a newer commit's deploy starts its own sequence",
      deployment: building(NEWER, NEW),
      row: read(NEW, "live"),
      word: "Deploying…",
      state: "deploying",
    },
    {
      step: "the newer commit runs before its status says so",
      deployment: runs(NEWER),
      row: read(NEWER, "queued"),
      word: "Deployed",
      state: "deployed",
    },
    {
      step: "a failure on the commit it runs says so",
      deployment: runs(NEWER),
      row: read(NEWER, "failed"),
      word: "Failed",
      state: "failed",
    },
  ] as const satisfies ReadonlyArray<{
    step: string;
    deployment: Shown<Deployment>;
    row: EnvironmentRow;
    word: string;
    state: string;
  }>;

  // Every surface that words a stop: its page (`stopView`), the menu, the chips and the collapsed
  // card (the group flow's stop), and the expanded card and the group page's rows (`stopTone`).
  it.each(STEPS)("$step: $word", ({ deployment, row, word, state }) => {
    expect(stopView({ deployment, row, nowMs: NOW }).word).toBe(word);
    expect(flowState(deployment, row)).toBe(state);
    expect(deployWord(stopTone(deployment, row))).toBe(word);
  });
});

// The flow's version survives an unanswered runtime read; a failure still names its cause.
it.each(["unread", "failed"] as const)(
  "stopView handles a %s runtime answer beside the flow's version",
  (state) => {
    const deployment: Shown<Deployment> =
      state === "unread"
        ? { state, waitingFor: null }
        : {
            state,
            failure: { kind: "transport", detail: "closed" },
            atMs: 0,
            attempt: 1,
            retryAtMs: null,
          };
    const row = ROWS.find(({ row }) => row?.version.label !== undefined)!.row;
    const view = stopView({ deployment, row, nowMs: NOW });
    expect(view.version).toEqual(state === "unread" ? row!.version : undefined);
    expect(view.line).toBe(
      state === "unread"
        ? row!.version.label
        : "Couldn't read what runs here. Zerops didn't answer.",
    );
  },
);

it("a failed recheck reports the failure beside Again rather than presenting its stale runtime as healthy", () => {
  const deployment = known(RUNNING, "complete", {
    kind: "stale",
    sinceMs: NOW,
    reason: {
      kind: "revalidation-failed",
      failure: { kind: "transport", detail: "closed" },
      attempt: 1,
      retryAtMs: null,
    },
  });
  expect(stopView({ deployment, row: ROWS[2]!.row, nowMs: NOW }).line).toContain(
    "Zerops didn't answer.",
  );
  expect(stopTone(deployment, ROWS[2]!.row)).toBe("neutral");
});

it.each([
  null,
  {
    id: "active",
    status: "ACTIVE",
    source: "GIT",
    name: "v1.0.0",
    activatedAt: null,
    branch: null,
    commit: null,
    tag: null,
    repository: null,
  },
])("a stop settles from its services and its read running work (%j)", (deploy) => {
  const answer = stopServices(
    {
      services: servicesRead([record("app", "app", deployed(deploy))]),
      work: work(),
      versions: new Map(),
      refused: null,
      stated: new Map(),
      detail: false,
    },
    NOW,
  );
  expect(answer).toMatchObject({
    state: "known",
    value: [
      {
        deployment: {
          state: "known",
          value:
            deploy === null ? { kind: "none" } : { kind: "running", version: { label: "v1.0.0" } },
        },
      },
    ],
  });
});

it("a version with no id, which nothing can ever state, ends visibly instead of checking forever", () => {
  const answer = stopServices(
    {
      services: servicesRead([record("app", "app", deployed({ ...UNSTATED, id: null }))]),
      work: work(),
      versions: new Map(),
      refused: null,
      stated: new Map(),
      detail: false,
    },
    NOW,
  );
  expect(answer).toMatchObject({
    state: "known",
    value: [{ deployment: { state: "failed", retryAtMs: null } }],
  });
});

it("the embedded name of the active version settles a stop even when source is omitted", () => {
  const answer = stopServices(
    {
      services: servicesRead([record("app", "app", deployed({ ...UNSTATED, name: "v1.0.0" }))]),
      work: work(),
      versions: new Map(),
      refused: null,
      stated: new Map(),
      detail: false,
    },
    NOW,
  );
  expect(answer).toMatchObject({
    state: "known",
    value: [
      { deployment: { state: "known", value: { kind: "running", version: { label: "v1.0.0" } } } },
    ],
  });
});

it("a deployment facet not stated yet is unknown until the service says, never a failure", () => {
  const answer = stopServices(
    {
      services: servicesRead([record("app", "app", UNRESOLVED_DEPLOYMENT)]),
      work: work(),
      versions: new Map(),
      refused: null,
      stated: new Map(),
      detail: false,
    },
    NOW,
  );
  expect(answer).toMatchObject({
    state: "known",
    value: [{ deployment: { state: "unread" } }],
  });
});
