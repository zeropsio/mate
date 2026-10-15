/**
 * Whether a new project in an organization waits for credit, as a create dialog forecasts it before
 * Create: the organization's record says no top-up verified it, and its projects, read whole, hold
 * its one free project already. Anything unread, refused or failed forecasts nothing: Zerops stays
 * the authority on the press.
 *
 * @module data/projections/creditForecast
 */
import { creditScope } from "../families/organizationCredit.ts";
import { projectsScope } from "../families/project.ts";
import type { Projection } from "../store.ts";

export const creditForecast: Projection<string, boolean> = {
  name: "creditForecast",
  keyOf: (orgId) => orgId,
  equals: (left, right) => left === right,
  derive: (read, orgId) => {
    const credit = read.fact("organizationCredit", orgId);
    if (credit.kind !== "known" || credit.value.verified) return false;
    if (read.coverage(creditScope(orgId)) !== "complete") return false;
    const projects = read.members(projectsScope(orgId));
    return projects.coverage === "complete" && projects.ids.length > 0;
  },
};
