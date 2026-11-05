/**
 * Environments missing their final setup, from the account's project and HQ navigation facts.
 * Unread environments make no claim of missing setup. A creation HQ still holds is
 * its own to finish; elapsed time never ends that hold here.
 *
 * @module data/projections/environmentSetup
 */
import { type HqOffers, hqOffer } from "@t3tools/shared/hqOffers";

import {
  halfMadeGroupEnvironments,
  type HalfMadeGroupEnvironment,
} from "../../zerops/groupEnvironments.ts";
import { zeropsStructure } from "../../zerops/hq/structure.ts";
import { placementsOf } from "../../zerops/hq/placement.ts";
import { registryFromHq } from "../../zerops/hq/registry.ts";
import type { Projection } from "../store.ts";
import { canonicalAppEnvironments } from "./appEnvironments.ts";
import { sameValue } from "./equal.ts";
import { canonicalHqNavigation } from "./hqNavigation.ts";

export const environmentSetup: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  ReadonlyArray<HalfMadeGroupEnvironment & { readonly finish: boolean }>
> = {
  name: "environmentSetup",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  equals: sameValue,
  derive: (read, { orgId, projectIds }) => {
    const navigation = canonicalHqNavigation.derive(read, orgId);
    const { structure } = navigation;
    if (structure === null || !navigation.live) return [];
    const placement = placementsOf(
      zeropsStructure(structure),
      new Map(),
      new Map(),
      navigation.presses,
    );
    const projects = projectIds.flatMap((projectId) => {
      const project = read.fact("project", projectId);
      return project.kind === "known" ? [{ ...project.value, hq: placement.get(projectId) }] : [];
    });
    const environments = new Map(
      structure.apps.flatMap(({ id }) => {
        const { environments } = canonicalAppEnvironments.derive(read, { orgId, appId: id });
        return environments === undefined
          ? []
          : [
              [
                id,
                environments.flatMap(({ target, ...environment }) =>
                  target.kind === "zerops" ? [{ ...environment, projectId: target.projectId }] : [],
                ),
              ] as const,
            ];
      }),
    );
    // What the person may do with each, as the structure decides it from their live roles.
    const environmentCan = new Map<string, HqOffers | undefined>(
      structure.apps.flatMap(({ environments: told }) =>
        (told ?? []).flatMap((environment) =>
          environment.target.kind === "zerops"
            ? [[environment.target.projectId, environment.can] as const]
            : [],
        ),
      ),
    );
    const projectCan = new Map(
      structure.apps.flatMap(({ projects: placed }) =>
        placed.map((project) => [project.projectId, project.can] as const),
      ),
    );
    const birthProjects = new Set(
      structure.apps.flatMap(({ births }) =>
        (births ?? []).flatMap(({ projectId }) => (projectId == null ? [] : [projectId])),
      ),
    );
    return halfMadeGroupEnvironments({
      projects,
      registry: registryFromHq(structure),
      environments,
      mayKey: (projectId) =>
        hqOffer(environmentCan.get(projectId), "keep_deploy_token", {
          current: true,
          unavailableSince: null,
        }).kind === "allowed",
      pressing: (projectId) =>
        birthProjects.has(projectId) || Object.hasOwn(navigation.presses, projectId),
    }).map((entry) => ({
      ...entry,
      finish:
        hqOffer(projectCan.get(entry.projectId), "finish", {
          current: navigation.live,
          unavailableSince: null,
        }).kind === "allowed",
    }));
  },
};
