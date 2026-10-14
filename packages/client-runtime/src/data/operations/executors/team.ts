/**
 * Who is on an organization's team, at Zerops (`operations/team.ts`): a member's membership set —
 * a role and its three flags (`PUT /client-user/{id}`), a member taken off or an invitation withdrawn
 * (`DELETE /client-user/{id}`). The member's project grants are never touched by a role change.
 *
 * Each starts from the member list read now: someone gone is said so, and a change Zerops would
 * refuse the viewer is refused in words before it is sent. Zerops keeps no request ids, so a write
 * whose answer was lost is proven only by reading the list again, and never sent again; anything
 * the read cannot prove is the person's to check. Once written, the member list and the member's
 * own grants are read again (`readBack`) before the answer is given.
 *
 * @module data/operations/executors/team
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ZeropsApiClient, ZeropsOrganizationMember } from "../../../zerops/api.ts";
import { membershipOf, sameMembership, teamChangeRefusal } from "../../../zerops/teamRoles.ts";
import type { OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OwnerUnobservable, UncertainAcceptance } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { refusedInWords, verb } from "./write.ts";

export type TeamPlatform = Pick<
  ZeropsApiClient,
  "listOrganizationMembers" | "updateOrganizationMember" | "removeOrganizationMember"
>;

/** Reads the member list and this member's grants again; settles however the reads end. */
export type TeamReadBack = (orgId: string, clientUserId: string) => Promise<void>;

const FORBIDDEN = "Only an organization owner or admin can change the team.";
const GONE = "They're no longer in this organization.";

type Fault = StreamFault | UncertainAcceptance;

/** Zerops refusing the viewer, in the words of who may; any other refusal in Zerops's own. */
const inWords = (fault: Fault): Fault => refusedInWords(fault, FORBIDDEN);

const refused = (message: string) =>
  Effect.fail<StreamFault>({ outcome: "definitive-refusal", message });

const unobservable = (nextAction: string): OwnerUnobservable => ({
  unobservable: { nextActor: "person", nextAction, handles: [] },
});

const receiptOf = (
  requestId: string,
  orgId: string,
  result: OperationResult,
): OperationReceipt => ({
  requestId,
  operationId: requestId,
  executor: "zerops",
  affected: [{ family: "organizationMembers", id: orgId }],
  handles: [],
  acceptance: { kind: "accepted", result },
  outcome: { kind: "succeeded", evidence: "Zerops answered the write." },
});

export function teamExecutor(
  platform: TeamPlatform,
  readBack: TeamReadBack,
  /** The viewer's role in the organization, as their membership names it now. */
  viewerRoleOf: (orgId: string) => string | undefined,
) {
  const listed = (orgId: string) =>
    Effect.mapError(
      verb(() => platform.listOrganizationMembers(orgId)),
      inWords,
    );
  const find = (members: ReadonlyArray<ZeropsOrganizationMember>, id: string) =>
    members.find((one) => one.id === id);

  const setRole = (requestId: string, intent: IntentOf<"set-org-role">) =>
    Effect.gen(function* () {
      const member = find(yield* listed(intent.orgId), intent.clientUserId);
      if (member === undefined) return yield* refused(GONE);
      const target = intent.membership;
      const was = membershipOf(member);
      const refusal = teamChangeRefusal({
        viewerRole: viewerRoleOf(intent.orgId),
        memberRole: member.roleCode,
        roleCode: target.roleCode,
        finances:
          was.canViewFinances !== target.canViewFinances ||
          was.canEditFinances !== target.canEditFinances,
      });
      if (refusal !== null) return yield* refused(refusal);
      const holds = (one: ZeropsOrganizationMember) => sameMembership(membershipOf(one), target);
      if (holds(member)) {
        yield* Effect.promise(() => readBack(intent.orgId, member.id));
        return receiptOf(requestId, intent.orgId, { changed: false });
      }
      const written = yield* Effect.result(
        verb(() => platform.updateOrganizationMember(member.id, target)),
      );
      if (Result.isFailure(written)) {
        if (written.failure.outcome !== "uncertain-acceptance")
          return yield* Effect.fail(inWords(written.failure));
        const again = yield* Effect.result(listed(intent.orgId));
        const now = Result.isSuccess(again) ? find(again.success, member.id) : undefined;
        if (now === undefined || !holds(now)) {
          yield* Effect.promise(() => readBack(intent.orgId, member.id));
          return unobservable("Check their role, then choose again");
        }
      }
      yield* Effect.promise(() => readBack(intent.orgId, member.id));
      return receiptOf(requestId, intent.orgId, { changed: true });
    });

  const removeMember = (requestId: string, intent: IntentOf<"remove-member">) =>
    Effect.gen(function* () {
      const member = find(yield* listed(intent.orgId), intent.clientUserId);
      if (member === undefined) {
        // Gone already: what the removal asked for stands.
        yield* Effect.promise(() => readBack(intent.orgId, intent.clientUserId));
        return receiptOf(requestId, intent.orgId, { removed: true });
      }
      const refusal = teamChangeRefusal({
        viewerRole: viewerRoleOf(intent.orgId),
        memberRole: member.roleCode,
        roleCode: null,
      });
      if (refusal !== null) return yield* refused(refusal);
      const removed = yield* Effect.result(
        verb(() => platform.removeOrganizationMember(member.id)),
      );
      if (Result.isFailure(removed)) {
        if (removed.failure.outcome !== "uncertain-acceptance")
          return yield* Effect.fail(inWords(removed.failure));
        const again = yield* Effect.result(listed(intent.orgId));
        if (!Result.isSuccess(again) || find(again.success, member.id) !== undefined) {
          yield* Effect.promise(() => readBack(intent.orgId, member.id));
          return unobservable("Check the organization's members in Zerops");
        }
      }
      yield* Effect.promise(() => readBack(intent.orgId, member.id));
      return receiptOf(requestId, intent.orgId, { removed: true });
    });

  return { setRole, removeMember };
}
