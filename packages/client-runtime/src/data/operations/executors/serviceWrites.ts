/**
 * Zerops writes to one service, each answered as its end (`answeredReceipt`).
 *
 * @module data/operations/executors/serviceWrites
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { OperationReceipt } from "../../model.ts";
import type { OwnerUnobservable } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

export function enableSubdomainAccessExecutor(platform: {
  readonly enableSubdomainAccess: (serviceId: string) => Promise<void>;
}) {
  return (requestId: string, intent: IntentOf<"enable-subdomain-access">) =>
    Effect.as(
      verb(() => platform.enableSubdomainAccess(intent.serviceId)),
      answeredReceipt(requestId, { family: "service", id: intent.serviceId }),
    );
}

export function startServiceExecutor(platform: {
  readonly startService: (serviceId: string) => Promise<{ readonly processId: string | undefined }>;
}) {
  return (requestId: string, intent: IntentOf<"start-service">) =>
    Effect.map(
      verb(() => platform.startService(intent.serviceId)),
      ({ processId }) => processReceipt(requestId, intent.serviceId, processId),
    );
}

/** The operation's receipt for the process a write answered with; with none, the answer ends it. */
const processReceipt = (
  requestId: string,
  serviceId: string,
  processId: string | undefined,
): OperationReceipt =>
  processId === undefined
    ? answeredReceipt(requestId, { family: "service", id: serviceId })
    : {
        requestId,
        operationId: processId,
        executor: "zerops",
        affected: [{ family: "process", id: processId }],
        handles: [processId],
        acceptance: { kind: "accepted" },
        outcome: { kind: "pending" },
      };

export function enableZeropsMateExecutor(platform: {
  readonly writeMateFlag: (serviceId: string) => Promise<void>;
  readonly restartService: (
    serviceId: string,
  ) => Promise<{ readonly processId: string | undefined }>;
}) {
  return (requestId: string, intent: IntentOf<"enable-zerops-mate">) =>
    Effect.gen(function* () {
      yield* verb(() => platform.writeMateFlag(intent.serviceId));
      // The flag landed: a restart not taken leaves it on, and the restart the person's to do.
      // Only a restart whose answer was lost stays uncertain.
      const restarted = yield* Effect.result(verb(() => platform.restartService(intent.serviceId)));
      if (Result.isSuccess(restarted))
        return processReceipt(requestId, intent.serviceId, restarted.success.processId);
      if (restarted.failure.outcome === "uncertain-acceptance")
        return yield* Effect.fail(restarted.failure);
      return {
        unobservable: { nextActor: "person", nextAction: "Restart the Mate", handles: [] },
      } satisfies OwnerUnobservable;
    });
}
