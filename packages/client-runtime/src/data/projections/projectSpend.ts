/**
 * What a project cost on Zerops each of the last 30 days: the organization's spend read
 * (`projectSpend`) summed over the Zerops projects it is made of — its Mates' projects, its stage
 * and its production. A refused or failed read with nothing held is unknown, never zero; a read
 * held through a later failure stands.
 *
 * @module data/projections/projectSpend
 */
import { addDays, projectSpendScope, SPEND_DAYS, type SpendDay } from "../families/projectSpend.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface ComputeSpendKey {
  readonly orgId: string;
  readonly projectIds: ReadonlyArray<string>;
}

export type ComputeSpendRead =
  | { readonly kind: "reading" }
  | { readonly kind: "unknown" }
  | {
      readonly kind: "read";
      /** The window's days, oldest first; the last is today as the read saw it. */
      readonly days: ReadonlyArray<SpendDay>;
      /** Each day's compute cost, in dollars, aligned with `days`. */
      readonly usd: ReadonlyArray<number>;
    };

export const computeSpend: Projection<ComputeSpendKey, ComputeSpendRead> = {
  name: "computeSpend",
  keyOf: ({ orgId, projectIds }) => JSON.stringify([orgId, [...projectIds].sort()]),
  equals: sameValue,
  derive: (read, { orgId, projectIds }) => {
    const fact = read.fact("projectSpend", orgId);
    if (fact.kind !== "known") {
      return fact.kind === "withheld" || read.stream(projectSpendScope(orgId)).fault !== null
        ? { kind: "unknown" }
        : { kind: "reading" };
    }
    const spend = fact.value;
    if (!spend.complete && projectIds.some((id) => spend.byProject[id] === undefined))
      return { kind: "unknown" };
    const days = Array.from({ length: SPEND_DAYS }, (_, at) =>
      addDays(spend.lastDay, at + 1 - SPEND_DAYS),
    );
    const projects = [...new Set(projectIds)];
    return {
      kind: "read",
      days,
      usd: days.map((day) =>
        projects.reduce((sum, id) => sum + (spend.byProject[id]?.[day] ?? 0), 0),
      ),
    };
  },
};
