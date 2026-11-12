/**
 * Who merges an application's changes, set by an Owner or Admin: the organization's Owner and
 * Admins and the people named, or — `people: null` — whoever may push. HQ's answer is the limit as
 * it stands after, and HQ's navigation is where every surface reads it from then on. HQ keeps no
 * request id for it; a lost answer stays uncertain and nothing is sent again blindly.
 *
 * @module data/operations/hqMergers
 */
import type { HqMergers } from "@t3tools/shared/hqMergers";
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { ProjectionReads } from "../store.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "set-mergers": {
      readonly orgId: string;
      readonly appId: string;
      /** Zerops user ids named beside the organization's Owner and Admins; `null` lifts the limit. */
      readonly people: ReadonlyArray<string> | null;
    };
  }
  interface OperationResults {
    readonly "set-mergers": { readonly mergers: HqMergers | null };
  }
}

/** What a refused write is coded where HQ is older than the setting (`MERGERS_NEED_UPDATE`). */
export const MERGERS_UNSUPPORTED = "mergers_unsupported";

/**
 * The people an application names as HQ's navigation holds it: `null` where it limits nothing,
 * `undefined` while the application is not read.
 */
export function navigationMergers(
  read: ProjectionReads,
  orgId: string,
  appId: string,
): ReadonlyArray<string> | null | undefined {
  const app = read.fact("hqApp", appId);
  if (app.kind !== "known" || !read.members(hqAppsScope(orgId)).ids.includes(appId))
    return undefined;
  return app.value.mergers?.people ?? null;
}

/** Whether two limits name the same people, in any order; `null` is no limit. */
export function sameMergers(
  a: ReadonlyArray<string> | null,
  b: ReadonlyArray<string> | null,
): boolean {
  if (a === null || b === null) return a === b;
  const named = new Set(a);
  return named.size === new Set(b).size && b.every((userId) => named.has(userId));
}

export const setMergers: OperationKind<"set-mergers"> = {
  kind: "set-mergers",
  executor: "hq",
  reflected: (read, intent) => {
    const held = navigationMergers(read, intent.orgId, intent.appId);
    return held !== undefined && sameMergers(held, intent.people);
  },
};
