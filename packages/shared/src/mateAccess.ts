/**
 * Who a Mate's project lets in: the door's rule over the org's member list and the project's own
 * roles, computed one way wherever it is computed — by a Mate over its own read, and by HQ, which
 * relays it down the Mate's link (`access`, `mateLink.ts`). The same `zeropsRoles` function over
 * every row the member list carries, an integration token's among them: what HQ relays is what the
 * Mate's own read would admit.
 *
 * Pure: no clock, no network.
 *
 * @module mateAccess
 */
import * as Schema from "effect/Schema";

import {
  asOrgRole,
  effectiveProjectRole,
  type RoleMateVisibility,
  type ZeropsOrgRole,
  zeropsRoleAnswer,
} from "./zeropsRoles.ts";

export interface ZeropsOrgMember {
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly clientUserId: string;
  readonly userId: string;
  readonly orgRole: string;
  readonly status: string;
  readonly canCreateProjects: boolean;
}

/** Every usable row of a member-list body, in the order the platform sent them. */
export function readOrgMembers(entries: ReadonlyArray<unknown>): ReadonlyArray<ZeropsOrgMember> {
  const members: Array<ZeropsOrgMember> = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const userId = record["userId"];
    if (typeof userId !== "string" || userId.length === 0) continue;
    members.push({
      clientUserId: typeof record["id"] === "string" ? record["id"] : "",
      userId,
      orgRole: typeof record["roleCode"] === "string" ? record["roleCode"] : "",
      status: typeof record["status"] === "string" ? record["status"] : "",
      canCreateProjects: record["canCreateProjects"] === true,
    });
  }
  return members;
}

export interface ProjectRoles {
  readonly clientId: string;
  /** `clientUserId` → the role this project gives them. */
  readonly overrides: Readonly<Record<string, string>>;
}

/** The two fields of a project read the rule needs, or `null` if neither is there. */
export function readProjectRoles(body: unknown): ProjectRoles | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const clientId = record["clientId"];
  if (typeof clientId !== "string" || clientId.length === 0) return null;
  const overrides: Record<string, string> = {};
  const userRoles = record["userRoles"];
  if (Array.isArray(userRoles)) {
    for (const entry of userRoles) {
      if (typeof entry !== "object" || entry === null) continue;
      const row = entry as Record<string, unknown>;
      if (typeof row["clientUserId"] === "string" && typeof row["roleCode"] === "string") {
        overrides[row["clientUserId"]] = row["roleCode"];
      }
    }
  }
  return { clientId, overrides };
}

/**
 * The effective role and the visibility it earns, from the shared role function. The registry
 * handed in is this one project: the door decides about itself and nothing else, and
 * `zeropsRoleAnswer` answers for every Mate in whatever registry it is given. A role neither side
 * recognises is not a role: it reads as `NO_ACCESS`, so an override the platform grew that this
 * build has never heard of shuts the door rather than opening it.
 */
export function resolveDoorVisibility(input: {
  readonly projectId: string;
  readonly member: ZeropsOrgMember;
  readonly override: string | undefined;
}): { readonly role: ZeropsOrgRole; readonly visibility: RoleMateVisibility } {
  const roleInput = {
    person: {
      id: input.member.userId,
      orgRole: asOrgRole(input.member.orgRole),
      status: input.member.status,
      canCreateProjects: input.member.canCreateProjects,
    },
    overrides: input.override === undefined ? {} : { [input.projectId]: asOrgRole(input.override) },
    registry: {
      groups: [
        {
          id: input.projectId,
          slug: input.projectId,
          projects: [{ id: input.projectId, kind: "mate" as const }],
        },
      ],
    },
  };
  return {
    role: effectiveProjectRole(roleInput, input.projectId),
    visibility: zeropsRoleAnswer(roleInput).mates[input.projectId] ?? "hidden",
  };
}

/** One member the project lets in: open, or listed (the door refuses them as read-only). */
export const MateAccessMember = Schema.Struct({
  userId: Schema.String,
  role: Schema.Literals(["NO_ACCESS", "READ_ONLY", "BASIC_USER", "ADMIN", "OWNER"]),
  visibility: Schema.Literals(["open", "listed"]),
});
export type MateAccessMember = typeof MateAccessMember.Type;

/**
 * Every member the project `projectId` opens for or lists, in the member list's order: the door's
 * rule over each row that names somebody, with the project's override of that row's member.
 */
export function projectAccess(input: {
  readonly projectId: string;
  readonly members: ReadonlyArray<ZeropsOrgMember>;
  readonly overrides: Readonly<Record<string, string>>;
}): ReadonlyArray<MateAccessMember> {
  const access: Array<MateAccessMember> = [];
  for (const member of input.members) {
    if (member.userId.length === 0) continue;
    const override =
      member.clientUserId.length === 0 ? undefined : input.overrides[member.clientUserId];
    const { role, visibility } = resolveDoorVisibility({
      projectId: input.projectId,
      member,
      override,
    });
    if (visibility !== "hidden") access.push({ userId: member.userId, role, visibility });
  }
  return access;
}

/** Every user the project `projectId` opens for: what keeps a session open in its Mate. */
export function opensForOf(
  projectId: string,
  project: ProjectRoles,
  entries: ReadonlyArray<unknown>,
): ReadonlySet<string> {
  return new Set(
    projectAccess({ projectId, members: readOrgMembers(entries), overrides: project.overrides })
      .filter((member) => member.visibility === "open")
      .map((member) => member.userId),
  );
}
