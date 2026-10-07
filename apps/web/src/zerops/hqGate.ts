/**
 * The organization's HQ in front of the product (ADR 0001): Mate works only in an organization
 * that has one, so the product opens only over its official HQ. An owner or an admin opening an
 * organization without one can choose to set it up (`hqBirth.ts`); anybody else is told whom to
 * ask, and offered nothing more. Settings stand outside it, as does an account still to choose its
 * organization.
 *
 * An outage is no gate: an HQ that does not answer is still the organization's, and the product
 * says since when (`hqStructure.ts`). Which HQ is the official one comes from the verdict this
 * browser keeps; only where it keeps none does the gate wait for the member list (`accountHq.ts`).
 */
import { mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
import { type MembershipFacts, mayBearHq } from "@t3tools/shared/zeropsRoles";

import type { AccountHq } from "./accountHq";
import { useAccountHq } from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";

export type HqGate =
  | { readonly kind: "open" }
  /** The member list has not said yet; `failed` once reading it failed. */
  | { readonly kind: "reading"; readonly failed: boolean }
  /** An owner or an admin, in an organization without HQ: setup is offered. */
  | { readonly kind: "birth" }
  | { readonly kind: "ask"; readonly line: string }
  | { readonly kind: "unclear"; readonly line: string };

/** Why nothing opens over an HQ the member list cannot tell apart from another. */
export const HQ_UNCLEAR =
  "More than one project is marked as this organization's HQ. An owner deletes the wrong mate-hq tokens in Zerops.";

const OPEN: HqGate = { kind: "open" };

export function resolveHqGate(input: {
  /** The organization open in the product; null while none is chosen. */
  readonly organization: { readonly id: string } | null;
  /**
   * The person's membership of it, as the session names it; none where the session names nobody.
   * Whether they bear HQ is Zerops' role alone (`mayBearHq`): there is no HQ yet to ask.
   */
  readonly membership: MembershipFacts | undefined;
  readonly accountHq: Pick<AccountHq, "status" | "hq" | "admins">;
  readonly pathname: string;
}): HqGate {
  const { organization, accountHq } = input;
  if (organization === null || /^\/settings(\/|$)/u.test(input.pathname)) return OPEN;
  // The HQ the member list named last stands while the list is read again.
  if (accountHq.hq.kind === "official") return OPEN;
  if (accountHq.hq.kind === "unclear") return { kind: "unclear", line: HQ_UNCLEAR };
  if (accountHq.status !== "ready") {
    return { kind: "reading", failed: accountHq.status === "failed" };
  }
  if (mayBearHq(input.membership)) return { kind: "birth" };
  const names = accountHq.admins.flatMap((admin) => mateMemberName(admin) ?? []);
  const who = names.length === 0 ? "an owner or admin of the organization" : names.join(" or ");
  return { kind: "ask", line: `An admin sets up Mate for this organization. Ask ${who}.` };
}

/** The gate over the organization open now, with its HQ as this browser keeps it or the member list names it. */
export function useHqGate(pathname: string): {
  readonly gate: HqGate;
  readonly accountHq: AccountHq;
} {
  const { activeOrganization, status, user } = useZeropsSession();
  const organization = status === "signed-in" ? activeOrganization : null;
  const accountHq = useAccountHq(organization?.id);
  const membership = user === null || organization === null ? undefined : organization;
  return { gate: resolveHqGate({ organization, membership, accountHq, pathname }), accountHq };
}
