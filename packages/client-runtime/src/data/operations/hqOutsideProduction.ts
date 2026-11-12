/**
 * A production deployed outside Mate, said by an Owner or Admin: the application's `main` goes
 * live on every merge, at an address or at none given, or — `outside: null` — nobody says so any
 * more. It is a statement HQ keeps, never a deploy it saw. HQ's answer is the statement as it
 * stands after, and HQ's navigation is where every surface reads it from then on. HQ keeps no
 * request id for it; a lost answer stays uncertain and nothing is sent again blindly.
 *
 * @module data/operations/hqOutsideProduction
 */
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { ProjectionReads } from "../store.ts";
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
 * The statement as HQ's navigation holds it for an application: `null` where nobody made it,
 * `undefined` while the application is not read.
 */
export function navigationOutsideProduction(
  read: ProjectionReads,
  orgId: string,
  appId: string,
): OutsideProduction | null | undefined {
  const app = read.fact("hqApp", appId);
  if (app.kind !== "known" || !read.members(hqAppsScope(orgId)).ids.includes(appId))
    return undefined;
  const said = app.value.outsideProduction;
  return said == null ? null : { address: said.address };
}

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
    const held = navigationOutsideProduction(read, intent.orgId, intent.appId);
    return held !== undefined && sameOutsideProduction(held, intent.outside);
  },
};
