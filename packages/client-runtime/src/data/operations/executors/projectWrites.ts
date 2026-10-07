/**
 * Zerops writes to one project, each answered as its end (`answeredReceipt`).
 *
 * @module data/operations/executors/projectWrites
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ZeropsApiError, type ZeropsProject } from "../../../zerops/api.ts";
import { zeropsFault } from "../../../zerops/data/zeropsWire.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationReceipt } from "../../model.ts";
import type { ProjectTagWriter } from "./projectTags.ts";
import type { OwnerUnobservable } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

/**
 * The tag writer's own refusal — renamed since, or written over before its read-back — said as
 * Zerops's refusal is: with its words, never as a lost answer.
 */
const tagWrite = <A>(call: () => Promise<A>) =>
  verb(() =>
    call().catch((cause: unknown) => {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "_tag" in cause &&
        cause._tag === "ZeropsProjectTagWriteError" &&
        "kind" in cause &&
        cause.kind === "rejected" &&
        "message" in cause &&
        typeof cause.message === "string"
      )
        throw new ZeropsApiError(cause.message, "invalid-input");
      throw cause;
    }),
  );

export function startProjectExecutor(platform: {
  readonly startProject: (projectId: string) => Promise<void>;
}) {
  return (requestId: string, intent: IntentOf<"start-project">) =>
    Effect.as(
      verb(() => platform.startProject(intent.projectId)),
      answeredReceipt(requestId, { family: "project", id: intent.projectId }),
    );
}

export function renameProjectExecutor(tags: Pick<ProjectTagWriter, "rename">) {
  return (requestId: string, intent: IntentOf<"rename-project">) =>
    Effect.as(
      tagWrite(() => tags.rename(intent.projectId, intent.name, { from: intent.from })),
      answeredReceipt(requestId, { family: "project", id: intent.projectId }),
    );
}

export function updateProjectTagsExecutor(tags: Pick<ProjectTagWriter, "write">) {
  return (requestId: string, intent: IntentOf<"update-project-tags">) =>
    Effect.as(
      tagWrite(() => tags.write(intent.projectId, intent.patch)),
      answeredReceipt(requestId, { family: "project", id: intent.projectId }),
    );
}

const ownersOf = (project: ZeropsProject) =>
  (project.userRoles ?? [])
    .filter((role) => role.roleCode === "OWNER")
    .map((role) => role.clientUserId);

export function assignMateOwnerExecutor(platform: {
  readonly setProjectMemberRole: (input: {
    readonly projectId: string;
    readonly clientUserId: string;
    readonly roleCode: "OWNER" | null;
  }) => Promise<ZeropsProject>;
  readonly fetchProject: (projectId: string) => Promise<ZeropsProject>;
}) {
  const write = (projectId: string, clientUserId: string, roleCode: "OWNER" | null) =>
    verb(() =>
      platform
        .setProjectMemberRole({ projectId, clientUserId, roleCode })
        .catch((cause: unknown) => {
          // This helper writes the role, then reads the project. A refused read-back cannot prove
          // the role write was refused. Before-send admission uses ZeropsWriteNotSent separately.
          if (cause instanceof ZeropsApiError)
            throw new ZeropsApiError(cause.detail ?? cause.message, "uncertain");
          throw cause;
        }),
    );
  /**
   * The project as Zerops holds it after the first write: its own answer, or — that answer lost —
   * the project read again, once it shows the person picked as its OWNER.
   */
  const handedOver = (intent: IntentOf<"assign-mate-owner">) =>
    Effect.gen(function* () {
      const first = yield* Effect.result(write(intent.projectId, intent.clientUserId, "OWNER"));
      if (Result.isSuccess(first)) return first.success;
      if (first.failure.outcome !== "uncertain-acceptance")
        return yield* Effect.fail(first.failure);
      // One read right after cannot say a write that timed out will never land: only one that
      // shows it landed lets the hand-over go on; anything else is the person's to check.
      const read = yield* Effect.result(verb(() => platform.fetchProject(intent.projectId)));
      if (Result.isSuccess(read) && ownersOf(read.success).includes(intent.clientUserId))
        return read.success;
      return {
        unobservable: {
          nextActor: "person",
          nextAction: "Check who owns the Mate, then hand it over again",
          handles: [],
        },
      } satisfies OwnerUnobservable;
    });
  return (
    requestId: string,
    intent: IntentOf<"assign-mate-owner"> | IntentOf<"finish-mate-handover">,
  ) =>
    Effect.gen(function* () {
      const handed =
        intent.kind === "finish-mate-handover"
          ? yield* Effect.tryPromise({
              try: () => platform.fetchProject(intent.projectId),
              catch: zeropsFault,
            })
          : yield* handedOver(intent);
      if ("unobservable" in handed) return handed;
      if (!ownersOf(handed).includes(intent.clientUserId) && intent.kind === "finish-mate-handover")
        return yield* Effect.fail<StreamFault>({
          outcome: "definitive-refusal",
          message: "The chosen owner no longer owns this Mate. Review its current ownership.",
        });
      const previousOwnerIds =
        intent.kind === "finish-mate-handover"
          ? intent.previousOwnerIds.filter((id) => id !== intent.clientUserId)
          : ownersOf(handed).filter((id) => id !== intent.clientUserId);
      const receipt: OperationReceipt = {
        ...answeredReceipt(requestId, { family: "project", id: intent.projectId }),
        acceptance: { kind: "accepted", result: { previousOwnerIds } },
      };
      let current = handed;
      const changed = (): OperationReceipt => ({
        ...receipt,
        outcome: {
          kind: "failed",
          evidence:
            "Ownership changed during the hand-over. Review who owns the Mate before continuing.",
        },
      });
      if (!ownersOf(current).includes(intent.clientUserId)) return changed();
      // Only once the first write is known to have landed is the Mate taken off its previous owner.
      for (const owner of previousOwnerIds) {
        const held = ownersOf(current);
        if (
          !held.includes(intent.clientUserId) ||
          held.some((id) => id !== intent.clientUserId && !previousOwnerIds.includes(id))
        )
          return changed();
        if (!held.includes(owner)) continue;
        const taken = yield* Effect.result(write(intent.projectId, owner, null));
        if (Result.isFailure(taken)) {
          if (taken.failure.outcome === "uncertain-acceptance") {
            const read = yield* Effect.result(verb(() => platform.fetchProject(intent.projectId)));
            if (Result.isSuccess(read) && !ownersOf(read.success).includes(owner)) {
              current = read.success;
              continue;
            }
            return {
              receipt: { ...receipt, outcome: { kind: "pending" } },
              unobservable: {
                nextActor: "person",
                nextAction:
                  "Check the original hand-over, then finish removing its previous owners",
                reason: taken.failure.message,
                handles: [intent.projectId],
              },
            } satisfies OwnerUnobservable;
          }
          return {
            ...receipt,
            outcome: {
              kind: "failed",
              evidence: `It was handed over, but its previous owner still owns it too: ${taken.failure.message}`,
            },
          } satisfies OperationReceipt;
        }
        current = taken.success;
      }
      if (ownersOf(current).length !== 1 || ownersOf(current)[0] !== intent.clientUserId)
        return changed();
      return receipt;
    });
}
