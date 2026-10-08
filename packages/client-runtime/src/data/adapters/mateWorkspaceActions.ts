/** Retains action outcomes in the same account as workspace facts. */
import { sameValue } from "../projections/equal.ts";
import * as Effect from "effect/Effect";
import { AsyncResult } from "effect/reactivity";
import { makeOperations } from "../operations/coordinator.ts";
import {
  makeWorkspaceExecutor,
  type WorkspaceMutationWire,
} from "../operations/executors/mateWorkspace.ts";
import {
  type WorkspaceMutation,
  type MutationTarget,
  type MutationValue,
} from "../operations/mateWorkspace.ts";
import { operationResult, type OperationIntent } from "../model.ts";
import type { AccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
export function makeWorkspaceActions(options: {
  readonly store: AccountStore;
  readonly wire: WorkspaceMutationWire;
  readonly invalidateRefs?: (environmentId: string, cwd: string) => void;
  readonly mcpAnswer?: ReturnType<
    typeof import("./mateWorkspace.ts").makeWorkspaceReads
  >["mcpAnswer"];
  readonly current: () => boolean;
  readonly makeId: () => string;
}) {
  const operations = makeOperations({
    store: options.store,
    makeId: options.makeId,
    executors: { mate: makeWorkspaceExecutor(options.wire, options.current) },
  });
  return async <K extends WorkspaceMutation>(
    kind: K,
    target: MutationTarget<K>,
  ): Promise<
    | AsyncResult.Success<MutationValue<K>, StreamFault>
    | AsyncResult.Failure<MutationValue<K>, StreamFault>
  > => {
    const intent = { kind, ...target } as OperationIntent;
    for (const record of options.store.state().operations.values()) {
      if (
        sameValue(record.intent, intent) &&
        record.receipt === null &&
        ["recorded", "uncertain", "uncertain-unasked"].includes(record.submission)
      )
        return AsyncResult.fail({
          outcome: "transient",
          message:
            "The original action has not been resolved. Inspect the owner's state before trying another action.",
        });
    }
    const requestId = await Effect.runPromise(operations.submit(intent));
    if (
      (kind.startsWith("mate-vcs-") || kind === "mate-prepare-pull-request-thread") &&
      "cwd" in target.input &&
      typeof target.input.cwd === "string"
    )
      options.invalidateRefs?.(target.environmentId, target.input.cwd);
    const record = options.store.state().operations.get(requestId);
    const value = operationResult(record, kind) as MutationValue<K> | undefined;
    if (
      record?.receipt?.acceptance.kind === "accepted" &&
      record.receipt.outcome.kind === "succeeded"
    ) {
      if (kind.startsWith("mate-mcp-") && "threadId" in target.input)
        options.mcpAnswer?.(
          {
            environmentId: target.environmentId,
            input: target.input.threadId === undefined ? {} : { threadId: target.input.threadId },
          },
          value as import("@t3tools/contracts").McpServersList,
        );
      else if (kind.startsWith("mate-mcp-"))
        options.mcpAnswer?.(
          { environmentId: target.environmentId, input: {} },
          value as import("@t3tools/contracts").McpServersList,
        );
      return AsyncResult.success(value as MutationValue<K>);
    }
    return AsyncResult.fail({
      outcome: record?.receipt?.acceptance.kind === "refused" ? "definitive-refusal" : "transient",
      message:
        record?.receipt?.acceptance.kind === "refused"
          ? record.receipt.acceptance.reason
          : "The action's outcome is unresolved. Inspect the owner's state before trying another action.",
    });
  };
}
