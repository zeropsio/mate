/**
 * Whether a new project in an organization waits for credit, as a create dialog forecasts it before
 * Create. Zerops makes an organization's first project free and refuses any after it while the
 * organization is unverified and holds no credit, promo credit included: the forecast says so when
 * the organization's record says no top-up verified it, its balance holds nothing, and its projects,
 * read whole, hold its free project already. Anything unread, refused or failed forecasts nothing:
 * Zerops stays the authority on the press. A record or balance read before the dialog opened
 * forecasts nothing either: a top-up or a promo grant since may have overtaken it, so the dialog
 * waits for its own reads' answers.
 *
 * @module data/projections/creditForecast
 */
import { balanceScope } from "../families/organizationBalance.ts";
import { creditScope } from "../families/organizationCredit.ts";
import { projectsScope } from "../families/project.ts";
import type { ScopeKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";

export interface CreditForecastKey {
  readonly orgId: string;
  /** The credit read's generation when the dialog opened: only a read after it answers. */
  readonly openedAt: number;
  /** The balance read's generation when the dialog opened: only a read after it answers. */
  readonly balanceOpenedAt: number;
}

/**
 * Answered since the dialog opened: a read after it came back, and none failed since — read again
 * on the cadence, the answer this dialog had stands.
 */
const answeredSince = (read: ProjectionReads, scope: ScopeKey, openedAt: number): boolean => {
  const stream = read.stream(scope);
  return (
    stream.generation > openedAt &&
    (stream.phase === "live" || (stream.failures === 0 && stream.generation > openedAt + 1)) &&
    read.coverage(scope) === "complete"
  );
};

export const creditForecast: Projection<CreditForecastKey, boolean> = {
  name: "creditForecast",
  keyOf: ({ orgId, openedAt, balanceOpenedAt }) =>
    `${String(openedAt)}:${String(balanceOpenedAt)}:${orgId}`,
  equals: (left, right) => left === right,
  derive: (read, { orgId, openedAt, balanceOpenedAt }) => {
    if (!answeredSince(read, creditScope(orgId), openedAt)) return false;
    if (!answeredSince(read, balanceScope(orgId), balanceOpenedAt)) return false;
    const credit = read.fact("organizationCredit", orgId);
    if (credit.kind !== "known" || credit.value.verified) return false;
    const balance = read.fact("organizationBalance", orgId);
    if (balance.kind !== "known" || balance.value.credit + balance.value.promoCredit > 0) {
      return false;
    }
    const projects = read.members(projectsScope(orgId));
    return projects.coverage === "complete" && projects.ids.length > 0;
  },
};
