/**
 * A Mate's visibility for the signed-in person — `open`, `listed` or `hidden` — from live Zerops
 * data alone: its project's row as the organization's roster holds it (`userRoles`, pushed) and
 * the person's own membership (`organizationUser`), through the one role function
 * (`resolveMateVisibility`). HQ lists every Mate of the organization; this is what hides those the
 * person cannot reach. `unknown` until both are read: nothing is hidden on a guess.
 *
 * @module data/projections/mateVisibility
 */
import { resolveMateVisibility, type RoleMateVisibility } from "../../zerops/mateAccess.ts";
import { projectsScope } from "../families/project.ts";
import { placedMates } from "../placedRows.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { platformMembership } from "./platformCapabilities.ts";

export const mateVisibility: Projection<
  { readonly orgId: string; readonly projectId: string },
  RoleMateVisibility | "unknown"
> = {
  name: "mateVisibility",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const viewer = platformMembership.derive(read, orgId).viewer;
    if (viewer === undefined) return "unknown";
    const roster = read.members(projectsScope(orgId));
    const fact = read.fact("project", projectId);
    if (roster.ids.includes(projectId))
      // Listed to the person, its row not read yet: nothing to judge by.
      return fact.kind === "known"
        ? resolveMateVisibility({ project: fact.value, viewer })
        : "unknown";
    // The person's whole roster lacks it: Zerops lists them no such project.
    return roster.coverage === "complete" && !roster.unverified.includes(projectId)
      ? "hidden"
      : "unknown";
  },
  equals: sameValue,
};

/**
 * Every Mate HQ places in the organization, by project, with the person's verdict on it
 * (`mateVisibility`): where a change of their role in Zerops' own data is heard
 * (`zerops/account/mateRoles.ts`).
 */
export const placedMateVisibilities: Projection<
  string,
  Readonly<Record<string, RoleMateVisibility | "unknown">>
> = {
  name: "placedMateVisibilities",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) =>
    Object.fromEntries(
      placedMates(read, orgId).map((projectId) => [
        projectId,
        mateVisibility.derive(read, { orgId, projectId }),
      ]),
    ),
  equals: sameValue,
};
