/**
 * Who works on an app, at Zerops: an address checked before it is invited, an invitation with the
 * app's grants on it, and a member's access to the app changed, removed or — an invitation —
 * withdrawn (`zerops/appAccess.ts` plans the grants). Only an organization owner or admin may.
 *
 * Each ends with the owner's answer, once the organization's member list and the app's places
 * have been read again: the people a project page shows never lag a write it reported done.
 *
 * @module data/operations/appAccess
 */
import type { AppAccessChange, AppAccessLevel, AppProjects } from "../../zerops/appAccess.ts";
import type { OperationKind } from "./kind.ts";

/** Who an address is to Zerops, before it is invited. */
export type Invitee =
  | { readonly kind: "existing"; readonly userId: string }
  | { readonly kind: "new"; readonly firstName: string; readonly lastName: string };

/**
 * Who an address is, as checked: an existing account, a new person — or already a member of the
 * organization, whose access to an app is then set rather than an invitation sent.
 */
export type InviteeCheck =
  | { readonly kind: "existing"; readonly userId: string }
  | { readonly kind: "new" }
  | {
      readonly kind: "member";
      /** Their membership (`clientUser`) id. */
      readonly clientUserId: string;
      /** Their Zerops user id, where the member list names it. */
      readonly userId?: string;
      readonly roleCode: string;
    };

declare module "../model.ts" {
  interface OperationIntents {
    readonly "check-invitee": {
      /** The organization, which is also the Zerops client the person is invited to. */
      readonly orgId: string;
      readonly email: string;
    };
    readonly "invite-member": {
      readonly orgId: string;
      readonly email: string;
      readonly invitee: Invitee;
      readonly level: AppAccessLevel;
      /** The app the invitation opens. */
      readonly projects: AppProjects;
    };
    readonly "set-app-access": {
      readonly orgId: string;
      /** The membership (`clientUser`) id. */
      readonly clientUserId: string;
      readonly change: AppAccessChange;
      readonly projects: AppProjects;
      /** The app's Mates this member owns, as HQ names their owners: never touched. */
      readonly owned: ReadonlyArray<string>;
    };
  }
  interface OperationResults {
    readonly "check-invitee": InviteeCheck;
    readonly "invite-member": { readonly clientUserId: string };
    readonly "set-app-access": { readonly membershipEnded: boolean };
  }
}

/** The owner's answer is the end, given once the shown people were read again. */
const answered = { executor: "zerops", reflected: () => true } as const;

export const checkInvitee: OperationKind<"check-invitee"> = { kind: "check-invitee", ...answered };
export const inviteMember: OperationKind<"invite-member"> = { kind: "invite-member", ...answered };
export const setAppAccess: OperationKind<"set-app-access"> = {
  kind: "set-app-access",
  ...answered,
};

export const APP_ACCESS_KINDS = [checkInvitee, inviteMember, setAppAccess] as const;
