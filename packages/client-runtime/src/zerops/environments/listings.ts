/**
 * The account's Mate candidate listings (DESIGN §2.B B4): one per organization the grant names,
 * read off the data runtime's projects and services through `selectCandidates`' rules. The
 * account's environments and every surface read the same listing, one per data runtime.
 *
 * - A recompute costs what changed: a project's rows are derived again only when its record or
 *   its services read is a new object, and rows that come out the same keep their objects.
 * - An organization whose rows, direct reads and knowledge are unchanged keeps its listing, and a
 *   recompute that changed no listing returns the listings it returned before, so nothing reading
 *   them hears of it.
 * - A read with no value yet is dated by the moment this listing first saw it wait that way
 *   (`known.ts`): a new read that still waits the same way keeps the date, so no clock derives
 *   the listing again.
 */
import { Atom } from "effect/unstable/reactivity";

import type { Evidence, GrantMachine } from "../data/access/grant.ts";
import { knownProjectsOf, knownServicesOf, servicesSourceOf } from "../data/known.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type {
  CollectionRead,
  OrganizationRef,
  ProjectRecord,
  ServiceRecord,
} from "../data/types.ts";
import type { Known } from "../knowledge/known.ts";
import {
  candidateListing,
  projectCandidates,
  type CandidateRow,
} from "../projections/candidates.ts";
import { systemExchangeClock } from "./exchangeDriver.ts";

/** One organization's Mate candidates. */
export interface OrganizationListing {
  readonly organizationId: string;
  readonly listing: Known<ReadonlyArray<CandidateRow>>;
  /**
   * The receipt ordinal of each of its projects' latest complete direct read of their services:
   * the one the interest that observes them crossed when it last established.
   */
  readonly directReads: ReadonlyMap<string, number>;
}

const heldEvidence = (machine: GrantMachine): Evidence | null =>
  machine.phase.phase === "granted"
    ? machine.phase.evidence
    : machine.phase.phase === "lapsed"
      ? machine.phase.last
      : null;

/** One project as last derived: what it was derived from, and what came out. */
interface ProjectEntry {
  readonly record: ProjectRecord;
  /** Its services read; null for a project whose status reads no services. */
  readonly services: CollectionRead<ServiceRecord> | null;
  /** Null while its record does not name it yet. */
  readonly rows: ReadonlyArray<CandidateRow> | null;
  readonly directRead: number | null;
}

/** One organization as last derived. */
interface OrganizationEntry {
  readonly projectsRead: CollectionRead<ProjectRecord>;
  readonly projects: Known<ReadonlyArray<ProjectRecord>>;
  readonly entries: ReadonlyMap<string, ProjectEntry>;
  readonly listed: OrganizationListing;
}

const NO_DIRECT_READS: ReadonlyMap<string, number> = new Map();

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** A read with no value yet, apart from when it began to wait. */
const undated = <T>(known: Known<T>): string =>
  JSON.stringify(known.state === "known" ? known : { ...known, sinceMs: null, atMs: null });

/** The same knowledge apart from the value: state, stamp, coverage and freshness. */
const sameShell = <T>(left: Known<T>, right: Known<T>): boolean =>
  sameJson({ ...left, value: null }, { ...right, value: null });

const sameItems = <T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const sameReads = (left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>) =>
  left.size === right.size && [...left].every(([key, read]) => right.get(key) === read);

/** The receipt ordinal of a complete services read its observing interest crossed. */
const directReadOf = (
  read: CollectionRead<ServiceRecord>,
  services: Known<ReadonlyArray<ServiceRecord>>,
): number | null => {
  const source = servicesSourceOf(read);
  return source?.status === "observing" &&
    services.state === "known" &&
    services.coverage === "complete"
    ? source.sinceReceiptOrdinal
    : null;
};

const listings = new WeakMap<
  ManagedZeropsDataRuntime,
  Atom.Atom<ReadonlyArray<OrganizationListing>>
>();

/** The account's listings over this data runtime; the same atom for every reader. */
export function candidateListingsAtom(
  data: ManagedZeropsDataRuntime,
): Atom.Atom<ReadonlyArray<OrganizationListing>> {
  const held = listings.get(data);
  if (held !== undefined) return held;
  let organizations = new Map<string, OrganizationEntry>();
  let published: ReadonlyArray<OrganizationListing> = [];

  const atom = Atom.make((get): ReadonlyArray<OrganizationListing> => {
    const nowMs = systemExchangeClock.now().wall;
    const evidence = heldEvidence(get(data.access.view).machine);

    /** One project, derived again only from a new record or a new services read. */
    const projectEntry = (
      record: ProjectRecord,
      before: ProjectEntry | undefined,
    ): ProjectEntry => {
      if (before?.record === record) {
        if (before.services === null) return before;
        const read = get(data.reads.servicesOf(record.ref));
        if (read === before.services) return before;
        return derive(record, before, read);
      }
      return derive(record, before, null);
    };

    const derive = (
      record: ProjectRecord,
      before: ProjectEntry | undefined,
      known: CollectionRead<ServiceRecord> | null,
    ): ProjectEntry => {
      let services: CollectionRead<ServiceRecord> | null = null;
      let directRead: number | null = null;
      const rows = projectCandidates(record, (ref) => {
        const read = known ?? get(data.reads.servicesOf(ref));
        const value = knownServicesOf(read, nowMs);
        services = read;
        directRead = directReadOf(read, value);
        return value;
      });
      const same = before?.rows != null && rows !== null && sameJson(before.rows, rows);
      return { record, services, rows: same ? before.rows : rows, directRead };
    };

    const organizationEntry = (organization: OrganizationRef): OrganizationEntry => {
      const organizationId = organization.organizationId;
      const before = organizations.get(organizationId);
      const projectsRead = get(data.reads.projectsOf(organization));
      const read =
        before?.projectsRead === projectsRead
          ? before.projects
          : knownProjectsOf(projectsRead, nowMs);
      const projects =
        before !== undefined && read.state !== "known" && undated(before.projects) === undated(read)
          ? before.projects
          : read;
      if (projects.state !== "known") {
        const listed =
          before !== undefined && sameJson(before.listed.listing, projects)
            ? before.listed
            : { organizationId, listing: projects, directReads: NO_DIRECT_READS };
        return { projectsRead, projects, entries: new Map(), listed };
      }
      const entries = new Map<string, ProjectEntry>();
      const directReads = new Map<string, number>();
      for (const record of projects.value) {
        const entry = projectEntry(record, before?.entries.get(record.ref.projectId));
        entries.set(record.ref.projectId, entry);
        if (entry.directRead !== null) directReads.set(record.ref.projectId, entry.directRead);
      }
      const listing = candidateListing(
        projects,
        [...entries.values()].map((entry) => entry.rows),
      );
      const previous = before?.listed;
      const unchanged =
        previous !== undefined &&
        previous.listing.state === "known" &&
        sameShell(previous.listing, listing) &&
        sameItems(previous.listing.value, listing.value) &&
        sameReads(previous.directReads, directReads);
      return {
        projectsRead,
        projects,
        entries,
        listed: unchanged ? previous : { organizationId, listing, directReads },
      };
    };

    const next = new Map(
      (evidence?.account.organizations ?? []).map(({ organization }) => [
        organization.organizationId,
        organizationEntry(organization),
      ]),
    );
    organizations = next;
    const listed = [...next.values()].map((entry) => entry.listed);
    if (!sameItems(published, listed)) published = listed;
    return published;
  });
  listings.set(data, atom);
  return atom;
}
