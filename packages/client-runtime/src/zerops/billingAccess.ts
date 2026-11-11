/**
 * Who reads an organization's billing in Mate: its owners and admins, the members with access to
 * everything (the owner, 2026-11-11: "only people with access to everything (owner, admin) should
 * see this … others shouldn't even have the billing page"). Everyone else is offered no billing
 * page, no balance and no credit line — whatever finance flags Zerops gives them.
 *
 * @module zerops/billingAccess
 */

/** Whether a member with this organization role reads its billing. */
export function mayReadBilling(roleCode: string | undefined): boolean {
  return roleCode === "OWNER" || roleCode === "ADMIN";
}
