/**
 * A Mate's container restart, at Zerops: one restart, answered with its process as the
 * operation's handle.
 *
 * @module data/operations/executors/mateRestart
 */
import * as Effect from "effect/Effect";

import type { OperationReceipt } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { UncertainAcceptance } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { verb } from "./write.ts";

/** Zerops as the owner of a Mate's restart. */
export function mateRestartOwner(platform: {
  readonly restartService: (
    serviceId: string,
  ) => Promise<{ readonly processId?: string | undefined }>;
}) {
  return {
    submit: (
      requestId: string,
      intent: IntentOf<"mate-restart">,
    ): Effect.Effect<OperationReceipt, StreamFault | UncertainAcceptance> =>
      Effect.map(
        verb(() => platform.restartService(intent.serviceId)),
        ({ processId }) => ({
          requestId,
          operationId: processId ?? requestId,
          executor: "zerops",
          affected: processId === undefined ? [] : [{ family: "process", id: processId }],
          handles: processId === undefined ? [] : [processId],
          acceptance: { kind: "accepted" },
          outcome: { kind: "pending" },
        }),
      ),
  };
}
