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

import type { ZeropsService } from "../api.ts";
import { deriveZeropsCandidates, isZcpService, type ZeropsCandidate } from "../candidates.ts";
import { projectRecordToZeropsProject, serviceRecordToZeropsService } from "../data/dto.ts";
import type { ProjectRecord, ProjectRef, ServiceRecord } from "../data/types.ts";
import type { Known } from "../knowledge/known.ts";

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

/**
 * Every candidate the organization's projects hold. The listing is as known as the projects are:
 * unread, reading or failed projects give no rows at all, never an empty list. A project whose
 * name or status is not read yet is left out, and the listing is then partial.
 */
export function selectCandidates(
  projects: Known<ReadonlyArray<ProjectRecord>>,
  servicesOf: (project: ProjectRef) => Known<ReadonlyArray<ServiceRecord>>,
): Known<ReadonlyArray<CandidateRow>> {
  if (projects.state !== "known") return projects;
  const rows: CandidateRow[] = [];
  let complete = projects.coverage === "complete";
  for (const record of projects.value) {
    const project = projectRecordToZeropsProject(record);
    if (project === null) {
      complete = false;
      continue;
    }
    if (project.status !== "ACTIVE") {
      for (const candidate of deriveZeropsCandidates(project, [], NO_CONNECTIONS))
        rows.push({ ...candidate, presence: "known" });
      continue;
    }
    const services = readServices(servicesOf(record.ref));
    if (services === null) {
      rows.push({ key: project.id, project, group: "unavailable", presence: "unknown" });
      continue;
    }
    for (const candidate of deriveZeropsCandidates(project, services, NO_CONNECTIONS))
      rows.push({ ...candidate, presence: "known" });
  }
  return { ...projects, value: rows, coverage: complete ? "complete" : "partial" };
}

/**
 * Whether a surface may say "none" of anything the rows lack — no project, no Mate (M5): the
 * listing is known and complete, and the inventory has read every row's presence.
 */
export function candidatesComplete(listing: Known<ReadonlyArray<CandidateRow>>): boolean {
  return (
    listing.state === "known" &&
    listing.coverage === "complete" &&
    listing.value.every((row) => row.presence === "known")
  );
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
 * rows (unread, being read, failed, gone) passes through as it is, never as an empty one.
 */
export function presentCandidates<Row, Presented>(
  listing: Known<ReadonlyArray<Row>>,
  present: (row: Row) => Presented,
): Known<ReadonlyArray<Presented>> {
  if (listing.state !== "known") return listing;
  return { ...listing, value: listing.value.map(present) };
}

const NO_MEMBERS: ReadonlyArray<never> = [];

/**
 * The rows a listing holds, for a surface that looks a candidate up or draws the rows read so far:
 * every row of a complete listing, the ones read of a partial one, and none while it holds no rows
 * at all. Nothing negative may be read off it — `candidatesComplete` says when these are all the
 * rows there are.
 */
export function candidateMembers<Row>(listing: Known<ReadonlyArray<Row>>): ReadonlyArray<Row> {
  return listing.state === "known" ? listing.value : NO_MEMBERS;
}

/**
 * Whether a surface may say the organization holds no project (M5): the listing is known and
 * complete, and none of its rows is one `isProject` counts (a tool, say, is not).
 */
export function listsNoProject<Row>(
  listing: Known<ReadonlyArray<Row>>,
  isProject: (row: Row) => boolean,
): boolean {
  return (
    listing.state === "known" && listing.coverage === "complete" && !listing.value.some(isProject)
  );
}
