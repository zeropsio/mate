import { type StreamFault, STREAM_POLICY } from "../../streamMachine.ts";
/** A lost file-write answer stays uncertain; it is never repeated automatically. */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import {
  WS_METHODS,
  type EnvironmentId,
  type ProjectWriteFileInput,
  type ProjectWriteFileResult,
} from "@t3tools/contracts";
import type { EnvironmentRegistry } from "../../../connection/registry.ts";
import { request } from "../../../rpc/client.ts";
import { workspaceId } from "../../families/mateWorkspace.ts";
import { workspaceFailure } from "../../adapters/mateWorkspace.ts";
import type { OperationExecutor } from "../coordinator.ts";

export function makeFileWriteExecutor(options: {
  readonly current: () => boolean;
  readonly write: (
    environmentId: EnvironmentId,
    input: ProjectWriteFileInput,
  ) => Effect.Effect<ProjectWriteFileResult, StreamFault>;
}): OperationExecutor {
  return {
    isCurrent: options.current,
    submit: (requestId, intent) =>
      Effect.gen(function* () {
        if (intent.kind !== "mate-write-file" || !options.current())
          return yield* Effect.fail({
            outcome: "definitive-refusal",
            message: "This account is no longer active.",
          } as const);
        const result = yield* options.write(intent.environmentId, intent.input).pipe(
          Effect.catchCause((cause) => {
            const fault = workspaceFailure(Cause.squash(cause));
            return Effect.fail(
              fault.outcome === "transient"
                ? {
                    outcome: "uncertain-acceptance" as const,
                    message: "The save answer was lost. Read the file again before saving again.",
                  }
                : fault,
            );
          }),
        );
        if (!options.current())
          return yield* Effect.fail({
            outcome: "uncertain-acceptance",
            message: "The account changed before the save answered.",
          } as const);
        return {
          requestId,
          operationId: requestId,
          executor: "mate",
          affected: [
            {
              family: "mateWorkspaceFile",
              id: workspaceId({
                environmentId: intent.environmentId,
                input: { cwd: intent.input.cwd, relativePath: intent.input.relativePath },
              }),
            },
          ],
          handles: [],
          acceptance: { kind: "accepted", result },
          outcome: { kind: "pending" },
        };
      }),
  };
}
export const fileWriteWire =
  (registry: EnvironmentRegistry["Service"]) =>
  (environmentId: EnvironmentId, input: ProjectWriteFileInput) =>
    registry.run(environmentId, request(WS_METHODS.projectsWriteFile, input)).pipe(
      Effect.timeout(STREAM_POLICY.baselineTimeoutMs),
      Effect.catchCause((cause) => Effect.fail(workspaceFailure(Cause.squash(cause)))),
    );
