/**
 * Zerops writes to one service, each answered as its end (`answeredReceipt`).
 *
 * @module data/operations/executors/serviceWrites
 */
import * as Effect from "effect/Effect";

import type { OperationReceipt } from "../../model.ts";
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
      ({ processId }): OperationReceipt =>
        processId === undefined
          ? answeredReceipt(requestId, { family: "service", id: intent.serviceId })
          : {
              requestId,
              operationId: processId,
              executor: "zerops",
              affected: [{ family: "process", id: processId }],
              handles: [processId],
              acceptance: { kind: "accepted" },
              outcome: { kind: "pending" },
            },
    );
}

export function enableZeropsMateExecutor(platform: {
  readonly enableZeropsMate: (serviceId: string) => Promise<void>;
}) {
  return (requestId: string, intent: IntentOf<"enable-zerops-mate">) =>
    Effect.as(
      verb(() => platform.enableZeropsMate(intent.serviceId)),
      answeredReceipt(requestId, { family: "service", id: intent.serviceId }),
    );
}
