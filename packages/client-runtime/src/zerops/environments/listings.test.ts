import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { ProjectProcesses } from "../../data/projections/processes.ts";
import type { OrganizationProjects } from "../../data/projections/projects.ts";
import { accountReadsAtom, type AccountReads } from "../../data/reads.ts";
import type { ActivityProcess } from "../activity/dto.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { organization, project, service, stamp } from "../data/__fixtures__/index.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { ZeropsOrganizationId, type ServiceRecord } from "../data/types.ts";
import type { Known } from "../knowledge/known.ts";
import { knownRoster, mateListingsAtom } from "./listings.ts";

const ROSTER: OrganizationProjects = {
  projects: [],
  read: "read",
  complete: true,
  live: true,
  reconnecting: false,
};

describe("knownRoster", () => {
  const project = { id: "p1", name: "shop", status: "ACTIVE" };
  it.each<{
    readonly name: string;
    readonly roster: Partial<OrganizationProjects>;
    readonly known: Known<ReadonlyArray<unknown>>;
  }>([
    {
      name: "not asked for",
      roster: { read: "unread" },
      known: { state: "unread", waitingFor: null },
    },
    {
      name: "its first baseline under way",
      roster: { read: "reading", live: false },
      known: { state: "reading", sinceMs: 7, attempt: 1 },
    },
    {
      name: "refused before it was ever read",
      roster: { read: "reading", live: false, unavailableReason: "expired-session" },
      known: {
        state: "failed",
        failure: { kind: "unauthorized" },
        atMs: 7,
        attempt: 1,
        retryAtMs: null,
      },
    },
    {
      name: "read and live",
      roster: { projects: [project] },
      known: {
        state: "known",
        value: [project],
        asOf: { ordinal: 0, atMs: 7 },
        coverage: "complete",
        freshness: { kind: "live" },
      },
    },
    {
      name: "read, something of it still open",
      roster: { projects: [project], complete: false },
      known: expect.objectContaining({ coverage: "partial" }),
    },
    {
      name: "read, its source down: kept, catching up",
      roster: { projects: [project], live: false, reconnecting: true },
      known: expect.objectContaining({
        value: [project],
        freshness: {
          kind: "stale",
          reason: { kind: "source-recovering", retryAtMs: null },
          sinceMs: 7,
        },
      }),
    },
    {
      name: "read, then refused: kept, never claimed gone",
      roster: { projects: [project], live: false, unavailableReason: "forbidden" },
      known: expect.objectContaining({
        state: "known",
        value: [project],
        freshness: expect.objectContaining({ kind: "stale" }),
      }),
    },
  ])("$name", ({ roster, known }) => {
    expect(knownRoster({ ...ROSTER, ...roster }, 7)).toEqual(known);
  });
});

describe("mateListingsAtom: a container ACTIVE before its address landed", () => {
  const CREATED_AT = "2026-10-02T12:00:00.000Z";
  const CREATED = Date.parse(CREATED_AT);

  const admission = {
    lastNativeReceiptOrdinal: null,
    lastAppliedAuthoritativeDispatchOrdinal: null,
    hasAuthoritativeObservation: true,
  };
  const observed = <Fields>(fields: Fields) => ({
    knowledge: "observed" as const,
    fields,
    unresolvedRequiredFields: [] as const,
    source: "direct-read" as const,
    stamp: stamp(1),
    admission,
  });
  const unresolved = {
    knowledge: "unresolved",
    fields: {},
    unresolvedRequiredFields: [],
    admission,
  };

  const shop = {
    id: project().projectId,
    name: "shop",
    status: "ACTIVE",
    tagList: [],
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "24cb",
    mode: "LIGHT",
  };

  /** The project's zcp service, ACTIVE, its address enabled or not yet. */
  /** The project's zcp service, ACTIVE, its address enabled or not, its record last updated then. */
  const zcp = (subdomainAccess: boolean, updatedAt: string | null = null): ServiceRecord =>
    ({
      ref: service("service-1", project()),
      identity: observed({
        hostname: "zcp",
        type: { versionName: "zcp@1", displayName: "Zerops Mate", category: "runtime" },
      }),
      lifecycle: observed({ status: "ACTIVE", createdAt: CREATED_AT, updatedAt }),
      routing: observed({
        subdomainAccess,
        ports: [{ port: 8080, protocol: "TCP", scheme: "http", httpSupport: true }],
      }),
      deployment: unresolved,
      scaling: unresolved,
    }) as unknown as ServiceRecord;

  /** A read the platform answered whole. */
  const read = <R>(records: ReadonlyArray<R>, slice?: ReturnType<typeof project>) =>
    ({
      value: records.map((record) => ({ knowledge: "observed", record })),
      query: {
        status: "observed",
        unresolvedMemberKeys: [],
        stamp: stamp(1),
        coverage: { kind: "exhausted-traversal" },
        descriptor: { organization },
      },
      observation: { required: [], optional: [] },
      ...(slice === undefined ? {} : { project: slice }),
    }) as unknown;

  /** The organization's projects as the account's store holds them. */
  const roster = (projects: ReadonlyArray<typeof shop>): OrganizationProjects => ({
    ...ROSTER,
    projects,
  });
  /** The roster not read (again) yet: the listing holds no rows. */
  const unreadProjects: OrganizationProjects = { ...ROSTER, read: "reading", live: false };

  const admitted = (yes: boolean) => ({
    status: "verified",
    projects: yes ? [{ project: project(), role: "OWNER" }] : [],
  });

  /**
   * The project's `stack.enableSubdomainAccess` for its zcp service, in this status: one that
   * finished ended at 12:01:45 on Zerops' clock.
   */
  const enable = (status: string): ActivityProcess => ({
    id: "enable-1",
    projectId: project().projectId,
    serviceStackIds: ["service-1"],
    status,
    actionName: "stack.enableSubdomainAccess",
    created: "2026-10-02T12:01:40.000Z",
    ...(status === "RUNNING" ? {} : { finished: "2026-10-02T12:01:45.000Z" }),
  });

  /** The project's processes as the account's store holds them: running ones and the history. */
  const activityOf = (enableStatus: string | null, read = true): ProjectProcesses => ({
    processes: !read ? undefined : enableStatus === null ? [] : [enable(enableStatus)],
    running: enableStatus === "RUNNING" ? [enable(enableStatus)] : [],
    live: true,
    reconnecting: false,
    history: read ? "read" : "reading",
  });

  const listingOver = () => {
    const registry = AtomRegistry.make();
    const servicesRead = Atom.make<unknown>(read([], project()));
    const projectsRead = Atom.make<OrganizationProjects>(roster([shop]));
    const access = Atom.make<unknown>(admitted(true));
    const activity = Atom.make<ProjectProcesses>(activityOf(null, false));
    // The account's store, as far as the listing reads it: the roster and this project's processes.
    registry.set(accountReadsAtom, {
      data: {
        project: (projection: { readonly name: string }) =>
          projection.name === "organizationProjects" ? projectsRead : activity,
      } as unknown as AccountReads["data"],
      orgId: organization.organizationId,
      demandDetail: () => () => {},
    });
    const data = {
      scope: { account: organization.account },
      access: {
        view: Atom.make({
          machine: {
            phase: {
              phase: "granted",
              evidence: {
                account: { organizations: [{ organization }] },
                projects: new Map(),
                unverified: new Map(),
                closedProjects: new Map(),
              },
            },
          },
        }),
      },
      reads: {
        access,
        servicesOf: () => servicesRead,
      },
    } as unknown as ManagedZeropsDataRuntime;
    const listings = mateListingsAtom(data);
    registry.mount(listings);
    return {
      apply: (event: Event) => {
        switch (event) {
          case "address-off":
          case "address-on":
            return registry.set(servicesRead, read([zcp(event === "address-on")], project()));
          case "updated-before-its-end":
          case "updated-after-its-end":
            return registry.set(
              servicesRead,
              read(
                [
                  zcp(
                    false,
                    event === "updated-before-its-end"
                      ? "2026-10-02T12:01:44.000Z"
                      : "2026-10-02T12:01:50.000Z",
                  ),
                ],
                project(),
              ),
            );
          case "enabled-read-again":
            return registry.set(activity, { ...activityOf("FINISHED"), live: false });
          case "enabling":
            return registry.set(activity, activityOf("RUNNING"));
          case "enabled":
            return registry.set(activity, activityOf("FINISHED"));
          case "enable-failed":
            return registry.set(activity, activityOf("FAILED"));
          case "not-enabling":
            return registry.set(activity, activityOf(null));
          case "projects-unread":
            return registry.set(projectsRead, unreadProjects);
          case "projects-back":
            return registry.set(projectsRead, roster([shop]));
          case "not-admitted":
          case "admitted":
            return registry.set(access, admitted(event === "admitted"));
          case "tick":
            return undefined;
        }
      },
      row: () => {
        const listing = registry.get(listings)[0]!.listing;
        return listing.state === "known" ? listing.value[0] : undefined;
      },
    };
  };

  type Event =
    | "address-off"
    | "address-on"
    /** Its project's processes: an enable running, finished, failed, or none at all. */
    | "enabling"
    | "enabled"
    /** Its services read directly again, before or after its enable was read as finished. */
    | "updated-before-its-end"
    | "updated-after-its-end"
    /** The same finished enable read again later — another history read, a reconnect. */
    | "enabled-read-again"
    | "enable-failed"
    | "not-enabling"
    | "projects-unread"
    | "projects-back"
    | "not-admitted"
    | "admitted"
    /** Nothing read changes: only the clock runs. */
    | "tick";

  /** The row after a step: its group; none without a row. */
  type Seen =
    | { readonly group: "provisioning" | "ready" | "unavailable" }
    | { readonly presence: "unknown" }
    | "no-row";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(CREATED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const HOUR = 60 * 60_000;

  it.each<{
    readonly case: string;
    readonly steps: ReadonlyArray<readonly [atMs: number, event: Event, seen: Seen]>;
  }>([
    {
      case: "on its way while its enable runs, however long, ready the moment its address lands",
      steps: [
        [110_000, "enabling", { group: "unavailable" }],
        [110_000, "address-off", { group: "provisioning" }],
        [HOUR, "tick", { group: "provisioning" }],
        [HOUR + 1_000, "address-on", { group: "ready" }],
      ],
    },
    {
      case: "on its way once its enable finished, until its record catches up",
      steps: [
        [110_000, "address-off", { group: "unavailable" }],
        [111_000, "enabled", { group: "provisioning" }],
        [115_000, "address-on", { group: "ready" }],
      ],
    },
    {
      // Client review #2: a services read that lands while the REST record still lags says
      // nothing; Zerops' own times do — a record last updated after the enable ended.
      case: "no public address once its record, updated after its enable ended, still lacks it",
      steps: [
        [110_000, "address-off", { group: "unavailable" }],
        [111_000, "enabled", { group: "provisioning" }],
        [112_000, "updated-before-its-end", { group: "provisioning" }],
        [HOUR, "tick", { group: "provisioning" }],
        [HOUR + 1_000, "updated-after-its-end", { group: "unavailable" }],
      ],
    },
    {
      // Client review #4a: the same finished enable read again later never flips a settled row.
      case: "stays without a public address when its finished enable is read again later",
      steps: [
        [110_000, "address-off", { group: "unavailable" }],
        [111_000, "enabled", { group: "provisioning" }],
        [112_000, "updated-after-its-end", { group: "unavailable" }],
        [113_000, "enabled-read-again", { group: "unavailable" }],
      ],
    },
    {
      case: "no public address once its enable failed",
      steps: [
        [110_000, "address-off", { group: "unavailable" }],
        [111_000, "enabling", { group: "provisioning" }],
        [112_000, "enable-failed", { group: "unavailable" }],
      ],
    },
    {
      case: "no public address where nothing turns it on, read as such at once",
      steps: [
        [110_000, "not-enabling", { group: "unavailable" }],
        [110_000, "address-off", { group: "unavailable" }],
        [HOUR, "tick", { group: "unavailable" }],
      ],
    },
    {
      case: "its processes not read yet on a reload: as the platform leaves it",
      steps: [[110_000, "address-off", { group: "unavailable" }]],
    },
    {
      case: "a Mate seen with its address whose access is switched off has none",
      steps: [
        [110_000, "address-on", { group: "ready" }],
        [20 * 60_000, "enabling", { group: "ready" }],
        [20 * 60_000, "address-off", { group: "unavailable" }],
      ],
    },
    {
      case: "on its way through the organization's read blinking",
      steps: [
        [110_000, "enabling", { group: "unavailable" }],
        [110_000, "address-off", { group: "provisioning" }],
        [112_000, "projects-unread", "no-row"],
        [114_000, "projects-back", { group: "provisioning" }],
      ],
    },
    {
      case: "on its way through its project's admission blinking",
      steps: [
        [110_000, "enabling", { group: "unavailable" }],
        [110_000, "address-off", { group: "provisioning" }],
        [112_000, "not-admitted", { presence: "unknown" }],
        [114_000, "admitted", { group: "provisioning" }],
      ],
    },
  ])("$case", ({ steps }) => {
    const account = listingOver();
    let elapsed = 0;
    for (const [atMs, event, seen] of steps) {
      vi.advanceTimersByTime(atMs - elapsed);
      elapsed = atMs;
      account.apply(event);
      const row = account.row();
      if (seen === "no-row") {
        expect(row).toBeUndefined();
      } else if ("presence" in seen) {
        expect(row?.presence).toBe(seen.presence);
      } else {
        expect({ atMs, group: row?.group }).toEqual({ atMs, group: seen.group });
      }
    }
  });
});

describe("mateListingsAtom: one listing per organization the grant names", () => {
  const other = { ...organization, organizationId: ZeropsOrganizationId.make("org-2") };
  const over = (orgId: string | null) => {
    const registry = AtomRegistry.make();
    registry.set(accountReadsAtom, {
      data: {
        project: () => Atom.make<OrganizationProjects>({ ...ROSTER, projects: [] }),
      } as unknown as AccountReads["data"],
      orgId,
      demandDetail: () => () => {},
    });
    const data = {
      scope: { account: organization.account },
      access: {
        view: Atom.make({
          machine: {
            phase: {
              phase: "granted",
              evidence: {
                account: { organizations: [{ organization }, { organization: other }] },
                projects: new Map(),
                unverified: new Map(),
                closedProjects: new Map(),
              },
            },
          },
        }),
      },
      reads: { access: Atom.make({ status: "unverified" }), servicesOf: () => Atom.make(null) },
    } as unknown as ManagedZeropsDataRuntime;
    return registry.get(mateListingsAtom(data));
  };

  it("lists the organization shown as read, every other as unread until it is", () => {
    expect(
      over(organization.organizationId).map(({ organizationId, listing }) => [
        organizationId,
        listing.state,
      ]),
    ).toEqual([
      [organization.organizationId, "known"],
      ["org-2", "unread"],
    ]);
  });

  it("lists every organization unread while none is shown", () => {
    expect(over(null).map(({ listing }) => listing.state)).toEqual(["unread", "unread"]);
  });
});
