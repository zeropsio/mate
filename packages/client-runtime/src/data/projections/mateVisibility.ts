/**
 * Whether a Mate HQ lists to the signed-in person opens for them — `open` or only `listed` — from
 * live Zerops data alone: its project's row as the organization's roster holds it (`userRoles`,
 * pushed) and the person's own membership (`organizationUser`), through the one role function
 * (`resolveMateVisibility`). HQ decides which Mates are listed; this says only whether one opens,
 * and a Mate HQ still sends whom Zerops now gives less than Read only is listed, never opened.
 * `unknown` until both are read, or while the roster lacks its project: nothing is judged on a guess.
 *
 * @module data/projections/mateVisibility
 */
import { resolveMateVisibility } from "../../zerops/mateAccess.ts";
import { projectsScope } from "../families/project.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { platformMembership } from "./platformCapabilities.ts";

export const mateVisibility: Projection<
  { readonly orgId: string; readonly projectId: string },
  "open" | "listed" | "unknown"
> = {
  name: "mateVisibility",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const viewer = platformMembership.derive(read, orgId).viewer;
    if (viewer === undefined) return "unknown";
    // The roster lacks it (a just-made Mate, or one whose absence is being verified): HQ's to
    // judge, not this read's.
    if (!read.members(projectsScope(orgId)).ids.includes(projectId)) return "unknown";
    const fact = read.fact("project", projectId);
    // Listed to the person, its row not read yet: nothing to judge by.
    if (fact.kind !== "known") return "unknown";
    return resolveMateVisibility({ project: fact.value, viewer }) === "open" ? "open" : "listed";
  },
  equals: sameValue,
};
