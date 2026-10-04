/**
 * The person HQ's rule is asked about (`mayOffer`, `@t3tools/client-runtime/zerops`), as the
 * session names them: who they are, and their membership of the organization open now.
 */
import type { OfferViewer } from "@t3tools/client-runtime/zerops";

/** Nobody where the session names nobody, or no organization is open: nothing is then offered. */
export function sessionOfferViewer(
  user: { readonly id: string } | null | undefined,
  organization: {
    readonly membershipId: string;
    readonly roleCode?: string | undefined;
    readonly canCreateProjects?: boolean | undefined;
  } | null,
): OfferViewer | undefined {
  if (user === null || user === undefined || organization === null) return undefined;
  return {
    userId: user.id,
    clientUserId: organization.membershipId,
    roleCode: organization.roleCode,
    canCreateProjects: organization.canCreateProjects,
  };
}
