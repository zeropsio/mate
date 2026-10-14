/**
 * Who works on an app, at Zerops (`operations/appAccess.ts`): an address checked, an invitation
 * with the app's grants on it, a member's access to the app changed, removed or withdrawn; and who
 * reaches some projects, written on each person's own list.
 *
 * Zerops keeps no request ids, so a write whose answer was lost is proven only by reading what it
 * would have changed — the member list, the member's own grants — and never sent again; anything
 * a read cannot prove is the person's to check. Once written, the organization's member list and
 * the app's places are read again (`readBack`) before the answer is given, so the people a
 * project page shows never lag a write it reported done.
 *
 * @module data/operations/executors/appAccess
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { planAppGrants, type ProjectGrantEntry } from "../../../zerops/appAccess.ts";
import { planMemberProjectGrants } from "../../../zerops/projectAccess.ts";
import type { ZeropsApiClient } from "../../../zerops/api.ts";
import type { OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OwnerUnobservable, UncertainAcceptance } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { refusedInWords, verb } from "./write.ts";

export type AppAccessPlatform = Pick<
  ZeropsApiClient,
  | "validateOrganizationUser"
  | "inviteOrganizationUser"
  | "connectOrganizationUser"
  | "listOrganizationMembers"
  | "readMemberProjectRoles"
  | "writeMemberProjectRoles"
  | "removeOrganizationMember"
  | "writeNewProjectAccess"
  | "fetchProject"
>;

/**
 * Reads the organization's member list, these places and these members' own grants again; settles
 * however the reads end.
 */
export type AppAccessReadBack = (
  orgId: string,
  places: ReadonlyArray<string>,
  members?: ReadonlyArray<string>,
) => Promise<void>;

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
const CHANGE = { forbidden: "Only an organization owner or admin can change who has access." };
const NEW_PROJECT = { forbidden: "Only the project's owner or an admin can give its access." };

const sameList = (a: ReadonlyArray<ProjectGrantEntry>, b: ReadonlyArray<ProjectGrantEntry>) => {
  const key = (list: ReadonlyArray<ProjectGrantEntry>) =>
    list
      .map(({ projectId, roleCode }) => `${projectId}=${roleCode}`)
      .sort()
      .join(",");
  return key(a) === key(b);
};

const sameAddress = (a: string | undefined, b: string) =>
  a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();

const unobservable = (nextAction: string, reason?: string): OwnerUnobservable => ({
  unobservable: {
    nextActor: "person",
    nextAction,
    ...(reason === undefined ? {} : { reason }),
    handles: [],
  },
});

const receiptOf = (
  requestId: string,
  orgId: string,
  result: OperationResult,
  outcome: OperationReceipt["outcome"] = {
    kind: "succeeded",
    evidence: "Zerops answered the write.",
  },
): OperationReceipt => ({
  requestId,
  operationId: requestId,
  executor: "zerops",
  affected: [{ family: "organizationMembers", id: orgId }],
  handles: [],
  acceptance: { kind: "accepted", result },
  outcome,
});

export function appAccessExecutor(platform: AppAccessPlatform, readBack: AppAccessReadBack) {
  /** The member's list with the app's grants planned in, written — proven by a read where lost. */
  const writeGrants = (
    clientUserId: string,
    plan: (current: ReadonlyArray<ProjectGrantEntry>) => {
      readonly list: ReadonlyArray<ProjectGrantEntry>;
      readonly changed: boolean;
    },
  ) =>
    Effect.gen(function* () {
      const current = yield* verb(() => platform.readMemberProjectRoles(clientUserId));
      const planned = plan(current);
      if (!planned.changed) return { written: true as const, list: planned.list };
      const written = yield* Effect.result(
        verb(() => platform.writeMemberProjectRoles(clientUserId, planned.list)),
      );
      if (Result.isSuccess(written)) return { written: true as const, list: planned.list };
      if (written.failure.outcome !== "uncertain-acceptance")
        return yield* Effect.fail(written.failure);
      const read = yield* Effect.result(verb(() => platform.readMemberProjectRoles(clientUserId)));
      if (Result.isSuccess(read) && sameList(read.success, planned.list))
        return { written: true as const, list: planned.list };
      return { written: false as const, list: planned.list };
    });

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

  const invite = (requestId: string, intent: IntentOf<"invite-member">) =>
    Effect.gen(function* () {
      const membership = intent.membership ?? {
        // The organization opens nothing by itself: the app's grants are what they get.
        roleCode: "NO_ACCESS",
        // Someone who works on it adds their own Mate; someone who looks doesn't.
        canCreateProjects: "level" in intent && intent.level === "work",
        canViewFinances: false,
        canEditFinances: false,
      };
      // An owner or an admin reaches every app by their role: no app is theirs to be given. Each
      // project's own level is written as it is set, a hidden one too.
      const projects =
        "grants" in intent || membership.roleCode !== "NO_ACCESS"
          ? { places: [], mates: [] }
          : intent.projects;
      const written = "grants" in intent ? intent.grants.map(({ projectId }) => projectId) : [];
      const { invitee } = intent;
      const sent = yield* Effect.result(
        Effect.mapError(
          verb(() =>
            invitee.kind === "existing"
              ? platform.connectOrganizationUser(intent.orgId, {
                  ...membership,
                  userId: invitee.userId,
                })
              : platform.inviteOrganizationUser(intent.orgId, {
                  ...membership,
                  email: intent.email,
                  firstName: invitee.firstName,
                  lastName: invitee.lastName,
                }),
          ),
          (fault) => inWords(fault, INVITE),
        ),
      );
      if (Result.isFailure(sent) && sent.failure.outcome !== "uncertain-acceptance")
        return yield* Effect.fail(sent.failure);
      const found = yield* Effect.result(memberByAddress(intent.orgId, intent.email));
      const member = Result.isSuccess(found) ? found.success : undefined;
      if (member === undefined)
        return Result.isFailure(sent)
          ? unobservable("Check the organization's members in Zerops, then invite again")
          : unobservable(
              "Reload, then set their access in the list",
              "Zerops took the invitation, but its member list doesn't show them yet.",
            );
      const plan = (current: ReadonlyArray<ProjectGrantEntry>) =>
        "grants" in intent
          ? planMemberProjectGrants({
              current,
              orgRole: membership.roleCode,
              changes: intent.grants,
            })
          : planAppGrants({
              current,
              orgRole: membership.roleCode,
              projects,
              owned: [],
              change: intent.level,
            });
      const granted = yield* Effect.result(writeGrants(member.id, plan));
      yield* Effect.promise(() =>
        readBack(intent.orgId, [...projects.places, ...written], [member.id]),
      );
      const result = { clientUserId: member.id };
      if (Result.isFailure(granted))
        return receiptOf(requestId, intent.orgId, result, {
          kind: "failed",
          evidence: `They're invited, but Zerops didn't take their access here: ${
            inWords(granted.failure, CHANGE).message
          }`,
        });
      if (!granted.success.written)
        return {
          ...unobservable("Check their access, then choose again"),
          receipt: { ...receiptOf(requestId, intent.orgId, result), outcome: { kind: "pending" } },
        } satisfies OwnerUnobservable;
      return receiptOf(requestId, intent.orgId, result);
    });

  const setAccess = (requestId: string, intent: IntentOf<"set-app-access">) =>
    Effect.gen(function* () {
      const members = yield* verb(() => platform.listOrganizationMembers(intent.orgId));
      const member = members.find((one) => one.id === intent.clientUserId);
      if (member === undefined)
        return yield* Effect.fail<StreamFault>({
          outcome: "definitive-refusal",
          message: "They're no longer in this organization.",
        });
      let dropMembership = false;
      const plan = (current: ReadonlyArray<ProjectGrantEntry>) => {
        const planned = planAppGrants({
          current,
          orgRole: member.roleCode,
          projects: intent.projects,
          owned: intent.owned,
          change: intent.change,
        });
        dropMembership = planned.dropMembership;
        return planned;
      };
      const granted = yield* Effect.mapError(writeGrants(member.id, plan), (fault) =>
        inWords(fault, CHANGE),
      );
      if (!granted.written) {
        yield* Effect.promise(() => readBack(intent.orgId, intent.projects.places, [member.id]));
        return unobservable("Check their access, then choose again");
      }
      let membershipEnded = false;
      if (dropMembership) {
        const removed = yield* Effect.result(
          verb(() => platform.removeOrganizationMember(member.id)),
        );
        if (Result.isSuccess(removed)) membershipEnded = true;
        else if (removed.failure.outcome === "uncertain-acceptance") {
          const listed = yield* Effect.result(
            verb(() => platform.listOrganizationMembers(intent.orgId)),
          );
          if (Result.isSuccess(listed) && !listed.success.some((one) => one.id === member.id))
            membershipEnded = true;
          else {
            yield* Effect.promise(() =>
              readBack(intent.orgId, intent.projects.places, [member.id]),
            );
            return unobservable(
              "Check the organization's members in Zerops",
              "Their access here is gone; whether the invitation is too, Zerops didn't say.",
            );
          }
        } else {
          yield* Effect.promise(() => readBack(intent.orgId, intent.projects.places, [member.id]));
          return receiptOf(
            requestId,
            intent.orgId,
            { membershipEnded: false },
            {
              kind: "failed",
              evidence: `Their access here is gone, but the invitation still stands: ${
                inWords(removed.failure, CHANGE).message
              }`,
            },
          );
        }
      }
      yield* Effect.promise(() => readBack(intent.orgId, intent.projects.places, [member.id]));
      return receiptOf(requestId, intent.orgId, { membershipEnded });
    });

  const setProjectAccess = (requestId: string, intent: IntentOf<"set-project-access">) =>
    Effect.gen(function* () {
      const projects = [...new Set(intent.changes.map(({ projectId }) => projectId))];
      const people = Map.groupBy(intent.changes, ({ clientUserId }) => clientUserId);
      // Their own grants are read again too: a person's page shows what was saved, never less.
      const named = [...people.keys()];
      const members = yield* verb(() => platform.listOrganizationMembers(intent.orgId));
      const found = [...people.keys()].map((id) => members.find((one) => one.id === id));
      // Nobody is written while anyone named has gone: the change is judged as a whole.
      if (found.some((one) => one === undefined))
        return yield* Effect.fail<StreamFault>({
          outcome: "definitive-refusal",
          message: "They're no longer in this organization.",
        });
      let written = 0;
      for (const member of found) {
        if (member === undefined) continue;
        const changes = people.get(member.id) ?? [];
        const granted = yield* Effect.result(
          Effect.mapError(
            writeGrants(member.id, (current) =>
              planMemberProjectGrants({ current, orgRole: member.roleCode, changes }),
            ),
            (fault) => inWords(fault, CHANGE),
          ),
        );
        if (Result.isFailure(granted)) {
          yield* Effect.promise(() => readBack(intent.orgId, projects, named));
          return yield* Effect.fail(granted.failure);
        }
        if (!granted.success.written) {
          yield* Effect.promise(() => readBack(intent.orgId, projects, named));
          return unobservable("Check their access, then choose again");
        }
        written += 1;
      }
      yield* Effect.promise(() => readBack(intent.orgId, projects, named));
      return receiptOf(requestId, intent.orgId, { written });
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

  return { check, invite, setAccess, setProjectAccess, grantNewProject };
}
