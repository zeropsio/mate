/**
 * Zerops organization scope, shared by web and mobile.
 *
 * Zerops permissions belong to a `clientUser` membership, not to a bare
 * client id. Persisting and switching that exact membership mirrors the
 * platform GUI and keeps role/capability decisions attached to the account
 * row they came from.
 */

import type { ZeropsOrganization } from "./api.ts";

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

export function canCreateProjectsInOrganization(organization: ZeropsOrganization): boolean {
  return (
    organization.canCreateProjects === true ||
    organization.roleCode === "OWNER" ||
    organization.roleCode === "ADMIN"
  );
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
