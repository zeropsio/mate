/** Saving retains a receipt and its owner read-back beyond the initiating view. */
import { sameValue } from "../projections/equal.ts";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import type {
  EnvironmentId,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";
import { makeOperations } from "../operations/coordinator.ts";
import { makeFileWriteExecutor } from "../operations/executors/mateWriteFile.ts";
import { operationResult } from "../model.ts";
import type { AccountStore } from "../store.ts";
import { workspaceId } from "../families/mateWorkspace.ts";
import type { makeWorkspaceReads } from "./mateWorkspace.ts";
import type { StreamFault } from "../streamMachine.ts";

export function makeFileWrites(options: {
  readonly store: AccountStore;
  readonly reads: ReturnType<typeof makeWorkspaceReads>;
  readonly write: Parameters<typeof makeFileWriteExecutor>[0]["write"];
  readonly current: () => boolean;
  readonly makeId: () => string;
}) {
  const operations = makeOperations({
    store: options.store,
    makeId: options.makeId,
    executors: { mate: makeFileWriteExecutor(options) },
  });
  return async (target: {
    readonly environmentId: EnvironmentId;
    readonly input: ProjectWriteFileInput;
  }): Promise<
    | AsyncResult.Success<ProjectWriteFileResult, StreamFault>
    | AsyncResult.Failure<ProjectWriteFileResult, StreamFault>
  > => {
    for (const record of options.store.state().operations.values()) {
      if (
        record.intent.kind === "mate-write-file" &&
        record.intent.environmentId === target.environmentId &&
        sameValue(record.intent.input, target.input) &&
        record.receipt === null &&
        ["uncertain", "uncertain-unasked"].includes(record.submission)
      )
        return AsyncResult.fail({
          outcome: "transient",
          message: "The original save is unresolved. Read the file again before saving again.",
        });
    }
    const file = {
      environmentId: target.environmentId,
      input: { cwd: target.input.cwd, relativePath: target.input.relativePath },
    };
    const prior = options.store
      .state()
      .facts.get(`mateWorkspaceFile:${workspaceId(file)}`)?.revision;
    const requestId = await Effect.runPromise(
      operations.submit({
        kind: "mate-write-file",
        ...target,
        beforeSequence: prior?.kind === "mate-link" ? prior.sequence : 0,
      }),
    );
    const record = options.store.state().operations.get(requestId);
    const result = operationResult(record, "mate-write-file");
    // Also observe an uncertain save: its intended contents may be proven without resending.
    if (
      result !== undefined ||
      record?.submission === "uncertain-unasked" ||
      record?.submission === "uncertain"
    ) {
      const read = await options.reads.sample("file", file);
      if (
        result !== undefined &&
        read._tag === "Success" &&
        !read.value.truncated &&
        read.value.contents === target.input.contents
      ) {
        if (!options.current())
          return AsyncResult.fail({
            outcome: "definitive-refusal",
            message: "This account is no longer active.",
          });
        const receipt = options.store.state().operations.get(requestId)?.receipt;
        if (receipt !== null && receipt !== undefined)
          options.store.dispatch({
            kind: "operation-receipt",
            receipt: {
              ...receipt,
              outcome: {
                kind: "succeeded",
                evidence: "The owner read-back confirms the saved contents.",
              },
            },
          });
        return AsyncResult.success(result);
      }
      if (options.current())
        options.store.dispatch({
          kind: "operation-exhausted",
          requestId,
          unobservable: {
            nextActor: "you",
            nextAction: "Read the file again before saving again.",
            reason: "The save has not been confirmed by an owner read-back.",
          },
        });
      return AsyncResult.fail({
        outcome: "transient",
        message: "The save has not been confirmed. Read the file again before saving again.",
      });
    }
    const reason =
      record?.receipt?.acceptance.kind === "refused"
        ? record.receipt.acceptance.reason
        : record?.unsentBecause;
    return AsyncResult.failure(
      Cause.fail({ outcome: "definitive-refusal", message: reason ?? "The file was not saved." }),
    );
  };
}
