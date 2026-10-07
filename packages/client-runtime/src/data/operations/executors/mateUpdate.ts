import {
  EnvironmentAuthorizationError,
  ZeropsMateUpdateError,
  type EnvironmentId,
  type ZeropsMateUpdateResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { OperationExecutor } from "../coordinator.ts";
import type { OperationReceipt } from "../../model.ts";

const denied = Schema.is(EnvironmentAuthorizationError);
const refused = Schema.is(ZeropsMateUpdateError);
export function makeMateUpdateExecutor<E>(options: {
  readonly call: (environmentId: EnvironmentId) => Effect.Effect<ZeropsMateUpdateResult, E>;
  readonly isCurrent: () => boolean;
}): OperationExecutor {
  return {
    isCurrent: () => options.isCurrent(),
    submit: (requestId, intent) =>
      Effect.gen(function* () {
        if (intent.kind !== "mate-update" || !options.isCurrent())
          return yield* Effect.fail({
            outcome: "definitive-refusal",
            message: "This account is no longer active.",
          } as const);
        const value = yield* options.call(intent.environmentId).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause);
            return Effect.fail(
              denied(error) || (refused(error) && error.reason === "zcp-not-found")
                ? { outcome: "definitive-refusal" as const, message: error.message }
                : {
                    outcome: "uncertain-acceptance" as const,
                    message:
                      "The update answer was lost. Check the connection again; the update may have started.",
                  },
            );
          }),
        );
        if (!options.isCurrent())
          return yield* Effect.fail({
            outcome: "uncertain-acceptance",
            message: "The account changed before the update answered.",
          } as const);
        return {
          requestId,
          operationId: requestId,
          executor: "mate",
          affected: [],
          handles: [],
          acceptance:
            value.error === undefined
              ? {
                  kind: "accepted",
                  result: {
                    alreadyCurrent: value.action === "none",
                    version: value.action === "none" ? value.serverVersion : null,
                  },
                }
              : { kind: "refused", reason: value.error },
          outcome:
            value.error !== undefined
              ? { kind: "failed", evidence: value.error }
              : value.action === "none"
                ? { kind: "succeeded", evidence: "Already current." }
                : { kind: "pending" },
        } satisfies OperationReceipt;
      }),
  };
}
