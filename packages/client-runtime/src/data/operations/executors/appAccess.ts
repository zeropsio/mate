/**
 * Who works on an app, at Zerops (`operations/appAccess.ts`): an address checked before it is
 * invited, and a project just made given its people.
 *
 * Zerops keeps no request ids, so a grant whose answer was lost is proven only by reading the
 * project it would have changed, and never sent again; anything a read cannot prove is the
 * person's to check. Once written, the organization's member list and the project are read again
 * (`readBack`) before the answer is given, so the people a project page shows never lag a write it
 * reported done.
 *
 * @module data/operations/executors/appAccess
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ZeropsApiClient } from "../../../zerops/api.ts";
import type { ZeropsOrganizationMember } from "../../../zerops/api/account.ts";
import type { OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OwnerUnobservable, UncertainAcceptance } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { refusedInWords, verb } from "./write.ts";

export type AppAccessPlatform = Pick<ZeropsApiClient, "writeNewProjectAccess" | "fetchProject"> & {
  readonly validateOrganizationUser: (
    clientId: string,
    email: string,
  ) => Promise<{ readonly kind: "existing"; readonly userId: string } | { readonly kind: "new" }>;
  readonly listOrganizationMembers: (
    clientId: string,
  ) => Promise<ReadonlyArray<ZeropsOrganizationMember>>;
};

/** Reads the organization's member list and these places again; settles however the reads end. */
type AppAccessReadBack = (orgId: string, places: ReadonlyArray<string>) => Promise<void>;

const ALREADY = "Already in this organization — change their access in the list.";
const ALREADY_CODES = new Set(["userAlreadyConnectedToCompany", "duplicatedUser"]);
/** Zerops refuses hiding a project from an owner or an admin (measured 2026-10-14). */
const KEEPS_VISIBLE = "Zerops keeps every project visible to organization owners and admins.";

type Fault = StreamFault | UncertainAcceptance;

/**
 * Zerops's refusal in the words a person needs: someone already here, a project an owner or admin
 * must keep, who may — where Zerops said it is a permission — else what Zerops said.
 */
function inWords(fault: Fault, cause: { readonly forbidden: string }): Fault {
  if (fault.outcome === "uncertain-acceptance") return fault;
  const code = "code" in fault ? fault.code : undefined;
  if (code !== undefined && ALREADY_CODES.has(code))
    return { ...fault, outcome: "definitive-refusal", message: ALREADY };
  if (code === "noAccessRoleInvalid")
    return { ...fault, outcome: "definitive-refusal", message: KEEPS_VISIBLE };
  return refusedInWords(fault, cause.forbidden);
}

const INVITE = { forbidden: "Only an organization owner or admin can invite." };
const NEW_PROJECT = { forbidden: "Only the project's owner or an admin can give its access." };

const sameAddress = (a: string | undefined, b: string) =>
  a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();

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

export function appAccessExecutor(platform: AppAccessPlatform, readBack: AppAccessReadBack) {
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

  /** A project just made is given its people; a lost answer is proven by reading the project. */
  const grantNewProject = (requestId: string, intent: IntentOf<"grant-new-project-access">) =>
    Effect.gen(function* () {
      const written = yield* Effect.result(
        verb(() => platform.writeNewProjectAccess(intent.projectId, intent.userRoles)),
      );
      if (Result.isFailure(written) && written.failure.outcome !== "uncertain-acceptance") {
        yield* Effect.promise(() => readBack(intent.orgId, [intent.projectId]));
        return yield* Effect.fail(inWords(written.failure, NEW_PROJECT));
      }
      if (Result.isFailure(written)) {
        const read = yield* Effect.result(verb(() => platform.fetchProject(intent.projectId)));
        const holds =
          Result.isSuccess(read) &&
          intent.userRoles.every(({ clientUserId, roleCode }) =>
            read.success.userRoles?.some(
              (entry) => entry.clientUserId === clientUserId && entry.roleCode === roleCode,
            ),
          );
        if (!holds) {
          yield* Effect.promise(() => readBack(intent.orgId, [intent.projectId]));
          return unobservable("Check who has access on the project's page");
        }
      }
      yield* Effect.promise(() => readBack(intent.orgId, [intent.projectId]));
      return {
        ...receiptOf(requestId, intent.orgId, { projectId: intent.projectId }),
        affected: [{ family: "project", id: intent.projectId }],
      } satisfies OperationReceipt;
    });

  return { check, grantNewProject };
}
