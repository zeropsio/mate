import type { CandidateRow } from "../projections/candidates.ts";

/**
 * The projects a window watches for a container's address to land (`updateAddressWatch`): every
 * container ACTIVE without its address in the organization in view, where a screen shows its
 * project — or, shown or not, where it is on its way to its address (`provisioning`). No push is
 * promised to bring a service's record after its address is turned on (8c076ec029), and a Mate
 * coming up has no environment yet, so no menu row "draws" it: a window that only lists it — a
 * teammate's, the maker's other windows — read it as coming up until a reload. A container whose
 * public access is off is no arrival; it is watched only while a screen shows it.
 */
export function addressWatchedProjects(input: {
  readonly rows: ReadonlyArray<
    Pick<CandidateRow, "presence" | "group"> & {
      readonly containerOrigin?: string | undefined;
      readonly project: Pick<CandidateRow["project"], "id">;
      readonly service?: Pick<NonNullable<CandidateRow["service"]>, "status"> | undefined;
    }
  >;
  readonly shown: ReadonlySet<string>;
  readonly inOrganization: (projectId: string) => boolean;
}): ReadonlySet<string> {
  const watched = new Set<string>();
  for (const row of input.rows) {
    if (row.presence !== "known" || row.service?.status !== "ACTIVE") continue;
    if (row.containerOrigin !== undefined) continue;
    if (row.group !== "provisioning" && !input.shown.has(row.project.id)) continue;
    if (input.inOrganization(row.project.id)) watched.add(row.project.id);
  }
  return watched;
}
