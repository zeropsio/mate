/**
 * Zerops organization scope, shared by web and mobile.
 *
 * Zerops permissions belong to a `clientUser` membership, not to a bare
 * client id. Persisting and switching that exact membership mirrors the
 * platform GUI and keeps role/capability decisions attached to the account
 * row they came from.
 */

import { mayCreateProjects } from "@t3tools/shared/zeropsRoles";

import type { ZeropsOrganization } from "./api.ts";

export interface ZeropsOrganizationSelectionInput {
  /** The organization a registration in this client just made; it wins over stale local state. */
  readonly preferredClientId: string | null;
  /** The exact membership remembered by this client. */
  readonly storedClientUserId: string | null;
  /** Backward-compatible fallback for selections saved before clientUserId. */
  readonly storedClientId: string | null;
}

export function resolveActiveZeropsOrganization(
  organizations: ReadonlyArray<ZeropsOrganization>,
  input: ZeropsOrganizationSelectionInput,
): ZeropsOrganization | null {
  if (input.preferredClientId) {
    const preferred = organizations.find(
      (organization) => organization.id === input.preferredClientId,
    );
    if (preferred) return preferred;
  }
  if (input.storedClientUserId) {
    const storedMembership = organizations.find(
      (organization) => organization.membershipId === input.storedClientUserId,
    );
    if (storedMembership) return storedMembership;
  }
  if (input.storedClientId) {
    const storedClient = organizations.find(
      (organization) => organization.id === input.storedClientId,
    );
    if (storedClient) return storedClient;
  }
  return organizations.length === 1 ? (organizations[0] ?? null) : null;
}

/**
 * The app's one *Add Mate* gate (guide 0.8).
 *
 * It used to be written twice — once here and once as a bare
 * `canCreateProjects === true` where the data runtime decided whether an
 * organization takes writes — so an org admin without the flag was offered the
 * verb on one screen and refused it on the next. Both now read Zerops' own flag
 * the one way (`mayCreateProjects`), as the Mate's door does.
 */
export function canCreateProjectsInOrganization(organization: ZeropsOrganization): boolean {
  return mayCreateProjects(organization);
}

export function zeropsOrganizationRoleLabel(organization: ZeropsOrganization): string {
  return zeropsRoleWords(organization) ?? "Member";
}

/**
 * A membership's role in the words the invite and Team use: a preset's name (Owner, Admin,
 * Developer, Guest), or what a Zerops role no preset names reaches. Never a Zerops role code.
 */
export function zeropsRoleWords(membership: {
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
}): string | undefined {
  switch (membership.roleCode) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Admin";
    case "BASIC_USER":
      return "Works on every project";
    case "READ_ONLY":
      return "Sees every project";
    case "NO_ACCESS":
      return membership.canCreateProjects === true ? "Developer" : "Guest";
    default:
      return undefined;
  }
}
