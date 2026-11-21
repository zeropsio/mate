/**
 * Who works on an app, at Zerops: an address checked before it is invited, and a project just
 * made given the people its creator chose. Access changes themselves are HQ's operations.
 *
 * Each ends with the owner's answer, once the organization's member list and the project have
 * been read again: the people a project page shows never lag a write it reported done.
 *
 * @module data/operations/appAccess
 */
import type { ProjectGrant } from "../../zerops/projectAccess.ts";
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
    readonly "grant-new-project-access": {
      readonly orgId: string;
      /** A project just made from an import document, whose people its creator chose. */
      readonly projectId: string;
      readonly userRoles: ReadonlyArray<ProjectGrant>;
    };
  }
  interface OperationResults {
    readonly "check-invitee": InviteeCheck;
    readonly "grant-new-project-access": { readonly projectId: string };
  }
}

/** The owner's answer is the end, given once the shown people were read again. */
const answered = { executor: "zerops", reflected: () => true } as const;

const checkInvitee: OperationKind<"check-invitee"> = { kind: "check-invitee", ...answered };
const grantNewProjectAccess: OperationKind<"grant-new-project-access"> = {
  kind: "grant-new-project-access",
  ...answered,
};

export const APP_ACCESS_KINDS = [checkInvitee, grantNewProjectAccess] as const;
