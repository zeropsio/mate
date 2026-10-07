/**
 * A project's creation, at Zerops: `POST /client/{id}/project`, answered with the project — the
 * operation's handle and its result.
 *
 * Zerops keeps no request ids, so its lost answer is settled by Zerops's own listing: the one
 * project of its name it lists once the answer is lost that it did not list at the send — as the
 * account's wholly read projects held them, else read then — is its own. None, or more than one — somebody else's of the same name may have
 * appeared too — and it stays uncertain, for the person to look at the projects; nothing is sent
 * again. A listing that could not be read at the send adopts nothing.
 *
 * @module data/operations/executors/createProject
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { OperationReceipt } from "../../model.ts";
import type { IntentOf } from "../kind.ts";
import { verb } from "./write.ts";

export function createProjectExecutor(platform: {
  readonly createProject: (input: {
    readonly clientId: string;
    readonly name: string;
    readonly tagList: ReadonlyArray<string>;
    readonly location?: string;
  }) => Promise<{ readonly id: string }>;
  readonly listClientProjects: (
    clientId: string,
  ) => Promise<ReadonlyArray<{ readonly id: string; readonly name: string }>>;
  /** The organization's projects of `name` as the account holds them wholly read; else `null`. */
  readonly listed: (orgId: string, name: string) => ReadonlyArray<string> | null;
}) {
  /** The ids of the organization's projects of `name`, as Zerops lists them now; `null` unread. */
  const named = (intent: IntentOf<"create-project">) =>
    Effect.map(
      Effect.result(
        Effect.tryPromise({
          try: () => platform.listClientProjects(intent.orgId),
          catch: () => null,
        }),
      ),
      (listed) =>
        Result.isSuccess(listed)
          ? listed.success.filter((project) => project.name === intent.name).map(({ id }) => id)
          : null,
    );
  const receipt = (requestId: string, id: string): OperationReceipt => ({
    requestId,
    operationId: id,
    executor: "zerops",
    affected: [{ family: "project", id }],
    handles: [id],
    acceptance: { kind: "accepted", result: { projectId: id } },
    outcome: { kind: "pending" },
  });
  return (requestId: string, intent: IntentOf<"create-project">) =>
    Effect.gen(function* () {
      const before = platform.listed(intent.orgId, intent.name) ?? (yield* named(intent));
      const sent = yield* Effect.result(
        verb(() =>
          platform.createProject({
            clientId: intent.orgId,
            name: intent.name,
            tagList: intent.tagList,
            ...(intent.location === undefined ? {} : { location: intent.location }),
          }),
        ),
      );
      if (Result.isSuccess(sent)) return receipt(requestId, sent.success.id);
      if (sent.failure.outcome !== "uncertain-acceptance" || before === null)
        return yield* Effect.fail(sent.failure);
      const after = yield* named(intent);
      const made = after?.filter((id) => !before.includes(id)) ?? [];
      if (made.length !== 1) return yield* Effect.fail(sent.failure);
      return receipt(requestId, made[0]!);
    });
}
