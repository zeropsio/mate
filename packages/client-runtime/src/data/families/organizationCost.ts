/**
 * What the organization and each of its projects cost on Zerops over the usual periods, as billing
 * answers it (`POST /transaction-debit/cost-search` for the organization, the read Zerops HQ's
 * billing makes): today, this month, the last 30 days, and the daily rate those 30 days average.
 * Cost moves by the hour: a new demand reads it again only once the last read is an hour old.
 * A viewer billing refuses holds no figure: unknown, never zero. Measured 2026-11-11:
 * `{client, project[], stack[], resource[]}`, each with a `periodCost`; `averageLast30Days` is a
 * 30-day amount (the GUI divides it by 30 and 24 for its hourly rate).
 *
 * @module data/families/organizationCost
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { SPEND_FRESH_MS } from "./projectSpend.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface PeriodCost {
  readonly today: number;
  readonly thisMonth: number;
  readonly last30Days: number;
  /** The last 30 days' cost a day, on average. */
  readonly perDay: number;
}

export interface OrganizationCostValue {
  readonly organization: PeriodCost;
  /** Each project the read names, by its id. */
  readonly projects: Readonly<Record<string, PeriodCost>>;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly organizationCost: OrganizationCostValue;
  }
}

const Money = Schema.optionalKey(Schema.NullOr(Schema.Finite));
const Period = Schema.Struct({
  today: Money,
  thisMonth: Money,
  last30days: Money,
  averageLast30Days: Money,
});
const Entry = Schema.Struct({ id: Schema.String, periodCost: Schema.optionalKey(Period) });
const Answer = Schema.Struct({
  client: Schema.optionalKey(Entry),
  project: Schema.optionalKey(Schema.Array(Entry)),
});
const decodeAnswer = Schema.decodeUnknownOption(Answer);

const periodOf = (period: typeof Period.Type | undefined): PeriodCost => ({
  today: period?.today ?? 0,
  thisMonth: period?.thisMonth ?? 0,
  last30Days: period?.last30days ?? 0,
  perDay: (period?.averageLast30Days ?? 0) / 30,
});

export function readOrganizationCost(answer: unknown): OrganizationCostValue | null {
  return Option.match(decodeAnswer(answer), {
    onNone: () => null,
    onSome: ({ client, project }) =>
      client === undefined
        ? null
        : {
            organization: periodOf(client.periodCost),
            projects: Object.fromEntries(
              (project ?? []).map((entry) => [entry.id, periodOf(entry.periodCost)]),
            ),
          },
  });
}

export const organizationCostFamily: FamilySpec<"organizationCost"> = {
  family: "organizationCost",
  authority: "zerops",
  scope: { source: "zerops", suffix: "cost", leaving: "removed", demand: "detail" },
  sampled: {
    path: () => "/transaction-debit/cost-search",
    search: ({ ownerId }) => ({ search: [{ name: "clientId", operator: "eq", value: ownerId }] }),
    decode: readOrganizationCost,
    freshMs: SPEND_FRESH_MS,
  },
};

/** The organization's cost, demanded with the organization's id as its owner. */
export const organizationCostScope = (orgId: string): ScopeKey =>
  scopeOf(organizationCostFamily, orgId, orgId);
