/**
 * Whether a new project in an organization waits for credit, as a create dialog forecasts it before
 * Create: the organization's record says no top-up verified it, and its projects, read whole, hold
 * its one free project already. Anything unread, refused or failed forecasts nothing: Zerops stays
 * the authority on the press. A record read before the dialog opened forecasts nothing either: a
 * top-up since may have verified it, so the dialog waits for its own read's answer.
 *
 * @module data/projections/creditForecast
 */
import { creditScope } from "../families/organizationCredit.ts";
import { projectsScope } from "../families/project.ts";
import type { Projection } from "../store.ts";

export interface CreditForecastKey {
  readonly orgId: string;
  /** The credit read's generation when the dialog opened: only a read after it answers. */
  readonly openedAt: number;
}

export const creditForecast: Projection<CreditForecastKey, boolean> = {
  name: "creditForecast",
  keyOf: ({ orgId, openedAt }) => `${String(openedAt)}:${orgId}`,
  equals: (left, right) => left === right,
  derive: (read, { orgId, openedAt }) => {
    // Answered since the dialog opened: a read after it came back, and none failed since — read
    // again on the cadence, the answer this dialog had stands.
    const stream = read.stream(creditScope(orgId));
    const answered =
      stream.generation > openedAt &&
      (stream.phase === "live" || (stream.failures === 0 && stream.generation > openedAt + 1));
    if (!answered) return false;
    const credit = read.fact("organizationCredit", orgId);
    if (credit.kind !== "known" || credit.value.verified) return false;
    if (read.coverage(creditScope(orgId)) !== "complete") return false;
    const projects = read.members(projectsScope(orgId));
    return projects.coverage === "complete" && projects.ids.length > 0;
  },
};
