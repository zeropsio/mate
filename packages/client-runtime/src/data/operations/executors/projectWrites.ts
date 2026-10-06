/**
 * Zerops writes to one project, each answered as its end (`answeredReceipt`).
 *
 * @module data/operations/executors/projectWrites
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ZeropsApiError, type ZeropsProject } from "../../../zerops/api.ts";
import type { OperationReceipt } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { ProjectTagWriter } from "../../../zerops/data/tagWriter.ts";
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
        cause._tag === "ZeropsDataAdapterError" &&
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
    verb(() => platform.setProjectMemberRole({ projectId, clientUserId, roleCode }));
  /**
   * The project as Zerops holds it after the first write: its own answer, or — that answer lost —
   * the project read again, which says whether the person picked was made its OWNER.
   */
  const handedOver = (intent: IntentOf<"assign-mate-owner">) =>
    Effect.gen(function* () {
      const first = yield* Effect.result(write(intent.projectId, intent.clientUserId, "OWNER"));
      if (Result.isSuccess(first)) return first.success;
      if (first.failure.outcome !== "uncertain-acceptance")
        return yield* Effect.fail(first.failure);
      const read = yield* Effect.result(verb(() => platform.fetchProject(intent.projectId)));
      if (Result.isFailure(read))
        return {
          unobservable: {
            nextActor: "person",
            nextAction: "Check who owns the Mate, then hand it over again",
            handles: [],
          },
        } satisfies OwnerUnobservable;
      if (!ownersOf(read.success).includes(intent.clientUserId))
        return yield* Effect.fail<StreamFault>({
          outcome: "transient",
          message: "Zerops did not take the hand-over.",
        });
      return read.success;
    });
  return (requestId: string, intent: IntentOf<"assign-mate-owner">) =>
    Effect.gen(function* () {
      const handed = yield* handedOver(intent);
      if ("unobservable" in handed) return handed;
      const receipt = answeredReceipt(requestId, { family: "project", id: intent.projectId });
      // Only once the first write is known to have landed is the Mate taken off its previous owner.
      for (const owner of ownersOf(handed).filter((id) => id !== intent.clientUserId)) {
        const taken = yield* Effect.result(write(intent.projectId, owner, null));
        if (Result.isFailure(taken))
          return {
            ...receipt,
            outcome: {
              kind: "failed",
              evidence: `It was handed over, but its previous owner still owns it too: ${taken.failure.message}`,
            },
          } satisfies OperationReceipt;
      }
      return receipt;
    });
}
