/**
 * A creation of services (`create-services`) as its card reads it: where the operation stands, and
 * when Zerops took it — what its elapsed time counts from. Read from the operation's own record,
 * so every surface that follows one says the same.
 *
 * @module data/projections/serviceCreation
 */
import { operationResult } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { operationProgress, type OperationProgress } from "./operation.ts";

export interface ServiceCreation {
  readonly progress: OperationProgress;
  /** When Zerops took the import, by this client's clock; `undefined` before it answered. */
  readonly acceptedAtMs: number | undefined;
}

export const serviceCreation: Projection<string, ServiceCreation> = {
  name: "serviceCreation",
  keyOf: (requestId) => requestId,
  equals: sameValue,
  derive: (read, requestId) => ({
    progress: operationProgress.derive(read, requestId),
    acceptedAtMs: operationResult(read.operation(requestId), "create-services")?.acceptedAtMs,
  }),
};
