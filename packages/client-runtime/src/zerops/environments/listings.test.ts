import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ADDRESS_GRACE_MS } from "../candidates.ts";
import {
  identity,
  organization,
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
  includeCurrentMetrics: false,
});

const establishing = (key: InterestState["identity"]["key"]): InterestState => ({
  status: "establishing",
  identity: { ...identity(), key },
  startedAtMs: 0,
  deadlineMs: 60_000,
  progress,
});

const recovering = (key: InterestState["identity"]["key"]): InterestState => ({
  status: "recovering",
  identity: { ...identity(), key },
  reason: "disconnect",
  attempt: 2,
  nextRetryAtMs: 90_000,
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
    const account = listingsOver(projectsRead([recovering(FEEDER)]));
    const before = account.listings();
    expect(account.listing()).toEqual({ state: "reading", sinceMs: 1_000, attempt: 2 });

    vi.setSystemTime(5_000);
    account.read(projectsRead([recovering(FEEDER)]));

    expect(account.listings()).toBe(before);
    expect(account.listing()).toEqual({ state: "reading", sinceMs: 1_000, attempt: 2 });
  });
});

describe("candidateListingsAtom: a young container ACTIVE before its address landed", () => {
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
      lifecycle: observed({
        status: "ACTIVE",
        createdAt: CREATED_AT,
        updatedAt: null,
      }),
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

  const listingOver = (services: ServiceRecord) => {
    const registry = AtomRegistry.make();
    const servicesRead = Atom.make(read([services], project()));
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
        access: Atom.make({
          status: "verified",
          projects: [{ project: project(), role: "OWNER" }],
        }),
        projectsOf: () => Atom.make(read([projectRecord])),
        servicesOf: () => servicesRead,
      },
    } as unknown as ManagedZeropsDataRuntime;
    const listings = candidateListingsAtom(data);
    registry.mount(listings);
    return {
      push: (next: ServiceRecord) => registry.set(servicesRead, read([next], project())),
      row: () => {
        const listing = registry.get(listings)[0]!.listing;
        return listing.state === "known" ? listing.value[0] : undefined;
      },
    };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(CREATED + 110_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is on its way, its wait dated where this listing first saw it, through a push", () => {
    const account = listingOver(zcp(false));
    expect(account.row()).toMatchObject({
      group: "provisioning",
      addressAwaited: { since: CREATED + 110_000 },
    });

    vi.setSystemTime(CREATED + 113_000);
    account.push(zcp(false));

    expect(account.row()).toMatchObject({
      group: "provisioning",
      addressAwaited: { since: CREATED + 110_000 },
    });
  });

  it("is ready the moment its address lands", () => {
    const account = listingOver(zcp(false));
    vi.setSystemTime(CREATED + 115_300);
    account.push(zcp(true));
    expect(account.row()).toMatchObject({ group: "ready" });
    expect(account.row()?.addressAwaited).toBeUndefined();
  });

  it("reads as the platform leaves it once its wait ends, with no read changing", () => {
    const account = listingOver(zcp(false));
    expect(account.row()?.group).toBe("provisioning");

    vi.advanceTimersByTime(ADDRESS_GRACE_MS);

    expect(account.row()).toMatchObject({ group: "unavailable", reason: expect.any(String) });
    expect(account.row()?.addressAwaited).toBeUndefined();
  });
});
