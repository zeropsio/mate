/**
 * Environments missing their final setup, from the account's project and HQ navigation facts.
 * Unread or refused environments make no claim of missing setup. A creation HQ still holds is
 * its own to finish; elapsed time never ends that hold here.
 *
 * @module data/projections/environmentSetup
 */
import { hqOffer } from "@t3tools/shared/hqOffers";

import {
  halfMadeGroupEnvironments,
  type HalfMadeGroupEnvironment,
} from "../../zerops/groupEnvironments.ts";
import { placementsOf } from "../../zerops/hq/placement.ts";
import { registryFromHq } from "../../zerops/hq/registry.ts";
import type { Projection } from "../store.ts";
import { appsEnvironments } from "./appEnvironments.ts";
import { sameValue } from "./equal.ts";
import { hqNavigation } from "./hqNavigation.ts";

export const environmentSetup: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  ReadonlyArray<HalfMadeGroupEnvironment & { readonly finish: boolean }>
> = {
  name: "environmentSetup",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  equals: sameValue,
  derive: (read, { orgId, projectIds }) => {
    const navigation = hqNavigation.derive(read, orgId);
    const { structure } = navigation;
    if (structure === null || !navigation.live) return [];
    const placement = placementsOf(structure, new Map(), new Map(), navigation.presses);
    const projects = projectIds.flatMap((projectId) => {
      const project = read.fact("project", projectId);
      return project.kind === "known" ? [{ ...project.value, hq: placement.get(projectId) }] : [];
    });
    const told = appsEnvironments.derive(read, {
      orgId,
      appIds: structure.apps.map(({ id }) => id),
    });
    const environments = new Map(
      Object.entries(told).flatMap(([id, { environments }]) =>
        environments === undefined ? [] : [[id, environments] as const],
      ),
    );
    const byProject = new Map(
      [...environments.values()].flat().map((environment) => [environment.projectId, environment]),
    );
    return halfMadeGroupEnvironments({
      projects,
      registry: registryFromHq(structure),
      environments,
      mayKey: (projectId) =>
        hqOffer(byProject.get(projectId)?.can, "keep_deploy_token", {
          current: true,
          unavailableSince: null,
        }).kind === "allowed",
      pressing: (projectId) => Object.hasOwn(navigation.presses, projectId),
    }).map((entry) => {
      const project = read.fact("placement", entry.projectId);
      return {
        ...entry,
        finish:
          hqOffer(project.kind === "known" ? project.value.can : undefined, "finish", {
            current: navigation.live,
            unavailableSince: null,
          }).kind === "allowed",
      };
    });
  },
};
