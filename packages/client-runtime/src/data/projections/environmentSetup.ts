/**
 * Environments missing their final setup, from the account's project and HQ navigation facts.
 * Unread environments make no claim of missing setup. An application whose environment operation
 * stands open finishes it itself; a birth HQ holds is its Mate's own.
 *
 * @module data/projections/environmentSetup
 */
import { type HqOffers, hqOffer } from "@t3tools/shared/hqOffers";

import {
  halfMadeGroupEnvironments,
  type HalfMadeGroupEnvironment,
} from "../../zerops/groupEnvironments.ts";
import type { HqOperation } from "../../zerops/hq/client.ts";
import { placementsOf } from "../../zerops/hq/placement.ts";
import { registryFromHq } from "../../zerops/hq/registry.ts";
import type { Projection } from "../store.ts";
import { appEnvironments } from "./appEnvironments.ts";
import { sameValue } from "./equal.ts";
import { hqNavigation } from "./hqNavigation.ts";
import { hqOperationOf } from "./hqOperation.ts";

/** The kinds HQ runs an environment's setup as (`mate-hq` _Environments are operations_). */
const ENVIRONMENT_KINDS = ["environment", "deploy_key", "put_live"] as const;

/** Whether `operation` sets an environment up and stands open: running, or waiting for its maker. */
function openEnvironmentOperation(operation: HqOperation | undefined): boolean {
  return ENVIRONMENT_KINDS.some((kind) => {
    const standing = hqOperationOf(operation, kind).kind;
    return standing === "going" || standing === "waiting";
  });
}

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
    if (structure === null) return [];
    const placement = placementsOf(structure);
    const projects = projectIds.flatMap((projectId) => {
      const project = read.fact("project", projectId);
      return project.kind === "known" ? [{ ...project.value, hq: placement.get(projectId) }] : [];
    });
    const environments = new Map(
      structure.apps.flatMap(({ id }) => {
        const { environments } = appEnvironments.derive(read, { orgId, appId: id });
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
    const operations = new Map(structure.apps.map((app) => [app.id, app.operation] as const));
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
        hqOffer(environmentCan.get(projectId), "keep_deploy_token").kind === "allowed",
      born: (projectId) => birthProjects.has(projectId),
      operating: (appId) => openEnvironmentOperation(operations.get(appId)),
    }).map((entry) => ({
      ...entry,
      finish: hqOffer(projectCan.get(entry.projectId), "finish").kind === "allowed",
    }));
  },
};
