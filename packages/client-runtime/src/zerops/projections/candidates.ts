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
