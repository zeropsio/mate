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
    if (roster.ids.includes(projectId) && fact.kind === "known")
      return resolveMateVisibility({ project: fact.value, viewer });
    // The person's whole roster lacks it: Zerops lists them no such project.
    return roster.coverage === "complete" && !roster.unverified.includes(projectId)
      ? "hidden"
      : "unknown";
  },
  equals: sameValue,
};
