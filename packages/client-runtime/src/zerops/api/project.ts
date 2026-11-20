import type { ZeropsDoor } from "../api.ts";
import type { HqPlacement } from "../hq/placement.ts";

/** A project's record as the Zerops REST API returns it, and the call that starts a stopped
 * project: one resource of `../api.ts`'s client. */

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
