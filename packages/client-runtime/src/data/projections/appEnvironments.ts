/**
 * An application's stage and production as HQ's navigation says them — tier, deploy key, offers,
 * jobs, birth and release standing — for the surfaces that draw them. Kept as last told through an
 * outage and past a value this build cannot read; gone once HQ removed or withheld the application.
 * HQ's refusal of them to a reader who cannot read the application's changes is said apart, never
 * as an application without environments.
 *
 * @module data/projections/appEnvironments
 */
import { environmentsOf, type HqEnvironment } from "../../zerops/hq/environments.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface AppEnvironmentsRead {
  /** `undefined` until HQ told them the reader may read. */
  readonly environments: ReadonlyArray<HqEnvironment> | undefined;
  /** HQ's reason the reader may not read them, while it says one. */
  readonly refused: string | null;
}

const UNTOLD: AppEnvironmentsRead = { environments: undefined, refused: null };

function environmentsRead(read: ProjectionReads, appId: string): AppEnvironmentsRead {
  const fact = read.fact("hqApp", appId);
  if (fact.kind !== "known") return UNTOLD;
  const { environments } = fact.value;
  if (environments === undefined) return UNTOLD;
  if ("refused" in environments) return { environments: undefined, refused: environments.refused };
  return { environments: environmentsOf(environments), refused: null };
}

export const appEnvironments: Projection<
  { readonly orgId: string; readonly appId: string },
  AppEnvironmentsRead
> = {
  name: "appEnvironments",
  keyOf: ({ orgId, appId }) => `${orgId}/${appId}`,
  derive: (read, { appId }) => environmentsRead(read, appId),
  equals: sameValue,
};

/** Each named application's environments, by its id: what a surface over several reads. */
export const appsEnvironments: Projection<
  { readonly orgId: string; readonly appIds: ReadonlyArray<string> },
  Readonly<Record<string, AppEnvironmentsRead>>
> = {
  name: "appsEnvironments",
  keyOf: ({ orgId, appIds }) => `${orgId}/${appIds.join(",")}`,
  derive: (read, { appIds }) =>
    Object.fromEntries(appIds.map((appId) => [appId, environmentsRead(read, appId)])),
  equals: sameValue,
};
