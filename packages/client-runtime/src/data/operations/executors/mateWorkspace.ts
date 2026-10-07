import { type StreamFault, STREAM_POLICY } from "../../streamMachine.ts";
/** The Mate's answer completes synchronous verbs; losing it leaves a named unresolved action. */
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import type { EnvironmentRegistry } from "../../../connection/registry.ts";
import { request } from "../../../rpc/client.ts";
import { workspaceFailure } from "../../adapters/mateWorkspace.ts";
import {
  WORKSPACE_MUTATIONS,
  type WorkspaceMutation,
  type MutationTarget,
  type MutationValue,
} from "../mateWorkspace.ts";
import type { OperationExecutor } from "../coordinator.ts";
import type { OperationResult } from "../../model.ts";

export interface WorkspaceMutationWire {
  readonly call: <K extends WorkspaceMutation>(
    kind: K,
    target: MutationTarget<K>,
  ) => Effect.Effect<MutationValue<K>, StreamFault>;
}
export const makeWorkspaceMutationWire = (
  registry: EnvironmentRegistry["Service"],
): WorkspaceMutationWire => ({
  call: (kind, target) =>
    registry.run(target.environmentId, request(WORKSPACE_MUTATIONS[kind], target.input)).pipe(
      Effect.timeout(STREAM_POLICY.baselineTimeoutMs),
      Effect.catchCause((cause) => Effect.fail(workspaceFailure(Cause.squash(cause)))),
    ) as Effect.Effect<MutationValue<typeof kind>, StreamFault>,
});
export const makeWorkspaceExecutor = (
  wire: WorkspaceMutationWire,
  current: () => boolean,
): OperationExecutor => ({
  isCurrent: current,
  submit: (requestId, intent) =>
    Effect.gen(function* () {
      if (!current() || !(intent.kind in WORKSPACE_MUTATIONS))
        return yield* Effect.fail({
          outcome: "definitive-refusal",
          message: "This workspace action is unavailable.",
        } as const);
      const kind = intent.kind as WorkspaceMutation;
      const result = yield* wire.call(kind, intent as MutationTarget<typeof kind>).pipe(
        Effect.catchCause((cause) => {
          const fault = workspaceFailure(Cause.squash(cause));
          return Effect.fail(
            fault.outcome === "transient"
              ? {
                  outcome: "uncertain-acceptance" as const,
                  message:
                    "The action's answer was lost. Inspect the owner's state before trying another action.",
                }
              : fault,
          );
        }),
      );
      if (!current())
        return yield* Effect.fail({
          outcome: "uncertain-acceptance",
          message: "The account changed before the action answered.",
        } as const);
      return {
        requestId,
        operationId: requestId,
        executor: "mate",
        affected: [],
        handles: [],
        acceptance: { kind: "accepted", result: result as OperationResult },
        outcome: { kind: "succeeded", evidence: "The Mate answered this action." },
      };
    }),
});
