/** The signed-in account's and its organizations' records as the Zerops REST API returns them,
 * and the reads of an organization's members: one resource of `../api.ts`'s client. */

import type { ZeropsUserId } from "@t3tools/contracts";
import { ZeropsApiError } from "../errors.ts";
import type { ZeropsDoor } from "../api.ts";
import type { ZeropsApp } from "../app.ts";

export interface ZeropsClientMembership {
  readonly id: string;
  readonly clientId?: string;
  readonly userId?: string;
  readonly status?: string;
  readonly roleCode?: string;
  /** Independent capability flags; never infer these from NO_ACCESS. */
  readonly canCreateProjects?: boolean;
  readonly canViewFinances?: boolean;
  readonly canEditFinances?: boolean;
  readonly client?: {
    readonly id?: string;
    readonly accountName?: string;
    readonly companyName?: string;
  };
}

/** The account's picture, as `GET /user/info` returns it; every URL may be null. */
export interface ZeropsUserAvatar {
  readonly smallAvatarUrl?: string | null;
  readonly largeAvatarUrl?: string | null;
  readonly externalAvatarUrl?: string | null;
}

export interface ZeropsUser {
  readonly id: ZeropsUserId;
  readonly email: string;
  readonly fullName?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly avatar?: ZeropsUserAvatar | null;
  /** The app the account was made in, fixed for good; null for accounts made before Zerops kept it. */
  readonly createdByApp?: ZeropsApp | null;
  readonly clientUserList?: ReadonlyArray<ZeropsClientMembership>;
}

/** One organization the signed-in account belongs to. */
export interface ZeropsOrganization {
  readonly id: string;
  readonly name: string;
  readonly membershipId: string;
  readonly roleCode?: string;
  readonly canCreateProjects?: boolean;
  readonly canViewFinances?: boolean;
  readonly canEditFinances?: boolean;
}

export interface ZeropsLocation {
  readonly id: string;
  readonly name: string;
  readonly pingUrl: string;
}

/**
 * One row of `GET /client/{org}/user/list`. Open about what it does not
 * promise: the platform names a person in more than one place, and a member
 * with none of them is shown by their e-mail rather than by a blank.
 */
export interface ZeropsOrganizationMember {
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly id: string;
  readonly userId?: string;
  readonly status?: string;
  readonly roleCode?: string;
  readonly canCreateProjects?: boolean;
  /** Only an owner sets the two finance flags (`zerops/teamRoles.ts`). */
  readonly canViewFinances?: boolean;
  readonly canEditFinances?: boolean;
  readonly user?: {
    readonly id?: string;
    readonly fullName?: string;
    readonly firstName?: string;
    readonly lastName?: string;
    readonly email?: string;
    /** The same record `GET /user/info` carries; the official app draws members with it. */
    readonly avatar?: ZeropsUserAvatar | null;
    readonly createdByApp?: ZeropsApp | null;
  };
}

/** An organization that invited the account, and the account has not yet accepted. */
export interface ZeropsOrganizationInvitation {
  readonly id: string;
  readonly name: string;
}

/**
 * `POST /client/{id}/user/validate` — who an address is to the organization before it is
 * invited: an existing Zerops account (its user id) or a new one. Changes nothing. An address
 * already a member, or invited, is refused `userAlreadyConnectedToCompany`; anyone but an owner
 * or an admin is refused 403 (measured 2026-10-14).
 */
export async function validateOrganizationUser(
  door: ZeropsDoor,
  clientId: string,
  email: string,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly kind: "existing"; readonly userId: string } | { readonly kind: "new" }> {
  try {
    const answer = await door<{ readonly id?: unknown }>(
      `/client/${clientId}/user/validate`,
      { method: "POST", body: JSON.stringify({ email }) },
      {
        operationKind: "read",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
    if (typeof answer.id !== "string" || answer.id.length === 0)
      throw new ZeropsApiError("Zerops didn't say whose that address is.", "unexpected");
    return { kind: "existing", userId: answer.id };
  } catch (cause) {
    if (cause instanceof ZeropsApiError && cause.code === "userAccountNotFound")
      return { kind: "new" };
    throw cause;
  }
}

/**
 * `GET /client/{id}/user/list` — the org's members, so a Mate a person
 * cannot open can still say **whose** it is.
 *
 * Any token of the org may read it, integration tokens included (measured
 * 2026-09-15). What comes back is metadata — names, e-mails, roles — and
 * never a credential.
 */
export async function listOrganizationMembers(
  door: ZeropsDoor,
  clientId: string,
  signal?: AbortSignal,
): Promise<ReadonlyArray<ZeropsOrganizationMember>> {
  // `clientUserList`, not `items` — the member list is its own shape (measured 2026-09-18).
  const body = await door<{
    readonly clientUserList?: ReadonlyArray<ZeropsOrganizationMember>;
    readonly items?: ReadonlyArray<ZeropsOrganizationMember>;
    readonly list?: ReadonlyArray<ZeropsOrganizationMember>;
  }>(`/client/${clientId}/user/list?limit=100`, { signal: signal ?? null });
  return body.clientUserList ?? body.items ?? body.list ?? [];
}
