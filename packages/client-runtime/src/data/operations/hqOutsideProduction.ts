/**
 * A production deployed outside Mate, said by an Owner or Admin: the application's `main` goes
 * live on every merge, at an address or at none given, or — `outside: null` — nobody says so any
 * more. It is a statement HQ keeps, never a deploy it saw: the application's production environment
 * of the `outside` kind. HQ's answer is that environment's target as it stands after, and the
 * application's environment list in HQ's navigation is where every surface reads it from then on.
 * HQ keeps no request id for it; a lost answer stays uncertain and nothing is sent again blindly.
 *
 * @module data/operations/hqOutsideProduction
 */
import { hqAppsScope } from "../families/hqNavigation.ts";
import { canonicalAppEnvironments } from "../projections/appEnvironments.ts";
import { sameValue } from "../projections/equal.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { OperationKind } from "./kind.ts";

/** Production as somebody said it is deployed outside Mate: where it answers, where an address was given. */
export interface OutsideProduction {
  readonly address: string | null;
}

declare module "../model.ts" {
  interface OperationIntents {
    readonly "set-outside-production": {
      readonly orgId: string;
      readonly appId: string;
      /** `null` lifts it: production is no longer said to be deployed outside Mate. */
      readonly outside: OutsideProduction | null;
    };
  }
  interface OperationResults {
    readonly "set-outside-production": { readonly outside: OutsideProduction | null };
  }
}

/** What a refused write is coded where HQ is older than the statement (`OUTSIDE_NEEDS_UPDATE`). */
export const OUTSIDE_PRODUCTION_UNSUPPORTED = "outside_production_unsupported";

/**
 * The statement as the application's environment list in HQ's navigation holds it: `null` where no
 * outside production stands, `undefined` while the application is not read.
 */
function navigationOutsideProduction(
  read: ProjectionReads,
  key: { readonly orgId: string; readonly appId: string },
): OutsideProduction | null | undefined {
  if (!read.members(hqAppsScope(key.orgId)).ids.includes(key.appId)) return undefined;
  const { environments, outside } = canonicalAppEnvironments.derive(read, key);
  if (environments === undefined) return undefined;
  return outside === undefined ? null : { address: outside.target.address };
}

/** The statement HQ's navigation holds for an application, as its form compares a write against it. */
export const appOutsideProduction: Projection<
  { readonly orgId: string; readonly appId: string },
  OutsideProduction | null | undefined
> = {
  name: "appOutsideProduction",
  keyOf: ({ orgId, appId }) => `${orgId}/${appId}`,
  derive: navigationOutsideProduction,
  equals: sameValue,
};

/** Whether two statements say the same: both none, or the same address. */
export function sameOutsideProduction(
  a: OutsideProduction | null,
  b: OutsideProduction | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.address === b.address;
}

export const setOutsideProduction: OperationKind<"set-outside-production"> = {
  kind: "set-outside-production",
  executor: "hq",
  reflected: (read, intent) => {
    const held = navigationOutsideProduction(read, intent);
    return held !== undefined && sameOutsideProduction(held, intent.outside);
  },
};
