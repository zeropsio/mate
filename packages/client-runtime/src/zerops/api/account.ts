/** The signed-in account's and its organizations' records as the Zerops REST API returns them:
 * one resource of `../api.ts`'s client. */

import type { ZeropsUserId } from "@t3tools/contracts";
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
