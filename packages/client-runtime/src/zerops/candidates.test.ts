import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import {
  ADDRESS_GRACE_MS,
  addressSeenAfter,
  type AddressSeen,
  applyFirstBuildVerdict,
  firstBuildOverdue,
  applyProjectCreationVerdict,
  candidateContainerRuns,
  deriveZeropsCandidates,
  groupZeropsCandidates,
  zeropsMateBaseUrl,
} from "./candidates.ts";
import type { ZeropsProjectCreation } from "./projectCreation.ts";

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "kanban",
  status: "ACTIVE",
  clientId: "org-1",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

function service(overrides: Partial<ZeropsService> & { readonly id: string }): ZeropsService {
  return {
    name: "zcp",
    status: "ACTIVE",
    subdomainAccess: true,
    ports: [{ port: 8080, httpSupport: true }],
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    ...overrides,
  };
}

const NO_CONNECTIONS = new Map<string, EnvironmentId>();

describe("a project's creation verdict", () => {
  const NEW_PROJECT: ZeropsProject = { ...PROJECT, id: "project-new", status: "NEW" };
  const FAILED: ZeropsProjectCreation = {
    processId: "proc-1",
    status: "FAILED",
    error: { code: "internalServerError", message: "unexpected internal server error" },
  };

  const table: ReadonlyArray<{
    readonly name: string;
    readonly status: string;
    readonly creation: ZeropsProjectCreation | undefined;
    readonly group: "provisioning" | "unavailable";
    readonly creationFailed?: { readonly message: string | undefined };
  }> = [
    {
      name: "NEW with no verdict is a boot",
      status: "NEW",
      creation: undefined,
      group: "provisioning",
    },
    {
      name: "CREATING with a running process is a boot",
      status: "CREATING",
      creation: { processId: "proc-1", status: "RUNNING", error: null },
      group: "provisioning",
    },
    {
      name: "NEW with a finished process is still a boot (the services are next)",
      status: "NEW",
      creation: { processId: "proc-1", status: "FINISHED", error: null },
      group: "provisioning",
    },
    {
      name: "NEW with a FAILED process is a failed creation, carrying the platform's words",
      status: "NEW",
      creation: FAILED,
      group: "unavailable",
      creationFailed: { message: "unexpected internal server error" },
    },
    {
      name: "CREATING with a CANCELED process that said nothing is a failed creation",
      status: "CREATING",
      creation: { processId: "proc-1", status: "CANCELED", error: null },
      group: "unavailable",
      creationFailed: { message: undefined },
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const [candidate] = deriveZeropsCandidates(
      { ...NEW_PROJECT, status: row.status },
      null,
      NO_CONNECTIONS,
      row.creation,
    );
    expect(candidate?.group).toBe(row.group);
    if (row.creationFailed === undefined) {
      expect(candidate?.creationFailed).toBeUndefined();
      expect(candidate?.reason).toBe("project is being created");
    } else {
      expect(candidate?.creationFailed).toEqual(row.creationFailed);
      expect(candidate?.reason).toBe("creation failed");
    }
  });

  it("re-reads an already derived candidate the same way, keeping what else it carries", () => {
    const [candidate] = deriveZeropsCandidates(NEW_PROJECT, null, NO_CONNECTIONS);
    const presented = { ...candidate!, routes: [] as ReadonlyArray<never> };
    expect(applyProjectCreationVerdict(presented, undefined)).toBe(presented);
    expect(applyProjectCreationVerdict(presented, FAILED)).toEqual({
      key: "project-new",
      project: NEW_PROJECT,
      group: "unavailable",
      reason: "creation failed",
      creationFailed: { message: "unexpected internal server error" },
      routes: [],
    });
  });

  it("never touches a project that is not on its way up", () => {
    const [active] = deriveZeropsCandidates(PROJECT, [], NO_CONNECTIONS);
    expect(applyProjectCreationVerdict(active!, FAILED)).toBe(active);
    const [stopped] = deriveZeropsCandidates(
      { ...PROJECT, status: "STOPPED" },
      null,
      NO_CONNECTIONS,
    );
    expect(applyProjectCreationVerdict(stopped!, FAILED)).toBe(stopped);
  });
});

describe("candidateContainerRuns", () => {
  // A face wears its container: a socket this browser has not opened yet is the browser's wait,
  // not the Mate's sleep.
  it.each([
    ["connected", true],
    ["ready", true],
    ["provisioning", false],
    ["unavailable", false],
  ] as const)("a %s candidate's container runs: %s", (group, runs) => {
    expect(candidateContainerRuns({ group })).toBe(runs);
  });
});

describe("zeropsMateBaseUrl", () => {
  it("defers to the served prefix only for the container that serves this bundle", () => {
    const app = {
      origin: "https://zcp-current-8080.prg1.zerops.app",
      basePath: "/preview/mate",
    };

    expect(zeropsMateBaseUrl(app.origin, app)).toBe(
      "https://zcp-current-8080.prg1.zerops.app/preview/mate",
    );
    expect(zeropsMateBaseUrl("https://zcp-remote-8080.prg1.zerops.app", app)).toBe(
      "https://zcp-remote-8080.prg1.zerops.app/mate",
    );
  });
});

describe("deriveZeropsCandidates", () => {
  it("finds a zcp container by service type, whatever its hostname is", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", name: "workspace" })],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("ready");
    expect(candidates[0]?.service?.name).toBe("workspace");
    expect(candidates[0]?.containerOrigin).toBe("https://workspace-24cb-8080.prg1.zerops.app");
  });

  it("does not mistake a service merely named zcp for a container", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [
        service({
          id: "s1",
          name: "zcp",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "nodejs@22" },
        }),
      ],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toMatch(/no Zerops Mate container/i);
    expect(candidates[0]?.service).toBeUndefined();
    // The one unavailable case with an action, flagged structurally.
    expect(candidates[0]?.missingContainer).toBe(true);
  });

  it("does not flag a project whose services could not be read as missing a container", () => {
    const [candidate] = deriveZeropsCandidates(PROJECT, null, NO_CONNECTIONS);
    expect(candidate?.group).toBe("unavailable");
    expect(candidate?.missingContainer).toBeUndefined();
  });

  it("offers every zcp container in a project, not one per project", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [
        service({ id: "s1", name: "zcp" }),
        service({ id: "s2", name: "zcp2" }),
        service({
          id: "s3",
          name: "api",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "nodejs@22" },
        }),
      ],
      NO_CONNECTIONS,
    );

    expect(candidates.map((candidate) => candidate.service?.id)).toEqual(["s1", "s2"]);
    expect(candidates.every((candidate) => candidate.group === "ready")).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.key)).size).toBe(2);
  });

  it("reports a project still being created as provisioning, not unavailable", () => {
    const candidates = deriveZeropsCandidates(
      { ...PROJECT, status: "CREATING" },
      [service({ id: "s1" })],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("provisioning");
    expect(candidates[0]?.reason).toBe("project is being created");
  });

  it("reports a project in any other non-active status as unavailable, naming it", () => {
    const candidates = deriveZeropsCandidates(
      { ...PROJECT, status: "SUSPENDED" },
      [service({ id: "s1" })],
      NO_CONNECTIONS,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toBe("project is SUSPENDED");
  });

  it("reports a container that is not active as unavailable, naming its status", () => {
    const candidates = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", status: "STOPPED" })],
      NO_CONNECTIONS,
    );

    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toBe("container is STOPPED");
    // The service is still named, so the UI can offer to start it.
    expect(candidates[0]?.service?.id).toBe("s1");
  });

  it("reports a container that is starting as provisioning, naming its status", () => {
    // READY_TO_DEPLOY: a Mate's container is never deployed by hand — it waits for its first
    // build, which the import started (measured 2026-10-02: 45 s of it on an Add).
    for (const status of [
      "NEW",
      "CREATING",
      "STARTING",
      "RESTARTING",
      "UPGRADING",
      "READY_TO_DEPLOY",
    ]) {
      const candidates = deriveZeropsCandidates(
        PROJECT,
        [service({ id: "s1", status })],
        NO_CONNECTIONS,
      );

      expect(candidates[0]?.group).toBe("provisioning");
      expect(candidates[0]?.reason).toBe(`container is starting (${status})`);
      expect(candidates[0]?.service?.id).toBe("s1");
    }
  });

  it("names the specific reason a container has no reachable origin", () => {
    const noSubdomain = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", subdomainAccess: false })],
      NO_CONNECTIONS,
    );
    expect(noSubdomain[0]?.group).toBe("unavailable");
    expect(noSubdomain[0]?.reason).toMatch(/public access/i);

    const noPort = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", ports: [{ port: 3773 }] })],
      NO_CONNECTIONS,
    );
    expect(noPort[0]?.group).toBe("unavailable");
    expect(noPort[0]?.reason).toMatch(/8080/);

    const noZone = deriveZeropsCandidates(
      { ...PROJECT, publicZone: "not-a-zone" },
      [service({ id: "s1" })],
      NO_CONNECTIONS,
    );
    expect(noZone[0]?.group).toBe("unavailable");
    expect(noZone[0]?.reason).toMatch(/subdomain/i);
  });

  it("marks a container already registered as an environment as connected", () => {
    const environmentId = EnvironmentId.make("env-1");
    const connected = new Map([["https://zcp-24cb-8080.prg1.zerops.app", environmentId]]);

    const candidates = deriveZeropsCandidates(PROJECT, [service({ id: "s1" })], connected);

    expect(candidates[0]?.group).toBe("connected");
    expect(candidates[0]?.environmentId).toBe(environmentId);
  });

  it("says so when a project's services could not be read, instead of claiming there is no container", () => {
    const candidates = deriveZeropsCandidates(PROJECT, null, NO_CONNECTIONS);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.group).toBe("unavailable");
    expect(candidates[0]?.reason).toMatch(/could not be read/i);
  });
});

describe("groupZeropsCandidates", () => {
  it("buckets candidates by group and keeps their order inside each bucket", () => {
    const environmentId = EnvironmentId.make("env-1");
    const connected = new Map([["https://zcp-24cb-8080.prg1.zerops.app", environmentId]]);
    const candidates = [
      ...deriveZeropsCandidates(
        PROJECT,
        [
          service({ id: "s1" }),
          service({ id: "s2", name: "zcp2" }),
          service({ id: "s3", name: "zcp3", status: "STOPPED" }),
          service({ id: "s4", name: "zcp4", status: "STARTING" }),
        ],
        connected,
      ),
      ...deriveZeropsCandidates(
        { ...PROJECT, id: "project-2", status: "STOPPED" },
        null,
        connected,
      ),
      ...deriveZeropsCandidates(
        { ...PROJECT, id: "project-3", status: "CREATING" },
        null,
        connected,
      ),
    ];

    const grouped = groupZeropsCandidates(candidates);

    expect(grouped.connected.map((candidate) => candidate.service?.id)).toEqual(["s1"]);
    expect(grouped.ready.map((candidate) => candidate.service?.id)).toEqual(["s2"]);
    expect(
      grouped.provisioning.map((candidate) => candidate.service?.id ?? candidate.project.id),
    ).toEqual(["s4", "project-3"]);
    expect(grouped.unavailable.map((candidate) => candidate.project.id)).toEqual([
      "project-1",
      "project-2",
    ]);
  });
});

// A Mate's first build that failed leaves its service READY_TO_DEPLOY for good (a failed
// buildFromGit, the ledger); one that is merely slow looks the same from its status. Past the
// build's grace it is overdue — still on its way, taking longer — never removed on a guess.
describe("firstBuildOverdue", () => {
  const NOW = Date.parse("2026-10-02T12:00:00.000Z");
  /** Its service, in `status`, made at `created`. */
  const candidate = (created: string | undefined, status = "READY_TO_DEPLOY") =>
    deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", status, ...(created === undefined ? {} : { created }) })],
      NO_CONNECTIONS,
    )[0]!;

  it.each([
    { case: "a minute into its first build", created: "2026-10-02T11:59:00.000Z", overdue: false },
    { case: "its creation time unknown", created: undefined, overdue: false },
    {
      case: "made after this browser's now (its clock slow)",
      created: "2026-10-02T12:03:00.000Z",
      overdue: false,
    },
    { case: "twenty minutes on, never built", created: "2026-10-02T11:40:00.000Z", overdue: true },
  ])("$case: $overdue", ({ created, overdue }) => {
    expect(firstBuildOverdue(candidate(created), NOW)).toBe(overdue);
  });

  it("stays on its way, whatever its age", () => {
    expect(candidate("2026-10-02T11:40:00.000Z").group).toBe("provisioning");
  });

  it("is never said of a container in any other state", () => {
    expect(firstBuildOverdue(candidate("2020-01-01T00:00:00Z", "STARTING"), NOW)).toBe(false);
  });
});

// A first build is over when its build's process says so, never by its age: a slow or queued one
// stays on its way however long it takes, and a failed one is unavailable with what removes it.
describe("applyFirstBuildVerdict", () => {
  const candidate = (created: string, status = "READY_TO_DEPLOY") =>
    deriveZeropsCandidates(PROJECT, [service({ id: "s1", status, created })], NO_CONNECTIONS)[0]!;
  const LONG_AGO = "2026-10-02T11:20:00.000Z";

  it.each([
    { case: "forty minutes on, its build running: on its way", build: { kind: "running" } },
    { case: "forty minutes on, nothing known of its build: on its way", build: undefined },
  ] as const)("$case", ({ build }) => {
    expect(applyFirstBuildVerdict(candidate(LONG_AGO), build).group).toBe("provisioning");
  });

  it("its build failed: unavailable in the platform's words, its service kept", () => {
    const failed = applyFirstBuildVerdict(candidate(LONG_AGO), {
      kind: "failed",
      why: "Build failed: npm ERR! code ENOENT",
    });
    expect(failed.group).toBe("unavailable");
    expect(failed.reason).toBe("Build failed: npm ERR! code ENOENT");
    expect(failed.service?.id).toBe("s1");
  });

  it("never touches a container in any other state", () => {
    const starting = candidate(LONG_AGO, "STARTING");
    expect(applyFirstBuildVerdict(starting, { kind: "failed", why: "the build failed" })).toBe(
      starting,
    );
  });
});

// A Mate's container turns ACTIVE a second or more before the platform enables its address, and
// the record of it lands later still (measured 2026-10-02: the tab held ACTIVE without an address
// for 5.6 s). While it is young, that is a container on its way to its address — never one without
// any; past the grace, the same facts read as the platform leaves them.
describe("a young container ACTIVE before its address landed", () => {
  const CREATED_AT = "2026-10-02T12:00:00.000Z";
  const CREATED = Date.parse(CREATED_AT);
  const at = (ms: number) => CREATED + ms;
  const MINUTE = 60_000;

  const table: ReadonlyArray<{
    readonly case: string;
    readonly service: Partial<ZeropsService>;
    readonly project?: Partial<ZeropsProject>;
    /** Since its creation, ms; undefined when no clock judges it. */
    readonly now: number | undefined;
    /**
     * What this reader holds of its address: when it first saw it ACTIVE without one, since its
     * creation, or that it saw it with one.
     */
    readonly seen?: number | "addressed";
    readonly created?: string | null;
    readonly group: "provisioning" | "unavailable";
    readonly awaited?: { readonly since: number; readonly until: number };
    readonly reason?: RegExp;
  }> = [
    {
      case: "seen so for the first time, its access not enabled yet: on its way",
      service: { subdomainAccess: false },
      now: 110_000,
      group: "provisioning",
      awaited: { since: 110_000, until: 110_000 + ADDRESS_GRACE_MS },
    },
    {
      case: "seen so a moment ago: still on its way, its wait dated where it began",
      service: { subdomainAccess: false },
      now: 115_000,
      seen: 110_000,
      group: "provisioning",
      awaited: { since: 110_000, until: 110_000 + ADDRESS_GRACE_MS },
    },
    {
      case: "its port not read yet: on its way the same",
      service: { ports: [] },
      now: 110_000,
      group: "provisioning",
      awaited: { since: 110_000, until: 110_000 + ADDRESS_GRACE_MS },
    },
    {
      case: "its project's subdomain not read yet: on its way the same",
      service: {},
      project: { zeropsSubdomainHost: "" },
      now: 110_000,
      group: "provisioning",
      awaited: { since: 110_000, until: 110_000 + ADDRESS_GRACE_MS },
    },
    {
      case: "a slow first build turned ACTIVE late: its wait ends with its first minutes",
      service: { subdomainAccess: false },
      now: 31 * MINUTE,
      group: "provisioning",
      awaited: { since: 31 * MINUTE, until: 30 * MINUTE + ADDRESS_GRACE_MS },
    },
    {
      case: "seen so past its grace: no public address",
      service: { subdomainAccess: false },
      now: 110_000 + ADDRESS_GRACE_MS,
      seen: 110_000,
      group: "unavailable",
      reason: /public access/i,
    },
    {
      case: "an old Mate whose access is off, on a reload: no public address at once",
      service: { subdomainAccess: false },
      now: 3 * 60 * MINUTE,
      group: "unavailable",
      reason: /public access/i,
    },
    {
      case: "its creation time unknown: no public address, as the platform leaves it",
      service: { subdomainAccess: false },
      created: null,
      now: 110_000,
      group: "unavailable",
    },
    {
      case: "seen with its address before, its access now off: no public address, never a wait",
      service: { subdomainAccess: false },
      now: 20 * MINUTE,
      seen: "addressed",
      group: "unavailable",
      reason: /public access/i,
    },
    {
      case: "no clock judges it: as the platform leaves it",
      service: { subdomainAccess: false },
      now: undefined,
      group: "unavailable",
    },
  ];

  it.each(table)("$case", (row) => {
    const created = row.created === null ? {} : { created: row.created ?? CREATED_AT };
    const [candidate] = deriveZeropsCandidates(
      { ...PROJECT, ...row.project },
      [service({ id: "s1", ...created, ...row.service })],
      NO_CONNECTIONS,
      undefined,
      row.now === undefined
        ? undefined
        : {
            nowMs: at(row.now),
            addressSeen: (serviceId) =>
              serviceId !== "s1" || row.seen === undefined
                ? undefined
                : row.seen === "addressed"
                  ? { addressed: true }
                  : { addressed: false, since: at(row.seen) },
          },
    );
    expect(candidate?.group).toBe(row.group);
    expect(candidate?.service?.id).toBe("s1");
    expect(candidate?.containerOrigin).toBeUndefined();
    expect(candidate?.addressAwaited).toEqual(
      row.awaited === undefined
        ? undefined
        : { since: at(row.awaited.since), until: at(row.awaited.until) },
    );
    if (row.reason !== undefined) expect(candidate?.reason).toMatch(row.reason);
  });

  it("is ready the moment its address lands, its wait over", () => {
    const [candidate] = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", created: CREATED_AT })],
      NO_CONNECTIONS,
      undefined,
      { nowMs: at(115_300), addressSeen: () => ({ addressed: false, since: at(110_000) }) },
    );
    expect(candidate?.group).toBe("ready");
    expect(candidate?.addressAwaited).toBeUndefined();
  });
});

// Run 4, 2 Oct 2026: in a window that did not make it, a new Mate's row read asleep for the 15 s
// between its address landing and its server answering. A reader that watched it wait for its
// address holds it on its way to answering on the same clock; one that first sees it with its
// address — a reload — never says so, so it paints nothing it takes back.
describe("a young container whose address landed, its Mate not answering yet", () => {
  const CREATED_AT = "2026-10-02T12:00:00.000Z";
  const CREATED = Date.parse(CREATED_AT);
  const at = (ms: number) => CREATED + ms;
  const MINUTE = 60_000;

  it.each<{
    readonly case: string;
    /** Since its creation, ms; undefined when no clock judges it. */
    readonly now: number | undefined;
    readonly seen?: AddressSeen;
    readonly arriving?: { readonly since: number; readonly until: number };
  }>([
    {
      case: "its address lands while this reader waits for it: on its way, on the wait's clock",
      now: 115_300,
      seen: { addressed: false, since: at(110_000) },
      arriving: { since: 110_000, until: 110_000 + ADDRESS_GRACE_MS },
    },
    {
      case: "seen with its address since that wait: still on its way",
      now: 125_000,
      seen: { addressed: true, since: at(110_000) },
      arriving: { since: 110_000, until: 110_000 + ADDRESS_GRACE_MS },
    },
    {
      case: "a slow first build turned ACTIVE late: its wait ends with its first minutes",
      now: 31 * MINUTE + 10_000,
      seen: { addressed: true, since: at(31 * MINUTE) },
      arriving: { since: 31 * MINUTE, until: 30 * MINUTE + ADDRESS_GRACE_MS },
    },
    {
      case: "seen in its first build, then ACTIVE with its address at once: on its way from now",
      now: 152_000,
      seen: { addressed: false, building: true },
      arriving: { since: 152_000, until: 152_000 + ADDRESS_GRACE_MS },
    },
    {
      case: "past its wait: ready, and nothing says it is on its way",
      now: 110_000 + ADDRESS_GRACE_MS,
      seen: { addressed: true, since: at(110_000) },
    },
    {
      case: "first seen with its address, as a reload sees it: nothing on its way",
      now: 125_000,
    },
    {
      case: "seen with its address and never waiting for it: nothing on its way",
      now: 125_000,
      seen: { addressed: true },
    },
    {
      case: "no clock judges it: as the platform leaves it",
      now: undefined,
      seen: { addressed: true, since: at(110_000) },
    },
  ])("$case", (row) => {
    const [candidate] = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", created: CREATED_AT })],
      NO_CONNECTIONS,
      undefined,
      row.now === undefined ? undefined : { nowMs: at(row.now), addressSeen: () => row.seen },
    );
    expect(candidate?.group).toBe("ready");
    expect(candidate?.containerOrigin).toBeDefined();
    expect(candidate?.arriving).toEqual(
      row.arriving === undefined
        ? undefined
        : { since: at(row.arriving.since), until: at(row.arriving.until) },
    );
  });
});

// What a reader keeps of each container's address once a derivation read it: a container seen with
// its address never waits for it again, and a wait's first moment is kept — after its end too.
describe("addressSeenAfter", () => {
  const CREATED_AT = "2026-10-02T12:00:00.000Z";
  const CREATED = Date.parse(CREATED_AT);
  const derive = (subdomainAccess: boolean, nowMs: number, held?: AddressSeen, status = "ACTIVE") =>
    deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", created: CREATED_AT, subdomainAccess, status })],
      NO_CONNECTIONS,
      undefined,
      { nowMs, addressSeen: () => held },
    )[0]!;
  const BUILDING = { addressed: false, building: true } as const;
  const WITHOUT = { addressed: false, since: CREATED + 110_000 } as const;

  it.each<{
    readonly case: string;
    readonly held: AddressSeen | undefined;
    readonly subdomainAccess: boolean;
    readonly now: number;
    readonly status?: string;
    readonly kept: AddressSeen | undefined;
  }>([
    {
      case: "first seen in its first build: its arrival is this reader's to see",
      held: undefined,
      subdomainAccess: false,
      now: 60_000,
      status: "READY_TO_DEPLOY",
      kept: BUILDING,
    },
    {
      case: "seen in its first build again: kept",
      held: BUILDING,
      subdomainAccess: false,
      now: 90_000,
      status: "READY_TO_DEPLOY",
      kept: BUILDING,
    },
    {
      case: "a restart is never a first build: nothing to keep",
      held: undefined,
      subdomainAccess: true,
      now: 60_000,
      status: "RESTARTING",
      kept: undefined,
    },
    {
      case: "seen building, then ACTIVE without its address: its wait begins now",
      held: BUILDING,
      subdomainAccess: false,
      now: 152_000,
      kept: { addressed: false, since: CREATED + 152_000 },
    },
    {
      case: "seen building, then ACTIVE with its address at once: seen with it, from now",
      held: BUILDING,
      subdomainAccess: true,
      now: 152_000,
      kept: { addressed: true, since: CREATED + 152_000 },
    },
    {
      case: "first seen without its address: its wait begins now",
      held: undefined,
      subdomainAccess: false,
      now: 110_000,
      kept: WITHOUT,
    },
    {
      case: "seen without it again: the first moment is kept",
      held: WITHOUT,
      subdomainAccess: false,
      now: 113_000,
      kept: WITHOUT,
    },
    {
      case: "past its wait: the first moment is kept, so it never begins again",
      held: WITHOUT,
      subdomainAccess: false,
      now: 110_000 + ADDRESS_GRACE_MS + 10_000,
      kept: WITHOUT,
    },
    {
      case: "its address landed: seen with it, on the clock its wait began",
      held: WITHOUT,
      subdomainAccess: true,
      now: 115_300,
      kept: { addressed: true, since: WITHOUT.since },
    },
    {
      case: "first seen with its address: seen with it, and no wait to date it by",
      held: undefined,
      subdomainAccess: true,
      now: 115_300,
      kept: { addressed: true },
    },
    {
      case: "seen with it, its access off later: still seen with it",
      held: { addressed: true },
      subdomainAccess: false,
      now: 20 * 60_000,
      kept: { addressed: true },
    },
    {
      case: "an old container without its address, never seen with one: nothing to keep",
      held: undefined,
      subdomainAccess: false,
      now: 3 * 60 * 60_000,
      kept: undefined,
    },
  ])("$case", ({ held, subdomainAccess, now, status, kept }) => {
    expect(addressSeenAfter(derive(subdomainAccess, CREATED + now, held, status), held)).toEqual(
      kept,
    );
  });
});
