/**
 * An organization's money as Mate shows it, every action on it staying in Zerops: its balance as
 * Zerops keeps it live, how long it lasts at the last 30 days' rate, the project Zerops will stop
 * soonest for insufficient funds, and the one tone the menu's figure and a project's line share.
 * Zerops is the authority on when a project stops (`projectStatus` hours); the days are only the
 * balance over its rate, shown where no automatic top-up refills it.
 *
 * @module data/projections/billing
 */
import { balanceScope, type OrganizationBalanceValue } from "../families/organizationBalance.ts";
import { organizationCostScope, type OrganizationCostValue } from "../families/organizationCost.ts";
import { projectStatusScope } from "../families/projectStatus.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

/** A project stopping within this many hours is said, quietly. */
export const STOP_SOON_HOURS = 72;
/** Within this many it is said as a problem: the Zerops GUI's own warning. */
export const STOP_IMMINENT_HOURS = 8;
/** A balance lasting fewer days than this, with nothing to refill it, is running low. */
const LOW_DAYS = 3;

export type BillingTone = "quiet" | "low" | "out";

export type CostRead =
  | { readonly kind: "known"; readonly value: OrganizationCostValue }
  | { readonly kind: "reading" }
  | { readonly kind: "refused" };

export interface OrganizationBilling {
  /** `known`: Zerops shows this account the balance; `refused`: it does not; else still reading. */
  readonly kind: "known" | "reading" | "refused";
  readonly balance: OrganizationBalanceValue | null;
  /** Credit and promo credit together: what Zerops spends from. */
  readonly total: number | null;
  /** The cost read: known, still reading, or refused to this account. */
  readonly cost: CostRead;
  /** How many days the total lasts at the last 30 days' rate; `null` with nothing to divide. */
  readonly daysLeft: number | null;
  /** The project Zerops will stop soonest for insufficient funds, where it says one. */
  readonly soonest: { readonly projectId: string; readonly hoursLeft: number } | null;
  readonly tone: BillingTone;
}

/** Whether the balance is live and listed: current without a read of its own. */
export const balanceLive: Projection<string, boolean> = {
  name: "balanceLive",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const scope = balanceScope(orgId);
    return read.stream(scope).phase === "live" && read.coverage(scope) === "complete";
  },
  equals: (left, right) => left === right,
};

function costRead(read: ProjectionReads, orgId: string): CostRead {
  const fact = read.fact("organizationCost", orgId);
  if (fact.kind === "known") return { kind: "known", value: fact.value };
  return read.stream(organizationCostScope(orgId)).phase === "refused"
    ? { kind: "refused" }
    : { kind: "reading" };
}

function soonestStop(read: ProjectionReads, orgId: string) {
  let soonest: { readonly projectId: string; readonly hoursLeft: number } | null = null;
  for (const projectId of read.members(projectStatusScope(orgId)).ids) {
    const status = read.fact("projectStatus", projectId);
    if (status.kind !== "known" || status.value.hoursLeft === null) continue;
    if (soonest === null || status.value.hoursLeft < soonest.hoursLeft) {
      soonest = { projectId, hoursLeft: status.value.hoursLeft };
    }
  }
  return soonest;
}

export function billingTone(input: {
  readonly total: number | null;
  readonly daysLeft: number | null;
  readonly refills: boolean;
  readonly soonestHours: number | null;
}): BillingTone {
  if (input.total !== null && input.total < 0) return "out";
  if (input.soonestHours !== null && input.soonestHours <= STOP_IMMINENT_HOURS) return "out";
  if (input.soonestHours !== null && input.soonestHours <= STOP_SOON_HOURS) return "low";
  if (!input.refills && input.daysLeft !== null && input.daysLeft < LOW_DAYS) return "low";
  return "quiet";
}

export const organizationBilling: Projection<string, OrganizationBilling> = {
  name: "organizationBilling",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const scope = balanceScope(orgId);
    const fact = read.fact("organizationBalance", orgId);
    const cost = costRead(read, orgId);
    const soonest = soonestStop(read, orgId);
    if (fact.kind !== "known") {
      return {
        kind: read.stream(scope).phase === "refused" ? "refused" : "reading",
        balance: null,
        total: null,
        cost,
        daysLeft: null,
        soonest,
        tone: "quiet",
      };
    }
    const balance = fact.value;
    const total = balance.credit + balance.promoCredit;
    const perDay = cost.kind === "known" ? cost.value.organization.perDay : 0;
    const daysLeft = perDay > 0 ? Math.max(0, total) / perDay : null;
    return {
      kind: "known",
      balance,
      total,
      cost,
      daysLeft,
      soonest,
      tone: billingTone({
        total,
        daysLeft,
        refills: balance.autoTopUp !== null,
        soonestHours: soonest?.hoursLeft ?? null,
      }),
    };
  },
  equals: sameValue,
};

export interface ProjectCredit {
  /** The project Zerops will stop soonest for insufficient funds, where it says one soon. */
  readonly projectId: string | null;
  readonly hoursLeft: number | null;
  readonly tone: BillingTone;
}

const NO_STOP: ProjectCredit = { projectId: null, hoursLeft: null, tone: "quiet" };

/**
 * Whether Zerops will stop any of some projects soon for insufficient funds — a card's or a
 * project page's stage, production and Mates — and which, soonest. Only Zerops says a project
 * stops: unread, refused or unstated, nothing is said.
 */
export const projectsCredit: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  ProjectCredit
> = {
  name: "projectsCredit",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { projectIds }) => {
    let soonest: ProjectCredit = NO_STOP;
    for (const projectId of projectIds) {
      const status = read.fact("projectStatus", projectId);
      if (status.kind !== "known") continue;
      const hours = status.value.hoursLeft;
      if (hours === null || hours > STOP_SOON_HOURS) continue;
      if (soonest.hoursLeft === null || hours < soonest.hoursLeft) {
        soonest = {
          projectId,
          hoursLeft: hours,
          tone: hours <= STOP_IMMINENT_HOURS ? "out" : "low",
        };
      }
    }
    return soonest;
  },
  equals: sameValue,
};

/** When a project stops, in words: "in under 8 hours", "in about 2 days". */
export function stopWords(hoursLeft: number): string {
  if (hoursLeft <= 2) return "in under 2 hours";
  if (hoursLeft <= STOP_IMMINENT_HOURS) return "in under 8 hours";
  if (hoursLeft < 24) return `in about ${String(Math.ceil(hoursLeft))} hours`;
  const days = Math.round(hoursLeft / 24);
  return days === 1 ? "in about a day" : `in about ${String(days)} days`;
}
