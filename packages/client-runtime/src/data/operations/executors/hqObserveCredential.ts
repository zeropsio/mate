/** Explicit person actions only; an uncertain authorization is never submitted again. */
import * as Effect from "effect/Effect";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import type { ObserveCredentialKey } from "../../families/hqObserveCredential.ts";
import type { OperationExecutor } from "../coordinator.ts";
export function makeObserveCredentialExecutor(options: {
  readonly api: Pick<HqApi, "authorizeObserveCredential" | "revokeObserveCredential">;
  readonly current: () => boolean;
  /** Orders metadata reads before the successful receipt is admitted to the account. */
  readonly acknowledged: (requestId: string, key: ObserveCredentialKey) => void;
}): OperationExecutor {
  return {
    isCurrent: options.current,
    submit: (requestId, intent) =>
      Effect.gen(function* () {
        if (
          !options.current() ||
          (intent.kind !== "authorize-observe-credential" &&
            intent.kind !== "revoke-observe-credential")
        )
          return yield* Effect.fail({
            outcome: "definitive-refusal",
            message: "Observe authorization is unavailable.",
          } as const);
        const call =
          intent.kind === "authorize-observe-credential"
            ? options.api.authorizeObserveCredential
            : options.api.revokeObserveCredential;
        if (call === undefined)
          return yield* Effect.fail({
            outcome: "definitive-refusal",
            message: "Update HQ to manage observe authorization.",
          } as const);
        const result = yield* Effect.tryPromise({
          try: () => call(intent.projectId),
          catch: (cause) =>
            cause instanceof HqError && cause.kind === "refused"
              ? { outcome: "definitive-refusal" as const, message: cause.message }
              : {
                  outcome: "uncertain-acceptance" as const,
                  message:
                    "HQ may have changed observe authorization. Read its current state; revoke it to remove access.",
                },
        });
        if (!options.current())
          return yield* Effect.fail({
            outcome: "uncertain-acceptance",
            message: "The account changed before HQ answered.",
          } as const);
        options.acknowledged(requestId, intent);
        return {
          requestId,
          operationId: requestId,
          executor: "hq",
          handles: [],
          affected: [],
          acceptance: { kind: "accepted", result },
          outcome: {
            kind: "succeeded",
            evidence: "HQ answered this observe authorization action.",
          },
        };
      }),
  };
}
