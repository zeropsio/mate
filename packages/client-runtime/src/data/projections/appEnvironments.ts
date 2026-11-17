/**
 * An application's stage and production as HQ's navigation says them — tier, deploy key, jobs,
 * birth and release standing, and its recent rollouts — for the surfaces that draw them. Kept as
 * last told through an outage and past a value this build cannot read; gone once HQ removed the
 * application.
 *
 * @module data/projections/appEnvironments
 */
import type { HqEnvironmentId } from "@t3tools/contracts";
import type { HqOutsideEnvironment } from "@t3tools/shared/hqEnvironment";
import type { HqNavigationRollout } from "@t3tools/shared/hqStream";
import {
  readDeliveryEnvironments,
  type UnreadEnvironment,
  type HqDeliveryEnvironment,
} from "../../zerops/hq/environments.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface AppEnvironmentsRead {
  /** `undefined` until HQ told them. */
  readonly environments: ReadonlyArray<HqDeliveryEnvironment> | undefined;
  /** Environments HQ sent that this build cannot read: present, never an application without them. */
  readonly unread: ReadonlyArray<UnreadEnvironment>;
  /** Its recent rollouts, with the environments. */
  readonly rollouts?: ReadonlyArray<HqNavigationRollout>;
  /** Its production where it is deployed outside Mate; absent where none stands, or while untold. */
  readonly outside?: HqOutsideEnvironment;
}

const UNTOLD: AppEnvironmentsRead = {
  environments: undefined,
  unread: [],
};

function environmentsRead(read: ProjectionReads, appId: string): AppEnvironmentsRead {
  const fact = read.fact("hqApp", appId);
  if (fact.kind !== "known") return UNTOLD;
  const { environments, rollouts } = fact.value;
  if (environments === undefined) return UNTOLD;
  const sent = readDeliveryEnvironments(environments);
  return {
    environments: sent.environments,
    unread: sent.unread,
    ...(sent.outside === undefined ? {} : { outside: sent.outside }),
    ...(rollouts === undefined ? {} : { rollouts }),
  };
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

/** A route resolves an environment under its application, never a project by this id. */
export const environmentById: Projection<
  { readonly orgId: string; readonly appId: string; readonly id: HqEnvironmentId },
  HqDeliveryEnvironment | undefined
> = {
  name: "environmentById",
  keyOf: ({ orgId, appId, id }) => `${orgId}/${appId}/${id}`,
  equals: sameValue,
  derive: (read, key) =>
    appEnvironments
      .derive(read, key)
      .environments?.find((environment) => environment.id === key.id),
};
