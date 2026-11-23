/**
 * Who works on an app, at Zerops (`operations/appAccess.ts`): an address checked before it is
 * invited. A lost answer is asked again by the person, as a new check.
 *
 * @module data/operations/executors/appAccess
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ZeropsOrganizationMember } from "../../../zerops/api/account.ts";
import type { OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { UncertainAcceptance } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { refusedInWords, verb } from "./write.ts";

export type AppAccessPlatform = {
  readonly validateOrganizationUser: (
    clientId: string,
    email: string,
  ) => Promise<{ readonly kind: "existing"; readonly userId: string } | { readonly kind: "new" }>;
  readonly listOrganizationMembers: (
    clientId: string,
  ) => Promise<ReadonlyArray<ZeropsOrganizationMember>>;
};

const ALREADY = "Already in this organization — change their access in the list.";
const ALREADY_CODES = new Set(["userAlreadyConnectedToCompany", "duplicatedUser"]);

type Fault = StreamFault | UncertainAcceptance;

/**
 * Zerops's refusal in the words a person needs: someone already here, who may — where Zerops
 * said it is a permission — else what Zerops said.
 */
function inWords(fault: Fault, cause: { readonly forbidden: string }): Fault {
  if (fault.outcome === "uncertain-acceptance") return fault;
  const code = "code" in fault ? fault.code : undefined;
  if (code !== undefined && ALREADY_CODES.has(code))
    return { ...fault, outcome: "definitive-refusal", message: ALREADY };
  return refusedInWords(fault, cause.forbidden);
}

const INVITE = { forbidden: "Only an organization owner or admin can invite." };

const sameAddress = (a: string | undefined, b: string) =>
  a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();

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

export function appAccessExecutor(platform: AppAccessPlatform) {
  /** The membership whose address is `email`, as the member list names it now. */
  const memberByAddress = (orgId: string, email: string) =>
    Effect.map(
      verb(() => platform.listOrganizationMembers(orgId)),
      (members) => members.find((one) => sameAddress(one.user?.email, email)),
    );

  const check = (requestId: string, intent: IntentOf<"check-invitee">) =>
    Effect.gen(function* () {
      const answer = yield* Effect.result(
        Effect.mapError(
          verb(() => platform.validateOrganizationUser(intent.orgId, intent.email)),
          (fault): Fault =>
            // Asking changes nothing: a lost answer is asked again by the person, as a new check.
            fault.outcome === "uncertain-acceptance"
              ? { outcome: "transient", message: "Zerops didn't answer. Try again." }
              : inWords(fault, INVITE),
        ),
      );
      if (Result.isSuccess(answer)) return receiptOf(requestId, intent.orgId, answer.success);
      if (answer.failure.message !== ALREADY) return yield* Effect.fail(answer.failure);
      // Already a member: someone taken out of an app comes back by being given its access again.
      const member = yield* Effect.orElseSucceed(
        memberByAddress(intent.orgId, intent.email),
        () => undefined,
      );
      if (member === undefined) return yield* Effect.fail(answer.failure);
      const userId = member.user?.id ?? member.userId;
      return receiptOf(requestId, intent.orgId, {
        kind: "member",
        clientUserId: member.id,
        ...(userId === undefined ? {} : { userId }),
        roleCode: member.roleCode ?? "NO_ACCESS",
      });
    });

  return { check };
}
