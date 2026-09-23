import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { identity, organization, project, scope } from "../data/__fixtures__/index.ts";
import { selectProjectsOf } from "../data/projection.ts";
import { interestKeyOf } from "../data/runtime.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { makeInitialZeropsDataState } from "../data/state.ts";
import type { CollectionRead, InterestState, ProjectRecord } from "../data/types.ts";
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
          phase: { phase: "granted", evidence: { account: { organizations: [{ organization }] } } },
        },
      }),
    },
    reads: {
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
