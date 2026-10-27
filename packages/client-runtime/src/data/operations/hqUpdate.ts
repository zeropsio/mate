/**
 * HQ's update, at Zerops: the Core this app carries deployed to HQ's `hq` service with the
 * person's own token, as a birth does (`zerops/hq/update.ts` says where HQ stands). Its build's
 * process is the operation's handle; that process's end is the update's, read in HQ's project
 * history while it runs. No clock decides that an update took too long.
 *
 * @module data/operations/hqUpdate
 */
import { hqCoreVersionName } from "../../zerops/hq/birth.ts";
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, runningIn, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "hq-update": {
      readonly orgId: string;
      /** HQ's project. */
      readonly projectId: string;
      /** Its `hq` service, which the carried Core is deployed to. */
      readonly serviceId: string;
      /** The Core it runs now, as a failed update says it still does; empty where unnamed. */
      readonly running: string;
      /** The reviewed Core. An older birth caller may not name it; no build is adopted then. */
      readonly carried?: string;
    };
  }
  interface OperationResults {
    /** The build's process, which ends it. */
    readonly "hq-update": { readonly processId: string };
  }
}

const DEPLOY_ACTIONS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);

export const hqUpdate: OperationKind<"hq-update"> = {
  kind: "hq-update",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, intent, receipt) =>
    settledByProcess(
      read,
      receipt,
      (process) =>
        `HQ's update ${process.status.toLowerCase()}. HQ still runs ${intent.running || "its Core"}.`,
    ),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: only a build of the exact reviewed Core on HQ's service.
  effectHandles: (read, intent) =>
    intent.carried === undefined
      ? []
      : runningIn(
          read,
          intent.projectId,
          (process) =>
            DEPLOY_ACTIONS.has(process.actionName) &&
            process.serviceStackIds.includes(intent.serviceId) &&
            process.appVersion?.name === hqCoreVersionName(intent.carried!),
        ),
  adoptedResult: (processId) => ({ processId }),
};
