import { ZeropsApiError } from "../errors.ts";
import type { ZeropsDoor } from "../api.ts";
import type { HqPlacement } from "../hq/placement.ts";
import type { ZeropsServiceImportResult } from "./service.ts";

/** A project's record as the Zerops REST API returns it, and the calls that create, import,
 * fill, start and delete a project: one resource of `../api.ts`'s client. */

export interface ZeropsProject {
  readonly userRoles?: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>;
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly clientId?: string;
  readonly created?: string;
  readonly publicZone?: string;
  readonly zeropsSubdomainHost?: string;
  readonly mode?: string;
  /**
   * The project's tags. Carries this product's group membership and
   * environment role (`groups.ts`) alongside whatever the user tagged the
   * project with themselves.
   *
   * Optional because a caller may be holding a project this client wrote by
   * hand in a test, not because the platform omits it: measured 2026-09-05,
   * all three read paths — `GET /client/{id}/project`, `POST /project/search`
   * and `GET /project/{id}` — return it.
   */
  readonly tagList?: ReadonlyArray<string>;
  /**
   * Where the organization's HQ places this project (ADR 0002): its application, its kind, its
   * Mate's face. Not a platform field: the client joins it from HQ's structure where
   * projects enter the screen (`placeProjects`), and it is absent while that structure is unknown
   * or places no such project.
   */
  readonly hq?: HqPlacement;
  /** Round-tripped by every project write, which must not blank it. */
  readonly description?: string;
  /**
   * Round-tripped by every record write (`writeProject`). `PUT
   * /project/{id}` replaces the record, so a tag write that omitted these two
   * would quietly take a shared IPv4 away or reset somebody's credit limit on
   * any project.
   */
  readonly publicIpV4Shared?: boolean;
  readonly maxCreditLimit?: number | null;
  /** The project's own IPv4 (the paid add-on); `null` once it has none, as Zerops says it. */
  readonly publicIpV4?: string | null;
  /** The project's own IPv6: every project has one (read 2026-10-14). */
  readonly publicIpV6?: string;
}

/**
 * `PUT /project/{id}/start` with the user's own token — starts every
 * STOPPED service in a STOPPED project.
 */
export async function startProject(
  door: ZeropsDoor,
  projectId: string,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/project/${projectId}/start`,
    { method: "PUT" },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/**
 * Imports a group's recipe into an existing project — the step that turns an
 * empty environment into the group's application.
 *
 * The YAML must carry `services:` and must NOT carry a `project:` block; the
 * platform rejects one outright (`projectImportProjectIncluded`, measured
 * 2026-09-05). `recipeServicesYaml` in `recipeStore.ts` is the transform from
 * a published recipe to what this accepts.
 *
 * Nothing here reaches into a container: the recipe comes from the store and
 * the import is a platform call with the user's own token, so creating an
 * environment never depends on another environment being alive.
 */
export function importServicesIntoProject(
  door: ZeropsDoor,
  projectId: string,
  servicesYaml: string,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<ZeropsServiceImportResult> {
  return door<ZeropsServiceImportResult>(
    `/project/${projectId}/service-stack/import`,
    {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify({ yaml: servicesYaml }),
    },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/**
 * `DELETE /project/{id}` — takes a project off the account. The platform
 * answers with the deleting process and the project is gone shortly after
 * (measured 2026-09-16). What the product deletes through this is a project
 * whose creation the platform itself failed — the half that was built — and
 * a Mate its person deletes, its environment whole.
 */
export async function deleteProject(
  door: ZeropsDoor,
  projectId: string,
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string }> {
  const response = await door<{ readonly id?: unknown }>(
    `/project/${projectId}`,
    { method: "DELETE", signal: signal ?? null },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
  if (typeof response.id !== "string" || response.id.length === 0)
    throw new ZeropsApiError(
      "Zerops accepted the deletion but did not return its process, so it cannot be followed.",
      "uncertain",
    );
  return { processId: response.id };
}
