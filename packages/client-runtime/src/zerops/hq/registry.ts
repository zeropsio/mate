/**
 * The account's registry — which applications exist and which projects are in them — as HQ
 * holds it (ADR 0002). HQ is its only writer; the client reads it through HQ's door
 * (`GET /api/structure`, filtered to what the reader sees in Zerops) and writes it through
 * `POST /api/apps` and `POST /api/apps/{id}/projects`.
 *
 * An application is a group: its HQ id is the group's id.
 *
 * Pure: no network (rule R1).
 *
 * @module hq/registry
 */
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import type { HqStructure } from "./client.ts";

const PROJECT_KINDS: ReadonlySet<string> = new Set<RoleProjectKind>([
  "mate",
  "stage",
  "production",
]);

export interface ZeropsRegistryProject {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
}

export interface ZeropsRegistryGroup {
  readonly groupId: string;
  readonly name: string;
  /**
   * The Gitea org the remaining Gitea reads key a group by. HQ names no Gitea org, so it is the
   * group's id: no Gitea answers for it, until the Git page reads HQ (T11).
   */
  readonly slug: string;
  readonly projects: ReadonlyArray<ZeropsRegistryProject>;
}

export interface ZeropsRegistry {
  readonly groups: ReadonlyArray<ZeropsRegistryGroup>;
}

export const EMPTY_REGISTRY: ZeropsRegistry = { groups: [] };

export function registryFromHq(structure: HqStructure): ZeropsRegistry {
  return {
    groups: structure.apps.map((app) => ({
      groupId: app.id,
      name: app.name,
      slug: app.id,
      projects: app.projects.flatMap((project) =>
        PROJECT_KINDS.has(project.kind)
          ? [{ projectId: project.projectId, kind: project.kind as RoleProjectKind }]
          : [],
      ),
    })),
  };
}
