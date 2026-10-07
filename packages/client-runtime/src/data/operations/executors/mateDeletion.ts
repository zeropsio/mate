/** Key cleanup reads by exact id before sending, and resolves a lost answer by source-proven absence. */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { zeropsFault } from "../../../zerops/data/zeropsWire.ts";
import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

export function retireMateKeyExecutor(platform: {
  readonly readIntegrationToken: (
    orgId: string,
    tokenId: string,
  ) => Promise<{ readonly id: string } | undefined>;
  readonly deleteIntegrationToken: (target: {
    readonly clientId: string;
    readonly tokenId: string;
  }) => Promise<void>;
}) {
  return (requestId: string, intent: IntentOf<"retire-mate-key">) =>
    Effect.gen(function* () {
      const read = () =>
        Effect.tryPromise({
          try: () => platform.readIntegrationToken(intent.orgId, intent.tokenId),
          catch: zeropsFault,
        });
      // This read precedes any delete: failure here is unsent, not uncertain acceptance.
      const key = yield* read();
      if (key !== undefined && key?.id !== intent.tokenId)
        return yield* Effect.fail({
          outcome: "transient" as const,
          message: "Zerops did not confirm the exact key's identity.",
        });
      const receipt = answeredReceipt(requestId, { family: "project", id: intent.projectId });
      if (key === undefined)
        return {
          ...receipt,
          handles: [intent.tokenId],
          outcome: {
            kind: "succeeded" as const,
            evidence: "Zerops confirms the exact key is absent.",
          },
        };
      const deleted = yield* Effect.result(
        verb(() =>
          platform.deleteIntegrationToken({ clientId: intent.orgId, tokenId: intent.tokenId }),
        ),
      );
      if (Result.isFailure(deleted)) {
        if (deleted.failure.outcome === "uncertain-acceptance") {
          const after = yield* Effect.result(read());
          if (Result.isSuccess(after) && after.success === undefined)
            return {
              ...receipt,
              handles: [intent.tokenId],
              outcome: {
                kind: "succeeded" as const,
                evidence: "Zerops confirms the exact key is absent.",
              },
            };
        }
        return yield* Effect.fail(deleted.failure);
      }
      return { ...receipt, handles: [intent.tokenId] };
    });
}
