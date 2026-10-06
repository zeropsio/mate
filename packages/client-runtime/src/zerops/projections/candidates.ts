/**
 * The Mate candidates of an organization, over the inventory's knowledge (DESIGN §2.B B4, §4.4
 * region P).
 *
 * Pure: it takes the inventory's `Known` reads and derives one row per zcp container, with no
 * socket phase or health mixed in. A row whose project's service listing is not known, or is
 * partial with no zcp container read, has presence `unknown`: the inventory has not said whether
 * a container is there. Such a row sits in the `unavailable` bucket only because that bucket
 * offers no verb; it carries no reason and no missing container, so nothing negative can be read
 * off it, and a surface reads its presence before its group. Which rows are connected is the
 * caller's join with its environments.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsProject, ZeropsService } from "../api.ts";
import {
  addressSeenAfter,
  deriveZeropsCandidates,
  isZcpService,
  newestSubdomainProcess,
  subdomainEnableOf,
  type AddressFacts,
  type AddressSeen,
  type SubdomainEnable,
  type SubdomainProcess,
  type ZeropsCandidate,
} from "../candidates.ts";
import { projectNameInApp, readZeropsMembership } from "../groups.ts";
import type { ProjectProcesses } from "../../data/projections/processes.ts";
import { serviceRecordToZeropsService } from "../data/dto.ts";
import type { CollectionRead, ServiceRecord } from "../data/types.ts";
import type { Known, Shown } from "../knowledge/known.ts";
import {
  knownPresentation,
  type KnownAffordance,
  type KnownMessage,
  type KnownPresentation,
  type KnownSurface,
} from "../knowledge/presentation.ts";

/** Whether the inventory has read what decides this row's container. */
export type CandidatePresence = "known" | "unknown";

export type CandidateRow = ZeropsCandidate & { readonly presence: CandidatePresence };

const NO_CONNECTIONS: ReadonlyMap<string, EnvironmentId> = new Map();

/**
 * The project's services that decide its rows; `null` while that is not known. A known, complete
 * listing decides them all, including "no container". A partial one decides only the containers
 * it has read: a zcp service it holds is there, and one it lacks may still be unread.
 */
function readServices(
  services: Known<ReadonlyArray<ServiceRecord>>,
): ReadonlyArray<ZeropsService> | null {
  if (services.state !== "known") return null;
  const decoded: ZeropsService[] = [];
  let complete = services.coverage === "complete";
  for (const record of services.value) {
    const service = serviceRecordToZeropsService(record);
    if (service === null) complete = false;
    else decoded.push(service);
  }
  return complete || decoded.some(isZcpService) ? decoded : null;
}

const known = (candidates: ReadonlyArray<ZeropsCandidate>): ReadonlyArray<CandidateRow> =>
  candidates.map((candidate) => ({ ...candidate, presence: "known" }));

/**
 * One project's candidates. Only an active project's services are read (`servicesOf`): any other
 * status decides its one row alone. A reader that holds what it knows of its containers' addresses
 * judges them by it (`AddressFacts`).
 */
export function projectCandidates(
  project: ZeropsProject,
  servicesOf: () => Known<ReadonlyArray<ServiceRecord>>,
  facts?: AddressFacts,
): ReadonlyArray<CandidateRow> {
  if (project.status !== "ACTIVE")
    return known(deriveZeropsCandidates(project, [], NO_CONNECTIONS));
  const services = readServices(servicesOf());
  if (services === null) {
    return [{ key: project.id, project, group: "unavailable", presence: "unknown" }];
  }
  return known(deriveZeropsCandidates(project, services, NO_CONNECTIONS, undefined, facts));
}

/**
 * Every candidate the organization's projects hold. The listing is as known as the projects are:
 * unread, reading or failed projects give no rows at all, never an empty list.
 */
export function selectCandidates(
  projects: Known<ReadonlyArray<ZeropsProject>>,
  servicesOf: (project: ZeropsProject) => Known<ReadonlyArray<ServiceRecord>>,
  facts?: AddressFacts,
): Known<ReadonlyArray<CandidateRow>> {
  if (projects.state !== "known") return projects;
  return candidateListing(
    projects,
    projects.value.map((project) => projectCandidates(project, () => servicesOf(project), facts)),
  );
}

/** A project's processes as the account's store holds them. */
const subdomainProcessesOf = (activity: ProjectProcesses): ReadonlyArray<SubdomainProcess> =>
  activity.processes ?? [];

/**
 * Where the platform stands on turning a service's address on, from its project's activity
 * (`subdomainEnableOf`): known once its running processes and its newest history are both read; a
 * live enable among what is read says `on` before that. `serviceUpdatedAt` is when the service's
 * record was last updated, on Zerops' clock. `undefined` while it is not known.
 */
export function subdomainEnableIn(
  activity: ProjectProcesses | null,
  serviceId: string,
  serviceUpdatedAt: string | null = null,
): SubdomainEnable | undefined {
  if (activity === null) return undefined;
  const said = subdomainEnableOf(subdomainProcessesOf(activity), serviceId, serviceUpdatedAt);
  const read = activity.processes !== undefined && activity.history === "read";
  return read || said === "on" ? said : undefined;
}

/**
 * When a service's enable ended on Zerops' clock, where its newest enable/disable is a finished
 * enable: a direct read of its services after it brings a record that may have caught up. Null
 * otherwise.
 */
export function finishedEnableAt(
  activity: ProjectProcesses | null,
  serviceId: string,
): string | null {
  if (activity === null) return null;
  const newest = newestSubdomainProcess(subdomainProcessesOf(activity), serviceId);
  return newest?.actionName === "stack.enableSubdomainAccess" && newest.status === "FINISHED"
    ? (newest.finished ?? null)
    : null;
}

/** When a project's service's record was last updated, on Zerops' clock; null where not said. */
export function serviceUpdatedAtIn(
  services: CollectionRead<ServiceRecord> | null,
  serviceId: string,
): string | null {
  for (const entry of services?.value ?? []) {
    if (entry.knowledge !== "observed" || entry.record.ref.serviceId !== serviceId) continue;
    const lifecycle = entry.record.lifecycle;
    return lifecycle.knowledge === "observed" ? (lifecycle.fields.updatedAt ?? null) : null;
  }
  return null;
}

/**
 * What a reader remembers of its containers' addresses, by service id (`AddressSeen`). It outlives
 * every read — a listing that blinks unread, a project not admitted for a moment — so a container
 * once seen with its address never waits for it, and one watched coming up stays watched.
 */
export type AddressMemory = ReadonlyMap<string, AddressSeen>;

export const NO_ADDRESS_MEMORY: AddressMemory = new Map();

/**
 * What a reader derives its rows by: what it remembers, and where the platform stands on turning
 * each address on, where the reader reads that.
 */
export const addressFactsOf = (
  memory: AddressMemory,
  nowMs: number,
  subdomainEnable?: (projectId: string, serviceId: string) => SubdomainEnable | undefined,
): AddressFacts => ({
  nowMs,
  addressSeen: (serviceId) => memory.get(serviceId),
  ...(subdomainEnable === undefined ? {} : { subdomainEnable }),
});

/** The memory after rows a reader derived; the same memory when they taught it nothing. */
export function rememberAddresses(
  memory: AddressMemory,
  rows: ReadonlyArray<ZeropsCandidate>,
): AddressMemory {
  let next: Map<string, AddressSeen> | null = null;
  for (const row of rows) {
    if (row.service === undefined) continue;
    const held = memory.get(row.service.id);
    const kept = addressSeenAfter(row, held);
    if (kept === held) continue;
    next ??= new Map(memory);
    if (kept === undefined) next.delete(row.service.id);
    else next.set(row.service.id, kept);
  }
  return next ?? memory;
}

/**
 * When the first of the rows' arrival poses ends (`arriving`), wall ms; null when none is shown.
 * A pose only: an address's wait ends by its process, never here.
 */
export function arrivalEnd(rows: ReadonlyArray<ZeropsCandidate>): number | null {
  let end: number | null = null;
  for (const row of rows) {
    const until = row.arriving?.until;
    if (until !== undefined && (end === null || until < end)) end = until;
  }
  return end;
}

/**
 * What a reader's listings teach its address memory, and when the soonest arrival pose among them
 * ends — read off the known ones, so a reader never reads a listing's value itself (web and mobile
 * never read a Known's value).
 */
export function learnAddresses(
  memory: AddressMemory,
  listings: ReadonlyArray<Known<ReadonlyArray<ZeropsCandidate>>>,
): { readonly memory: AddressMemory; readonly arrivalEnd: number | null } {
  let learned = memory;
  let soonest: number | null = null;
  for (const listing of listings) {
    if (listing.state !== "known") continue;
    learned = rememberAddresses(learned, listing.value);
    const end = arrivalEnd(listing.value);
    if (end !== null && (soonest === null || end < soonest)) soonest = end;
  }
  return { memory: learned, arrivalEnd: soonest };
}

/** The listing of known projects out of each project's rows, in the projects' order. */
export function candidateListing<Project>(
  projects: Extract<Known<ReadonlyArray<Project>>, { readonly state: "known" }>,
  rowsOfEach: ReadonlyArray<ReadonlyArray<CandidateRow>>,
): Extract<Known<ReadonlyArray<CandidateRow>>, { readonly state: "known" }> {
  return { ...projects, value: rowsOfEach.flat() };
}

/**
 * Whether a surface may say "none" of anything the rows lack — no project, no Mate (M5): the
 * listing is known and complete, and the inventory has read every row's presence.
 */
export function candidatesComplete(listing: Shown<ReadonlyArray<CandidateRow>>): boolean {
  return (
    listing.state === "known" &&
    listing.coverage === "complete" &&
    listing.value.every((row) => row.presence === "known")
  );
}

/**
 * Whether a listing will tell no more for now (unknown is not empty, but it ends): complete, or
 * settled as failed, gone or withheld, or partial with nothing more being read of it — what it
 * lacks is withheld — or past its patience (`STILL_READING_PATIENCE_MS`), its missing parts failing
 * and retried on their own backoff. A surface waiting on "every Mate" stops waiting here.
 */
export function listingSettled(
  listing: Shown<ReadonlyArray<CandidateRow>>,
  input: {
    /** The inventory is still reading something of the organization in view. */
    readonly loading: boolean;
    /** The listing has been partial for less than `STILL_READING_PATIENCE_MS`. */
    readonly patient: boolean;
  },
): boolean {
  switch (listing.state) {
    case "unread":
    case "reading":
      return false;
    case "failed":
    case "gone":
    case "withheld":
      return true;
    case "known":
      return candidatesComplete(listing) || !input.loading || !input.patient;
  }
}

/**
 * The listing's items the account's grant admits. Dropping one leaves the listing partial: the
 * organization holds a project this list does not show, so no surface may read "none" off it (M5).
 */
export function admittedOnly<T>(
  listing: Known<ReadonlyArray<T>>,
  admits: (item: T) => boolean,
): Known<ReadonlyArray<T>> {
  if (listing.state !== "known") return listing;
  const value = listing.value.filter(admits);
  return value.length === listing.value.length
    ? listing
    : { ...listing, value, coverage: "partial" };
}

/**
 * A listing's rows as a surface presents them, as known as the listing is: a listing that holds no
 * rows (unread, being read, failed, gone, withheld) passes through as it is, never as an empty one.
 */
export function presentCandidates<Row, Presented>(
  listing: Known<ReadonlyArray<Row>>,
  present: (row: Row) => Presented,
): Known<ReadonlyArray<Presented>>;
export function presentCandidates<Row, Presented>(
  listing: Shown<ReadonlyArray<Row>>,
  present: (row: Row) => Presented,
): Shown<ReadonlyArray<Presented>>;
export function presentCandidates<Row, Presented>(
  listing: Shown<ReadonlyArray<Row>>,
  present: (row: Row) => Presented,
): Shown<ReadonlyArray<Presented>> {
  if (listing.state !== "known") return listing;
  return { ...listing, value: listing.value.map(present) };
}

/**
 * The rows a surface draws of a listing, with the one licence to read a "none" off them. `rows`
 * are every row of a complete listing, the ones read of a partial one, and none while the listing
 * holds no rows at all (unread, being read, failed, gone, withheld); only `complete` (`candidatesComplete`)
 * says they are all the rows there are.
 */
export interface HeldCandidates<Row> {
  readonly rows: ReadonlyArray<Row>;
  readonly complete: boolean;
}

export function heldCandidates<Row extends CandidateRow>(
  listing: Shown<ReadonlyArray<Row>>,
): HeldCandidates<Row> {
  switch (listing.state) {
    case "known":
      return { rows: listing.value, complete: candidatesComplete(listing) };
    default:
      return { rows: [], complete: false };
  }
}

/** What a region drawn from the listing says in place of a "none" it may not say yet (§3.4). */
export interface CandidatesNotice {
  readonly region: KnownPresentation["region"];
  readonly message: KnownMessage;
  readonly affordance: KnownAffordance | null;
}

/**
 * How long a listing known only in part holds before it says "Still reading…": the one voice's
 * quiet (`MATE_VOICE_QUIET_MS`), so a read that lands within it never paints a line it takes back.
 */
export const STILL_READING_HOLD_MS = 1_500;

/**
 * How long a listing known only in part may keep saying "Still reading…" over the rows it holds.
 * Past it, the read is not arriving but failing or refused, and is retried on its own backoff; the
 * rows hold what they have, and a Mate the read brings later simply appears.
 */
export const STILL_READING_PATIENCE_MS = 20_000;

export interface CandidatesNoticeOptions {
  /** The listing has been partial for less than `STILL_READING_PATIENCE_MS`. */
  readonly patient?: boolean;
  /**
   * The region holds its rows' room and says nothing while they are plainly read — the menu, beside
   * a page that says it once (pass 30); a wait with a cause, a partial listing and a failure speak.
   */
  readonly readingSilent?: boolean;
}

/**
 * The region's notice while the listing may not say "none" yet: a placeholder while it is unread
 * or being read, the cause and one affordance when its read failed, and "Still reading…" over the
 * rows of a listing known only in part — after `STILL_READING_HOLD_MS`, and over rows only while
 * it is `patient`. A row whose presence is unread says so itself ("Checking"), so a complete
 * listing has nothing to say here, nor has one a lapse withholds, whose words are the app's one
 * banner (§3.4). Copy, delay and affordance are otherwise `knownPresentation`'s.
 */
export function candidatesNotice<Row extends CandidateRow>(
  listing: Shown<ReadonlyArray<Row>>,
  surface: KnownSurface<ReadonlyArray<Row>>,
  nowMs: number,
  options: CandidatesNoticeOptions = {},
): CandidatesNotice | null {
  if (listing.state === "known" && listing.coverage === "complete") return null;
  const presentation = knownPresentation(listing, surface, { nowMs, updateOffered: false });
  const message = presentation.message;
  if (message === null) return null;
  // Only the plain read is silent there: a wait with a cause (offline, a background tab, a sign-in)
  // and "Still reading…" over a partial listing still say why the rows are late.
  const plainRead =
    (listing.state === "unread" && listing.waitingFor === null) || listing.state === "reading";
  if (options.readingSilent === true && plainRead) return null;
  const reading = listing.state === "known" && message.tone === "quiet";
  if (reading && options.patient === false && listing.value.length > 0) return null;
  return {
    region: presentation.region,
    message: reading ? { ...message, afterMs: STILL_READING_HOLD_MS } : message,
    affordance: presentation.affordance,
  };
}

/**
 * One candidate looked up in a listing. `absent` is earned (M5): the listing is complete and every
 * row's presence is read. `pending` is a listing that has not answered yet (unread or being read);
 * `unknown` one that holds what it will until something changes (failed, gone, withheld, partial,
 * or a presence unread), so its lack of the row says nothing either.
 */
export type CandidateLookup<Row> =
  | { readonly kind: "found"; readonly row: Row }
  | { readonly kind: "absent" }
  | { readonly kind: "pending" }
  | { readonly kind: "unknown" };

const ABSENT: CandidateLookup<never> = { kind: "absent" };
const PENDING: CandidateLookup<never> = { kind: "pending" };
const UNKNOWN: CandidateLookup<never> = { kind: "unknown" };

export function findCandidate<Row extends CandidateRow>(
  listing: Shown<ReadonlyArray<Row>>,
  matches: (row: Row) => boolean,
): CandidateLookup<Row> {
  switch (listing.state) {
    case "unread":
    case "reading":
      return PENDING;
    case "known": {
      const row = listing.value.find(matches);
      if (row !== undefined) return { kind: "found", row };
      return candidatesComplete(listing) ? ABSENT : UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

/**
 * The names the organization's Mates already go by: their projects' names in Zerops under their application (`projectNameInApp`). `complete`
 * — the one licence to call a name free — is the listing being known and complete, HQ's structure
 * known (`structureKnown`: until it answers, which project is a Mate is unread), and no member of
 * its list withheld from this account (`withheldMembers`: its name is on it, unread). Until then a
 * name found here is taken and one missing may still be.
 */
export interface TakenBotNames {
  readonly names: ReadonlyArray<string>;
  readonly complete: boolean;
}

export function takenBotNames(
  listing: Shown<ReadonlyArray<ZeropsCandidate>>,
  options: { readonly withheldMembers?: boolean; readonly structureKnown: boolean },
): TakenBotNames {
  switch (listing.state) {
    case "known":
      return {
        names: listing.value.flatMap((row) => {
          return readZeropsMembership(row.project).mate ? [projectNameInApp(row.project)] : [];
        }),
        complete:
          listing.coverage === "complete" &&
          options.withheldMembers !== true &&
          options.structureKnown,
      };
    default:
      return { names: [], complete: false };
  }
}

/**
 * Whether a surface may say the organization holds no project (M5): the listing is known and
 * complete, and none of its rows is one `isProject` counts (a tool, say, is not).
 */
export function listsNoProject<Row>(
  listing: Shown<ReadonlyArray<Row>>,
  isProject: (row: Row) => boolean,
): boolean {
  return (
    listing.state === "known" && listing.coverage === "complete" && !listing.value.some(isProject)
  );
}
