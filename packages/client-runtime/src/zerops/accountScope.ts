/**
 * Zerops organization scope, shared by web and mobile.
 *
 * Zerops permissions belong to a `clientUser` membership, not to a bare
 * client id. Persisting and switching that exact membership mirrors the
 * platform GUI and keeps role/capability decisions attached to the account
 * row they came from.
 */

import type { ZeropsOrganization } from "./api.ts";
import { canCreateMates } from "./mateAccess.ts";

export interface ZeropsOrganizationSelectionInput {
  /** The client selected by `/authorize-app`; it wins over stale local state. */
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
 * verb on one screen and refused it on the next. Both now call the shared role
 * function, which is also what the Mate's door and the broker run.
 */
export function canCreateProjectsInOrganization(organization: ZeropsOrganization): boolean {
  return canCreateMates(organization);
}

export function zeropsOrganizationRoleLabel(organization: ZeropsOrganization): string {
  switch (organization.roleCode) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Admin";
    case "BASIC_USER":
      return "Basic user";
    case "READ_ONLY":
      return "Read only";
    case "NO_ACCESS":
      return organization.canCreateProjects ? "Developer" : "Guest";
    default:
      return "Member";
  }
}
