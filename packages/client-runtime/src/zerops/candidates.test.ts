import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import {
  ARRIVAL_MS,
  addressSeenAfter,
  type AddressSeen,
  applyFirstBuildVerdict,
  firstBuildOverdue,
  applyProjectCreationVerdict,
  candidateContainerRuns,
  deriveZeropsCandidates,
  groupZeropsCandidates,
  subdomainEnableOf,
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
// for 5.6 s). Whether its address is coming is the platform's `stack.enableSubdomainAccess`
// process's to say, never a clock's.
describe("subdomainEnableOf", () => {
  const process = (actionName: string, status: string, created: string, serviceId = "s1") => ({
    actionName,
    serviceStackIds: [serviceId],
    status,
    created,
  });
  const ENABLE = "stack.enableSubdomainAccess";
  const DISABLE = "stack.disableSubdomainAccess";

  it.each<{
    readonly case: string;
    readonly processes: ReadonlyArray<ReturnType<typeof process>> | undefined;
    readonly said: "on" | "off" | undefined;
  }>([
    { case: "its processes not read: not known", processes: undefined, said: undefined },
    {
      case: "an enable queued: on",
      processes: [process(ENABLE, "PENDING", "2026-10-02T12:00:00Z")],
      said: "on",
    },
    {
      case: "an enable running: on",
      processes: [process(ENABLE, "RUNNING", "2026-10-02T12:00:00Z")],
      said: "on",
    },
    {
      case: "an enable finished, the record still behind it: on",
      processes: [process(ENABLE, "FINISHED", "2026-10-02T12:00:00Z")],
      said: "on",
    },
    {
      case: "an enable failed: off",
      processes: [process(ENABLE, "FAILED", "2026-10-02T12:00:00Z")],
      said: "off",
    },
    {
      case: "a disable after the enable: off",
      processes: [
        process(ENABLE, "FINISHED", "2026-10-02T12:00:00Z"),
        process(DISABLE, "FINISHED", "2026-10-02T13:00:00Z"),
      ],
      said: "off",
    },
    {
      case: "an enable again after a disable: on",
      processes: [
        process(DISABLE, "FINISHED", "2026-10-02T12:00:00Z"),
        process(ENABLE, "RUNNING", "2026-10-02T13:00:00Z"),
      ],
      said: "on",
    },
    {
      case: "none for this service: off",
      processes: [
        process(ENABLE, "RUNNING", "2026-10-02T12:00:00Z", "s2"),
        process("stack.build", "RUNNING", "2026-10-02T12:00:00Z"),
      ],
      said: "off",
    },
  ])("$case", ({ processes, said }) => {
    expect(subdomainEnableOf(processes, "s1")).toBe(said);
  });

  // The record follows a finished enable seconds later. Zerops' own times say when it caught up:
  // a service record last updated after the enable's end that still lacks the address — never the
  // order this browser happened to read them in (client review #2, #4a).
  it.each([
    { case: "its record's time not known: on", updatedAt: null, said: "on" },
    {
      case: "its record last updated before the enable ended: on",
      updatedAt: "2026-10-02T12:00:04Z",
      said: "on",
    },
    {
      case: "its record last updated after the enable ended: off",
      updatedAt: "2026-10-02T12:00:09Z",
      said: "off",
    },
  ] as const)("a finished enable, $case", ({ updatedAt, said }) => {
    const finished = {
      ...process(ENABLE, "FINISHED", "2026-10-02T12:00:00Z"),
      finished: "2026-10-02T12:00:05Z",
    };
    expect(subdomainEnableOf([finished], "s1", updatedAt)).toBe(said);
  });
});

describe("a container ACTIVE before its address landed", () => {
  const BUILDING = { addressed: false, building: true } as const;

  it.each<{
    readonly case: string;
    readonly service: Partial<ZeropsService>;
    readonly project?: Partial<ZeropsProject>;
    /** What the platform says of turning its address on; no facts at all where null. */
    readonly enable: "on" | "off" | undefined | null;
    readonly seen?: AddressSeen;
    readonly group: "provisioning" | "unavailable";
    readonly reason?: RegExp;
  }>([
    {
      case: "its address being turned on: on its way, however long that takes",
      service: { subdomainAccess: false },
      enable: "on",
      group: "provisioning",
    },
    {
      case: "its port not read yet, its address being turned on: on its way the same",
      service: { ports: [] },
      enable: "on",
      group: "provisioning",
    },
    {
      case: "its project's subdomain not read yet, its address being turned on: on its way",
      service: {},
      project: { zeropsSubdomainHost: "" },
      enable: "on",
      group: "provisioning",
    },
    {
      case: "its address not being turned on: no public address",
      service: { subdomainAccess: false },
      enable: "off",
      seen: BUILDING,
      group: "unavailable",
      reason: /public access/i,
    },
    {
      case: "its processes not read yet, watched coming up: on its way",
      service: { subdomainAccess: false },
      enable: undefined,
      seen: BUILDING,
      group: "provisioning",
    },
    {
      case: "its processes not read yet, on a reload: no public address, as the platform leaves it",
      service: { subdomainAccess: false },
      enable: undefined,
      group: "unavailable",
      reason: /public access/i,
    },
    {
      case: "seen with its address before, its access now off: no public address, never a wait",
      service: { subdomainAccess: false },
      enable: "on",
      seen: { addressed: true },
      group: "unavailable",
      reason: /public access/i,
    },
    {
      case: "no facts judge it: as the platform leaves it",
      service: { subdomainAccess: false },
      enable: null,
      group: "unavailable",
    },
  ])("$case", (row) => {
    const [candidate] = deriveZeropsCandidates(
      { ...PROJECT, ...row.project },
      [service({ id: "s1", ...row.service })],
      NO_CONNECTIONS,
      undefined,
      row.enable === null
        ? undefined
        : {
            nowMs: 0,
            addressSeen: (serviceId) => (serviceId === "s1" ? row.seen : undefined),
            subdomainEnable: (projectId, serviceId) =>
              projectId === PROJECT.id && serviceId === "s1" ? row.enable! : undefined,
          },
    );
    expect(candidate?.group).toBe(row.group);
    expect(candidate?.service?.id).toBe("s1");
    expect(candidate?.containerOrigin).toBeUndefined();
    expect(candidate?.addressAwaited).toBe(row.group === "provisioning" ? true : undefined);
    if (row.reason !== undefined) expect(candidate?.reason).toMatch(row.reason);
  });

  it("is ready the moment its address lands, its wait over", () => {
    const [candidate] = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1" })],
      NO_CONNECTIONS,
      undefined,
      {
        nowMs: 0,
        addressSeen: () => BUILDING,
        subdomainEnable: () => "on",
      },
    );
    expect(candidate?.group).toBe("ready");
    expect(candidate?.addressAwaited).toBeUndefined();
  });
});

// Run 4, 2 Oct 2026: in a window that did not make it, a new Mate's row read asleep for the 15 s
// between its address landing and its server answering. A reader that watched it come up holds it
// on its way to answering for a moment — a pose; one that first sees it with its address — a
// reload — never says so, so it paints nothing it takes back.
describe("a young container whose address landed, its Mate not answering yet", () => {
  const LANDED = Date.parse("2026-10-02T12:02:00.000Z");

  it.each<{
    readonly case: string;
    /** Since its address landed, ms; undefined when no facts judge it. */
    readonly now: number | undefined;
    readonly seen?: AddressSeen;
    readonly arriving?: { readonly since: number; readonly until: number };
  }>([
    {
      case: "its address lands where this reader watched it come up: on its way from now",
      now: 0,
      seen: { addressed: false, building: true },
      arriving: { since: 0, until: ARRIVAL_MS },
    },
    {
      case: "seen with its address since: still on its way",
      now: 10_000,
      seen: { addressed: true, since: LANDED },
      arriving: { since: 0, until: ARRIVAL_MS },
    },
    {
      case: "past its pose: ready, and nothing says it is on its way",
      now: ARRIVAL_MS,
      seen: { addressed: true, since: LANDED },
    },
    { case: "first seen with its address, as a reload sees it: nothing on its way", now: 10_000 },
    {
      case: "seen with its address and never watched coming up: nothing on its way",
      now: 10_000,
      seen: { addressed: true },
    },
    {
      case: "no facts judge it: as the platform leaves it",
      now: undefined,
      seen: { addressed: true, since: LANDED },
    },
  ])("$case", (row) => {
    const [candidate] = deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1" })],
      NO_CONNECTIONS,
      undefined,
      row.now === undefined ? undefined : { nowMs: LANDED + row.now, addressSeen: () => row.seen },
    );
    expect(candidate?.group).toBe("ready");
    expect(candidate?.containerOrigin).toBeDefined();
    expect(candidate?.arriving).toEqual(
      row.arriving === undefined
        ? undefined
        : { since: LANDED + row.arriving.since, until: LANDED + row.arriving.until },
    );
  });
});

// What a reader keeps of each container's address once a derivation read it: a container seen with
// its address never waits for it again, and one watched coming up stays watched until it lands.
describe("addressSeenAfter", () => {
  const NOW = Date.parse("2026-10-02T12:02:00.000Z");
  const derive = (
    subdomainAccess: boolean,
    held: AddressSeen | undefined,
    status = "ACTIVE",
    enable: "on" | "off" = "off",
  ) =>
    deriveZeropsCandidates(
      PROJECT,
      [service({ id: "s1", subdomainAccess, status })],
      NO_CONNECTIONS,
      undefined,
      { nowMs: NOW, addressSeen: () => held, subdomainEnable: () => enable },
    )[0]!;
  const BUILDING = { addressed: false, building: true } as const;

  it.each<{
    readonly case: string;
    readonly held: AddressSeen | undefined;
    readonly subdomainAccess: boolean;
    readonly status?: string;
    readonly enable?: "on" | "off";
    readonly kept: AddressSeen | undefined;
  }>([
    {
      case: "first seen in its first build: its arrival is this reader's to see",
      held: undefined,
      subdomainAccess: false,
      status: "READY_TO_DEPLOY",
      kept: BUILDING,
    },
    {
      case: "a restart is never a first build: nothing to keep",
      held: undefined,
      subdomainAccess: true,
      status: "RESTARTING",
      kept: undefined,
    },
    {
      case: "first seen while its address is turned on: watched coming up",
      held: undefined,
      subdomainAccess: false,
      enable: "on",
      kept: BUILDING,
    },
    {
      case: "watched coming up, ACTIVE without its address: still watched",
      held: BUILDING,
      subdomainAccess: false,
      enable: "on",
      kept: BUILDING,
    },
    {
      case: "watched coming up, its address landed: seen with it, from now",
      held: BUILDING,
      subdomainAccess: true,
      kept: { addressed: true, since: NOW },
    },
    {
      case: "first seen with its address: seen with it, and no arrival to date it by",
      held: undefined,
      subdomainAccess: true,
      kept: { addressed: true },
    },
    {
      case: "seen with it, its access off later: still seen with it",
      held: { addressed: true },
      subdomainAccess: false,
      kept: { addressed: true },
    },
    {
      case: "a container without its address, not being turned on: nothing to keep",
      held: undefined,
      subdomainAccess: false,
      kept: undefined,
    },
  ])("$case", ({ held, subdomainAccess, status, enable, kept }) => {
    expect(addressSeenAfter(derive(subdomainAccess, held, status, enable), held)).toEqual(kept);
  });
});
