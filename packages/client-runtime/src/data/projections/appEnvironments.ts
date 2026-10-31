/**
 * An application's stage and production as HQ's navigation says them — tier, deploy key, offers,
 * jobs, birth and release standing, and its recent rollouts — for the surfaces that draw them. Kept as last told through an
 * outage and past a value this build cannot read; gone once HQ removed or withheld the application.
 * HQ's refusal of them to a reader who cannot read the application's changes is said apart, never
 * as an application without environments.
 *
 * @module data/projections/appEnvironments
 */
import type { HqEnvironmentId } from "@t3tools/contracts";
import type { HqNavigationRollout } from "@t3tools/shared/hqStream";
import {
  readDeliveryEnvironments,
  type UnreadEnvironment,
  zeropsEnvironments,
  type CanonicalHqEnvironment,
  type HqDeliveryEnvironment,
  type HqEnvironment,
} from "../../zerops/hq/environments.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface AppEnvironmentsRead {
  /** `undefined` until HQ told them the reader may read. */
  readonly environments: ReadonlyArray<HqEnvironment> | undefined;
  /** HQ's reason the reader may not read them, while it says one. */
  readonly refused: string | null;
  /** Environments HQ sent that this build cannot read: present, never an application without them. */
  readonly unread: ReadonlyArray<UnreadEnvironment>;
  /** Its recent rollouts, with the environments; absent from an older HQ. */
  readonly rollouts?: ReadonlyArray<HqNavigationRollout>;
}

export interface CanonicalAppEnvironmentsRead extends Omit<AppEnvironmentsRead, "environments"> {
  readonly environments: ReadonlyArray<HqDeliveryEnvironment> | undefined;
}

const UNTOLD: CanonicalAppEnvironmentsRead = {
  environments: undefined,
  refused: null,
  unread: [],
};

function environmentsRead(read: ProjectionReads, appId: string): CanonicalAppEnvironmentsRead {
  const fact = read.fact("hqApp", appId);
  if (fact.kind !== "known") return UNTOLD;
  const { environments, rollouts } = fact.value;
  if (environments === undefined) return UNTOLD;
  if ("refused" in environments)
    return { environments: undefined, refused: environments.refused, unread: [] };
  const sent = Array.isArray(environments) ? readDeliveryEnvironments(environments) : undefined;
  return {
    environments: sent?.environments,
    refused: null,
    unread: sent?.unread ?? [],
    ...(rollouts === undefined ? {} : { rollouts }),
  };
}

export const canonicalAppEnvironments: Projection<
  { readonly orgId: string; readonly appId: string },
  CanonicalAppEnvironmentsRead
> = {
  name: "canonicalAppEnvironments",
  keyOf: ({ orgId, appId }) => `${orgId}/${appId}`,
  derive: (read, { appId }) => environmentsRead(read, appId),
  equals: sameValue,
};

const compatibilityRead = (answer: CanonicalAppEnvironmentsRead): AppEnvironmentsRead => ({
  ...answer,
  environments:
    answer.environments === undefined
      ? undefined
      : zeropsEnvironments(
          answer.environments.filter(
            (environment): environment is CanonicalHqEnvironment =>
              environment.target.kind === "zerops",
          ),
        ),
});

/** Each named application's environments, by its id: what a surface over several reads. */
export const appsEnvironments: Projection<
  { readonly orgId: string; readonly appIds: ReadonlyArray<string> },
  Readonly<Record<string, AppEnvironmentsRead>>
> = {
  name: "appsEnvironments",
  keyOf: ({ orgId, appIds }) => `${orgId}/${appIds.join(",")}`,
  derive: (read, { appIds }) =>
    Object.fromEntries(
      appIds.map((appId) => [appId, compatibilityRead(environmentsRead(read, appId))]),
    ),
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
    canonicalAppEnvironments
      .derive(read, key)
      .environments?.find((environment) => environment.id === key.id),
};
