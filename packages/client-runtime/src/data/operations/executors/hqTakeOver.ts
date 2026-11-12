/**
 * HQ as the owner of a member's take-over. HQ keeps no request id for it: a lost answer is read in
 * the member's list once it is read again.
 */
import * as Effect from "effect/Effect";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import type { OperationExecutor } from "../coordinator.ts";
import { hqNeedsUpdate } from "../../../zerops/hq/refusals.ts";

export type TakeOverWrites = Pick<HqApi, "takeOver">;

const UPDATE_HQ = hqNeedsUpdate("take over a member's tokens");

export function makeTakeOverExecutor(options: {
  readonly api: TakeOverWrites;
  readonly current: () => boolean;
}): OperationExecutor {
  const refused = (message: string) => ({ outcome: "definitive-refusal" as const, message });
  return {
    isCurrent: options.current,
    submit: (requestId, intent) =>
      Effect.gen(function* () {
        if (!options.current())
          return yield* Effect.fail(refused("This Zerops sign-in has ended."));
        if (intent.kind !== "take-over-token")
          return yield* Effect.fail(refused("This action is unavailable."));
        const { takeOver } = options.api;
        if (takeOver === undefined) return yield* Effect.fail(refused(UPDATE_HQ));
        const result = yield* Effect.tryPromise({
          try: () => takeOver(intent.userId, intent.tokenId, intent.ownerUserId),
          catch: (cause) =>
            cause instanceof HqError && cause.kind === "refused"
              ? refused(cause.message)
              : {
                  outcome: "uncertain-acceptance" as const,
                  message: "HQ may have taken this change. Check it before trying again.",
                },
        });
        if (!options.current())
          return yield* Effect.fail({
            outcome: "uncertain-acceptance",
            message: "The account changed before HQ answered.",
          } as const);
        return {
          requestId,
          operationId: requestId,
          executor: "hq",
          handles: [intent.tokenId],
          affected: [],
          acceptance: { kind: "accepted", result },
          outcome: { kind: "succeeded", evidence: "HQ answered this change." },
        };
      }),
  };
}
