/**
 * The account's Mate listing (DESIGN §2.B B4): the organization the account observes, its projects
 * as the account's store lists them (`organizationProjects`), each joined with its services as the
 * organization's services listing holds them (`projectServices`), through `selectCandidates`' rules. The account's environments and every
 * surface read the same listing, one per data runtime.
 *
 * - The projects are the store's: a project created anywhere is listed as soon as the roster says
 *   it, an outage keeps what was read and says it is catching up, and a project leaves only on its
 *   owner's word (`data/projections/projects.ts`).
 * - A recompute costs what changed: a project's rows are derived again only when its value or its
 *   services are a new object, and rows that come out the same keep their objects. A recompute
 *   that changed no listing returns the listings it returned before, so nothing reading them hears
 *   of it.
 * - A container ACTIVE before its address landed is on its way to it while the platform turns its
 *   address on (`addressAwaited`): its project's processes are read for as long as it lacks one
 *   (`account/environments.ts` holds that read), and their word ends the wait — never a clock.
 *   What this listing saw of each address is kept for as long as it lives (`AddressMemory`),
 *   through every read and every blink; the one clock that derives the listing again is an
 *   arrival pose's end (`arriving`), a face's, never a verdict.
 */
import { Atom } from "effect/unstable/reactivity";

import type { ProjectValue } from "../../data/families/project.ts";
import type { ProjectProcesses } from "../../data/projections/processes.ts";
import type { OrganizationProjects } from "../../data/projections/projects.ts";
import type { ProjectServices } from "../../data/projections/services.ts";
import { projectProcessesAtom, projectServicesAtom, shownProjectsAtom } from "../../data/reads.ts";
import type { ZeropsService } from "../api.ts";

import {
  evidenceProjectRefs,
  inventoryProjectRefs,
  pendingDenials,
} from "../data/access/grantProjects.ts";
import type { Evidence, GrantMachine } from "../data/access/grant.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import {
  projectKeyOf,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type OrganizationRef,
  type ProjectRef,
} from "../data/types.ts";
import type { Freshness, Known } from "../knowledge/known.ts";
import {
  addressFactsOf,
  arrivalEnd,
  candidateListing,
  NO_ADDRESS_MEMORY,
  projectCandidates,
  rememberAddresses,
  serviceUpdatedAtIn,
  subdomainEnableIn,
  type AddressMemory,
  type CandidateRow,
} from "../projections/candidates.ts";
import { systemExchangeClock } from "./exchangeDriver.ts";

/** One organization's Mate candidates. */
export interface OrganizationListing {
  readonly organizationId: string;
  readonly listing: Known<ReadonlyArray<CandidateRow>>;
  /**
   * IN TRANSIT (SVC → PROJ's absence checks): no project's services are read directly any more —
   * the organization's services listing observes them all — so none is named here.
   */
  readonly directReads: ReadonlyMap<string, number>;
}

const heldEvidence = (machine: GrantMachine): Evidence | null =>
  machine.phase.phase === "granted"
    ? machine.phase.evidence
    : machine.phase.phase === "lapsed"
      ? machine.phase.last
      : null;

/**
 * The roster as knowledge: unread until asked for, reading until its first baseline, failed where
 * it was refused before; once read, known with what it holds — partial while anything of it is
 * still open, and stale while its source is down. `since` is when this reader first saw it wait
 * or fall behind the way it does now.
 */
export function knownRoster(
  roster: OrganizationProjects,
  since: number,
): Known<ReadonlyArray<ProjectValue>> {
  const failure =
    roster.unavailableReason === undefined
      ? null
      : roster.unavailableReason === "refused"
        ? ({ kind: "refused", code: "refused", words: "Zerops refused the project list." } as const)
        : ({ kind: "unauthorized" } as const);
  if (roster.read === "unread") return { state: "unread", waitingFor: null };
  if (roster.read === "reading")
    return failure === null
      ? { state: "reading", sinceMs: since, attempt: 1 }
      : { state: "failed", failure, atMs: since, attempt: 1, retryAtMs: null };
  const freshness: Freshness =
    failure !== null
      ? {
          kind: "stale",
          reason: { kind: "revalidation-failed", failure, attempt: 1, retryAtMs: null },
          sinceMs: since,
        }
      : roster.live
        ? { kind: "live" }
        : roster.reconnecting
          ? {
              kind: "stale",
              reason: { kind: "source-recovering", retryAtMs: null },
              sinceMs: since,
            }
          : { kind: "revalidating", sinceMs: since };
  return {
    state: "known",
    value: roster.projects,
    asOf: { ordinal: 0, atMs: since },
    coverage: roster.complete ? "complete" : "partial",
    freshness,
  };
}

/** Which way the roster waits or falls behind: a new way starts a new `since`. */
const wayOf = (roster: OrganizationProjects) =>
  `${roster.read}/${roster.live}/${roster.reconnecting}/${roster.unavailableReason ?? ""}`;

/** One project as last derived: what it was derived from, and what came out. */
interface ProjectEntry {
  readonly project: ProjectValue;
  /** Whether the grant admits the project: only then are its services its Mates'. */
  readonly admitted: boolean;
  /** Its services as last read; null for a project whose status reads no services. */
  readonly services: ProjectServices | null;
  /** Its processes as read for a container lacking its address; null where none was asked. */
  readonly activity: ProjectProcesses | null;
  readonly rows: ReadonlyArray<CandidateRow>;
  /** When the first of its rows' arrival poses ends, wall ms; null when none is shown. */
  readonly arrivalEnds: number | null;
}

/** The organization as last derived. */
interface OrganizationEntry {
  readonly roster: OrganizationProjects;
  readonly way: string;
  readonly since: number;
  readonly entries: ReadonlyMap<string, ProjectEntry>;
  readonly listed: OrganizationListing;
}

const NO_DIRECT_READS: ReadonlyMap<string, number> = new Map();
const NO_LISTINGS: ReadonlyArray<OrganizationListing> = [];

/** A project the grant does not admit: its services say nothing of a Mate of this person's. */
const UNREAD_SERVICES: Known<ReadonlyArray<ZeropsService>> = { state: "unread", waitingFor: null };

/** A project's services as knowledge: as current as the organization's services listing. */
export function knownServices(
  read: ProjectServices,
  since: number,
): Known<ReadonlyArray<ZeropsService>> {
  if (read.services === undefined)
    return read.unavailableReason === undefined
      ? { state: "reading", sinceMs: since, attempt: 1 }
      : {
          state: "failed",
          failure:
            read.unavailableReason === "refused"
              ? { kind: "refused", code: "refused", words: "Zerops refused the services list." }
              : { kind: "unauthorized" },
          atMs: since,
          attempt: 1,
          retryAtMs: null,
        };
  return {
    state: "known",
    value: read.services,
    asOf: { ordinal: 0, atMs: since },
    coverage: "complete",
    freshness: read.live
      ? { kind: "live" }
      : read.reconnecting
        ? { kind: "stale", reason: { kind: "source-recovering", retryAtMs: null }, sinceMs: since }
        : { kind: "revalidating", sinceMs: since },
  };
}

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** The same knowledge apart from the value: state, stamp, coverage and freshness. */
const sameShell = <T>(left: Known<T>, right: Known<T>): boolean =>
  sameJson({ ...left, value: null }, { ...right, value: null });

const sameItems = <T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const listings = new WeakMap<
  ManagedZeropsDataRuntime,
  Atom.Atom<ReadonlyArray<OrganizationListing>>
>();

/**
 * The account's listings over this data runtime: one per organization the grant names — the one
 * the account observes as its store reads it, every other unread. The same atom for every reader.
 */
export function mateListingsAtom(
  data: ManagedZeropsDataRuntime,
): Atom.Atom<ReadonlyArray<OrganizationListing>> {
  const held = listings.get(data);
  if (held !== undefined) return held;
  let organization: OrganizationEntry | null = null;
  // Outlives every entry: a read that blinks drops its project's entry, never what it knew of an
  // address (`AddressMemory`).
  let addresses: AddressMemory = NO_ADDRESS_MEMORY;
  let published: ReadonlyArray<OrganizationListing> = NO_LISTINGS;
  const unreadListings = new Map<string, OrganizationListing>();

  const atom = Atom.make((get): ReadonlyArray<OrganizationListing> => {
    const nowMs = systemExchangeClock.now().wall;
    const { orgId, ...roster } = get(shownProjectsAtom);
    const evidence = heldEvidence(get(data.access.view).machine);
    // Every organization the grant names has its listing: the one observed as read, every other
    // unread until it is — never absent, which would say nothing of what it holds.
    const granted = (evidence?.account.organizations ?? []).map(
      ({ organization: granted }) => granted.organizationId as string,
    );
    const unreadOf = (organizationId: string): OrganizationListing =>
      unreadListings.get(organizationId) ??
      unreadListings
        .set(organizationId, {
          organizationId,
          listing: { state: "unread", waitingFor: null },
          directReads: NO_DIRECT_READS,
        })
        .get(organizationId)!;
    const publish = (shown: OrganizationListing | null) => {
      const next = [
        ...(shown === null ? [] : [shown]),
        ...granted.filter((id) => id !== shown?.organizationId).map(unreadOf),
      ];
      if (!sameItems(published, next)) published = next;
      return published;
    };
    if (orgId === null) {
      organization = null;
      return publish(null);
    }
    const organizationRef: OrganizationRef = {
      kind: "organization",
      account: data.scope.account,
      organizationId: ZeropsOrganizationId.make(orgId),
    };
    const refOf = (projectId: string): ProjectRef => ({
      kind: "project",
      organization: organizationRef,
      projectId: ZeropsProjectId.make(projectId),
    });
    // The projects the grant admits (what the inventory demands): only an admitted project's
    // services are its Mates'. Another's Mate gets no address, no probe and no connection, as when
    // its services were never read at all.
    const withheld = pendingDenials(evidence);
    const admitted = new Set(
      inventoryProjectRefs(evidenceProjectRefs(evidence), get(data.reads.access))
        .map((ref) => projectKeyOf(ref))
        .filter((key) => !withheld.has(key)),
    );

    const derive = (
      project: ProjectValue,
      before: ProjectEntry | undefined,
      known: ProjectServices | null,
      isAdmitted: boolean,
    ): ProjectEntry => {
      let services: ProjectServices | null = null;
      let activity: ProjectProcesses | null = null;
      const rows = projectCandidates(
        project,
        () => {
          if (!isAdmitted) return UNREAD_SERVICES;
          const read = known ?? get(projectServicesAtom(project.id));
          services = read;
          return knownServices(read, nowMs);
        },
        addressFactsOf(addresses, nowMs, (_projectId, serviceId) => {
          activity = get(projectProcessesAtom(project.id));
          // Its record, last updated after its enable ended on Zerops' clock, says it caught up.
          return subdomainEnableIn(
            activity,
            serviceId,
            serviceUpdatedAtIn(services?.services, serviceId),
          );
        }),
      );
      addresses = rememberAddresses(addresses, rows);
      const same = before !== undefined && sameJson(before.rows, rows);
      return {
        project,
        admitted: isAdmitted,
        services,
        activity,
        rows: same ? before.rows : rows,
        arrivalEnds: arrivalEnd(rows),
      };
    };

    /** One project, derived again only from a new value, new services or admission. */
    const projectEntry = (project: ProjectValue, before: ProjectEntry | undefined) => {
      const isAdmitted = admitted.has(projectKeyOf(refOf(project.id)));
      const arrivalOver = before?.arrivalEnds != null && before.arrivalEnds <= nowMs;
      if (before?.project === project && before.admitted === isAdmitted && !arrivalOver) {
        if (before.services === null) return before;
        const read = get(projectServicesAtom(project.id));
        const activityMoved =
          before.activity !== null && get(projectProcessesAtom(project.id)) !== before.activity;
        if (read === before.services && !activityMoved) return before;
        return derive(project, before, read, isAdmitted);
      }
      return derive(project, before, null, isAdmitted);
    };

    const before = organization?.listed.organizationId === orgId ? organization : null;
    const way = wayOf(roster);
    const since = before !== null && before.way === way ? before.since : nowMs;
    const projects = knownRoster(roster, since);
    let next: OrganizationEntry;
    if (projects.state !== "known") {
      const listed =
        before !== null && sameJson(before.listed.listing, projects)
          ? before.listed
          : { organizationId: orgId, listing: projects, directReads: NO_DIRECT_READS };
      next = { roster, way, since, entries: new Map(), listed };
    } else {
      const entries = new Map<string, ProjectEntry>();
      for (const project of projects.value)
        entries.set(project.id, projectEntry(project, before?.entries.get(project.id)));
      const listing = candidateListing(
        projects,
        [...entries.values()].map((entry) => entry.rows),
      );
      const previous = before?.listed;
      const unchanged =
        previous !== undefined &&
        previous.listing.state === "known" &&
        sameShell(previous.listing, listing) &&
        sameItems(previous.listing.value, listing.value);
      next = {
        roster,
        way,
        since,
        entries,
        listed: unchanged
          ? previous
          : { organizationId: orgId, listing, directReads: NO_DIRECT_READS },
      };
    }
    organization = next;
    // An arrival pose ends on a clock, a face's, not a verdict's: the listing is derived again
    // then, so a Mate that never answered stops being shown on its way.
    const arrivalEnds = [...next.entries.values()].flatMap((entry) =>
      entry.arrivalEnds === null ? [] : [entry.arrivalEnds],
    );
    if (arrivalEnds.length > 0) {
      get.addFinalizer(
        systemExchangeClock.setTimer(Math.max(0, Math.min(...arrivalEnds) - nowMs), () =>
          get.refreshSelf(),
        ),
      );
    }
    return publish(next.listed);
  });
  listings.set(data, atom);
  return atom;
}
