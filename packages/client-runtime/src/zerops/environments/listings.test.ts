import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  identity,
  organization,
  process,
  project,
  scope,
  service,
  stamp,
} from "../data/__fixtures__/index.ts";
import { selectProjectsOf } from "../data/projection.ts";
import { interestKeyOf } from "../data/runtime.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { makeInitialZeropsDataState } from "../data/state.ts";
import type { CollectionRead, InterestState, ProjectRecord, ServiceRecord } from "../data/types.ts";
import { ReceiptOrdinal } from "../data/types.ts";
import { candidateListingsAtom } from "./listings.ts";

const progress = {
  requiredRegistrations: 1,
  completedRegistrations: 0,
  requiredReads: 1,
  completedReads: 0,
  crossedReceiptOrdinal: ReceiptOrdinal.make(0),
};

/** The organization's inventory interest: the one its projects read is fed by. */
const FEEDER = interestKeyOf({ kind: "organization-inventory", organization });
/** An interest that reads a project's topology, not the organization's projects. */
const OTHER = interestKeyOf({
  kind: "project-topology",
  project: project(),
});

const establishing = (key: InterestState["identity"]["key"]): InterestState => ({
  status: "establishing",
  identity: { ...identity(), key },
  startedAtMs: 0,
  deadlineMs: 60_000,
  progress,
});

const failed = (from: InterestState): InterestState => ({
  status: "failed",
  identity: from.identity,
  reason: "gateway",
  retryable: true,
  attempts: 1,
  retryAtMs: 90_000,
});

/** The organization's projects, not read yet, as these interests observe them. */
const projectsRead = (required: ReadonlyArray<InterestState>): CollectionRead<ProjectRecord> => {
  const read = selectProjectsOf(makeInitialZeropsDataState(scope()), organization);
  return { ...read, observation: { ...read.observation, required } };
};

/**
 * The account's listings over a runtime whose grant names the organization and whose projects
 * read is `first` until `read` replaces it.
 */
const listingsOver = (first: CollectionRead<ProjectRecord>) => {
  const registry = AtomRegistry.make();
  const projects = Atom.make(first);
  const data = {
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
      access: Atom.make({ status: "unverified" }),
      projectsOf: () => projects,
      servicesOf: () => {
        throw new Error("no project is listed, so no services are read");
      },
    },
  } as unknown as ManagedZeropsDataRuntime;
  const listings = candidateListingsAtom(data);
  registry.mount(listings);
  return {
    read: (next: CollectionRead<ProjectRecord>) => registry.set(projects, next),
    listings: () => registry.get(listings),
    listing: () => registry.get(listings)[0]!.listing,
  };
};

describe("candidateListingsAtom: a read with no value yet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a new listing when the interest feeding it fails, though its query did not change", () => {
    const feeder = establishing(FEEDER);
    const account = listingsOver(projectsRead([feeder]));
    const before = account.listings();
    expect(account.listing().state).toBe("reading");

    account.read(projectsRead([failed(feeder)]));

    expect(account.listings()).not.toBe(before);
    expect(account.listing().state).toBe("failed");
  });

  it("keeps its listing when only an interest that does not feed it fails", () => {
    const other = establishing(OTHER);
    const account = listingsOver(projectsRead([establishing(FEEDER), other]));
    const before = account.listings();

    account.read(projectsRead([establishing(FEEDER), failed(other)]));

    expect(account.listings()).toBe(before);
  });

  it("keeps the moment it began waiting when a new read still waits the same way", () => {
    const account = listingsOver(projectsRead([establishing(FEEDER)]));
    const before = account.listings();
    expect(account.listing()).toEqual({ state: "reading", sinceMs: 0, attempt: 1 });

    vi.setSystemTime(5_000);
    account.read(projectsRead([establishing(FEEDER)]));

    expect(account.listings()).toBe(before);
    expect(account.listing()).toEqual({ state: "reading", sinceMs: 0, attempt: 1 });
  });
});

describe("candidateListingsAtom: a container ACTIVE before its address landed", () => {
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

  const projectRecord: ProjectRecord = {
    ref: project(),
    identity: observed({ name: "shop", createdAt: null }),
    lifecycle: observed({ status: "ACTIVE" }),
    presentation: observed({ tags: [], description: null }),
    placement: observed({
      publicZone: "fte2334ab.prg1-zerops.zone",
      zeropsSubdomainHost: "24cb",
      mode: "LIGHT" as const,
    }),
  } as unknown as ProjectRecord;

  /** The project's zcp service, ACTIVE, its address enabled or not yet. */
  const zcp = (subdomainAccess: boolean): ServiceRecord =>
    ({
      ref: service("service-1", project()),
      identity: observed({
        hostname: "zcp",
        type: { versionName: "zcp@1", displayName: "Zerops Mate", category: "runtime" },
      }),
      lifecycle: observed({ status: "ACTIVE", createdAt: CREATED_AT, updatedAt: null }),
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

  /** The organization's projects not read (again) yet: the listing holds no rows. */
  const unreadProjects = {
    value: [],
    query: { status: "pending", descriptor: { organization } },
    observation: { required: [], optional: [] },
  } as unknown;

  const admitted = (yes: boolean) => ({
    status: "verified",
    projects: yes ? [{ project: project(), role: "OWNER" }] : [],
  });

  /** The project's `stack.enableSubdomainAccess` for its zcp service, in this status. */
  const enable = (status: string) => ({
    knowledge: "observed",
    record: {
      ref: process("enable-1", project()),
      identity: observed({
        actionName: "stack.enableSubdomainAccess",
        serviceIds: ["service-1"],
        createdAt: "2026-10-02T12:01:40.000Z",
      }),
      lifecycle: observed({ status, startedAt: null, finishedAt: null }),
      pipeline: unresolved,
    },
  });

  /** The project's processes as read: running ones and the newest history, or not read yet. */
  const activityOf = (enableStatus: string | null, read = true) => ({
    running: {
      value: enableStatus === "RUNNING" ? [enable(enableStatus)] : [],
      query: { status: read ? "observed" : "pending" },
    },
    retainedHistory:
      enableStatus !== null && enableStatus !== "RUNNING" ? [enable(enableStatus)] : [],
    processHistory: read ? "read" : "reading",
    observation: { required: [], optional: [] },
  });

  const listingOver = () => {
    const registry = AtomRegistry.make();
    const servicesRead = Atom.make<unknown>(read([], project()));
    const projectsRead = Atom.make<unknown>(read([projectRecord]));
    const access = Atom.make<unknown>(admitted(true));
    const activity = Atom.make<unknown>(activityOf(null, false));
    const data = {
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
        projectsOf: () => projectsRead,
        servicesOf: () => servicesRead,
        activity: () => activity,
      },
    } as unknown as ManagedZeropsDataRuntime;
    const listings = candidateListingsAtom(data);
    registry.mount(listings);
    return {
      apply: (event: Event) => {
        switch (event) {
          case "address-off":
          case "address-on":
            return registry.set(servicesRead, read([zcp(event === "address-on")], project()));
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
            return registry.set(projectsRead, read([projectRecord]));
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
