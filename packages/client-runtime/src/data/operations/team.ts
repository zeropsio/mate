/**
 * Who is on an organization's team, at Zerops: a member's membership changed — a preset, or the
 * role and flags *Advanced* sets — and a member taken off — or an invitation withdrawn. Only an organization owner or admin may;
 * an admin never changes an owner or another admin (`zerops/teamRoles.ts`).
 *
 * Each ends with the owner's answer, once the organization's member list and the member's own
 * grants have been read again: the team a page shows never lags a write it reported done.
 *
 * @module data/operations/team
 */
import type { OrgMembership } from "../../zerops/teamRoles.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "set-org-role": {
      readonly orgId: string;
      /** The membership (`clientUser`) id. */
      readonly clientUserId: string;
      /** Their whole membership as it should stand. */
      readonly membership: OrgMembership;
    };
    readonly "remove-member": {
      readonly orgId: string;
      /** The membership (`clientUser`) id: a member's, or an invitation's. */
      readonly clientUserId: string;
    };
  }
  interface OperationResults {
    readonly "set-org-role": { readonly changed: boolean };
    readonly "remove-member": { readonly removed: boolean };
  }
}

/** The owner's answer is the end, given once the team was read again. */
const answered = { executor: "zerops", reflected: () => true } as const;

export const setOrgRole: OperationKind<"set-org-role"> = { kind: "set-org-role", ...answered };
export const removeMember: OperationKind<"remove-member"> = { kind: "remove-member", ...answered };

export const TEAM_KINDS = [setOrgRole, removeMember] as const;
