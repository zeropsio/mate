/**
 * One write to one vault, at Zerops: a Shared value added, updated or removed
 * (`stack.updateProjectEnvs`), or a service's own (`stack.updateUserData`). Its process is the
 * operation's handle: its row reflects it and its terminal status ends it. The new value reaches
 * the vault through the variables' own registrations; what it means for the services that read it
 * is `vaultImpact`. A write's value is never put in a reason, a receipt or a log.
 *
 * @module data/operations/vaultWrite
 */
import type { VaultScopeRef, VaultWrite } from "../projections/vaultModel.ts";
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, runningIn, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "vault-write": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly scope: VaultScopeRef;
      readonly write: VaultWrite;
    };
  }
}

/** The process a write to a vault runs as. */
export const vaultWriteAction = (scope: VaultScopeRef): string =>
  scope.kind === "shared" ? "stack.updateProjectEnvs" : "stack.updateUserData";

export const vaultWrite: OperationKind<"vault-write"> = {
  kind: "vault-write",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, intent, receipt) =>
    settledByProcess(
      read,
      receipt,
      (process) => `Saving ${intent.write.key} ended ${process.status}.`,
    ),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: a variables write running for this very vault — the project's (whose
  // process names no service), or this service's.
  effectHandles: (read, { projectId, scope }) =>
    runningIn(
      read,
      projectId,
      (process) =>
        process.actionName === vaultWriteAction(scope) &&
        (scope.kind === "shared" || process.serviceStackIds.includes(scope.serviceId)),
    ),
};
