/**
 * Zerops writes to a project's vault and the restart that makes a value live, each answered with
 * its process (`processReceipt`). A write's value goes on the wire and nowhere else: a refusal says
 * the key and the platform's code, never what Zerops echoed of the content.
 *
 * @module data/operations/executors/vaultWrites
 */
import * as Effect from "effect/Effect";

import type { ZeropsVariableWrite } from "../../../zerops/api.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { UncertainAcceptance } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { processReceipt } from "./serviceWrites.ts";
import { verb } from "./write.ts";

type Answer = Promise<{ readonly processId: string | undefined }>;

export interface VaultPlatform {
  readonly addProjectVariable: (projectId: string, write: ZeropsVariableWrite) => Answer;
  readonly updateProjectVariable: (id: string, write: ZeropsVariableWrite) => Answer;
  readonly removeProjectVariable: (id: string) => Answer;
  readonly addServiceVariable: (serviceId: string, write: ZeropsVariableWrite) => Answer;
  readonly updateServiceVariable: (id: string, write: ZeropsVariableWrite) => Answer;
  readonly removeServiceVariable: (id: string) => Answer;
}

/** The send a vault write is. */
function sendOf(platform: VaultPlatform, intent: IntentOf<"vault-write">): () => Answer {
  const { scope, write } = intent;
  const shared = scope.kind === "shared";
  switch (write.kind) {
    case "add": {
      const body = { key: write.key, content: write.value, sensitive: write.sensitive };
      return shared
        ? () => platform.addProjectVariable(intent.projectId, body)
        : () => platform.addServiceVariable(scope.serviceId, body);
    }
    case "update": {
      const body = { key: write.key, content: write.value, sensitive: write.sensitive };
      return shared
        ? () => platform.updateProjectVariable(write.id, body)
        : () => platform.updateServiceVariable(write.id, body);
    }
    case "remove":
      return shared
        ? () => platform.removeProjectVariable(write.id)
        : () => platform.removeServiceVariable(write.id);
  }
}

/** The person's words for a refusal Zerops named by its code; `null` for one it did not. */
function refusalText(code: string | undefined, intent: IntentOf<"vault-write">): string | null {
  const { key } = intent.write;
  switch (code) {
    case "projectEnvDuplicateKey":
      return `${key} is already in Shared.`;
    case "userDataDuplicateKey":
      return `${key} is already in this service, as a value or in its zerops.yml.`;
    case "projectEnvKeyInvalid":
    case "userDataKeyInvalid":
      return `${key} is not a name Zerops takes: letters, digits and underscores.`;
    default:
      return null;
  }
}

/** A fault that never carries the write's value, whatever Zerops or the transport echoed. */
function withoutValue(
  fault: StreamFault | UncertainAcceptance,
  intent: IntentOf<"vault-write">,
): StreamFault | UncertainAcceptance {
  const named = refusalText(
    fault.outcome === "uncertain-acceptance" ? undefined : fault.code,
    intent,
  );
  if (named !== null) return { ...fault, message: named };
  const value = intent.write.kind === "remove" ? "" : intent.write.value;
  return value !== "" && fault.message.includes(value)
    ? { ...fault, message: `Zerops did not take ${intent.write.key}.` }
    : fault;
}

export function vaultWriteExecutor(platform: VaultPlatform) {
  return (requestId: string, intent: IntentOf<"vault-write">) =>
    verb(sendOf(platform, intent)).pipe(
      Effect.mapError((fault) => withoutValue(fault, intent)),
      Effect.map(({ processId }) =>
        processReceipt(
          requestId,
          intent.scope.kind === "shared"
            ? { family: "projectVariables", id: intent.projectId }
            : {
                family: "serviceVariable",
                id: intent.write.kind === "add" ? intent.scope.serviceId : intent.write.id,
              },
          processId,
        ),
      ),
    );
}

export function serviceRestartExecutor(platform: {
  readonly restartService: (serviceId: string) => Answer;
}) {
  return (requestId: string, intent: IntentOf<"service-restart">) =>
    Effect.map(
      verb(() => platform.restartService(intent.serviceId)),
      ({ processId }) =>
        processReceipt(requestId, { family: "service", id: intent.serviceId }, processId),
    );
}
