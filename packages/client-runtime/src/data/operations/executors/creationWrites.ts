/**
 * Creating a project's missing services at Zerops (`create-services`). Zerops keeps no request
 * ids; a lost answer is the coordinator's to resolve.
 *
 * @module data/operations/executors/creationWrites
 */
import * as Effect from "effect/Effect";

import type { ZeropsServiceImportResult } from "../../../zerops/api/service.ts";
import type { CreateServicesResult } from "../createServices.ts";
import type { OperationReceipt, OperationResult } from "../../model.ts";
import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

/** Done as Zerops answered, with what it answered where the kind declares a result. */
const done = (
  requestId: string,
  projectId: string,
  result: OperationResult | undefined,
): OperationReceipt => ({
  ...answeredReceipt(requestId, { family: "project", id: projectId }),
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
});

/**
 * Creating a project's missing services, followed to its end (`create-services`): Zerops' answer
 * names each service it began and the processes bringing it up, which the receipt holds as its
 * handles until each ended. An answer naming no process is its end.
 */
export function createServicesExecutor(platform: {
  readonly importServicesIntoProject: (
    projectId: string,
    yaml: string,
  ) => Promise<ZeropsServiceImportResult>;
  readonly nowMs: () => number;
}) {
  return (requestId: string, intent: IntentOf<"create-services">) =>
    Effect.map(
      verb(() => platform.importServicesIntoProject(intent.projectId, intent.yaml)),
      (answer): OperationReceipt => {
        const services = (answer.serviceStacks ?? []).map((stack) => ({
          hostname: stack.name,
          serviceId: stack.id,
          processIds: (stack.processes ?? []).map((process) => process.id),
        }));
        const result: CreateServicesResult = {
          acceptedAtMs: platform.nowMs(),
          services,
        };
        const processes = [...new Set(services.flatMap((service) => service.processIds))];
        const [first] = processes;
        if (first === undefined) return done(requestId, intent.projectId, result);
        return {
          requestId,
          operationId: first,
          executor: "zerops",
          affected: [
            { family: "project", id: intent.projectId },
            ...processes.map((id) => ({ family: "process" as const, id })),
          ],
          handles: processes,
          acceptance: { kind: "accepted", result },
          outcome: { kind: "pending" },
        };
      },
    );
}
