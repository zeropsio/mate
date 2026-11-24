/**
 * Restarting a Mate's container, at Zerops: one restart, whose process is the operation's handle:
 * its row in the process family reflects it, and its terminal status ends it. The platform refuses
 * to restart a service that has failed (`serviceStackIsFailed`, measured on three Mates after a
 * platform outage, 2026-10-01), so a failed Mate is brought back by HQ instead (`restartWay`
 * `"hq"`: the account's `start-mate-restart`), which stops it and starts it on the person's token;
 * so is one HQ offers a restart of (its project's `restart_mate`: it stopped answering while Zerops
 * shows it running).
 *
 * @module data/operations/mateRestart
 */
import type { OperationKind } from "./kind.ts";
import {
  effectsByProcess,
  historyHolding,
  reflectedByProcess,
  settledByProcess,
} from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "mate-restart": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
      /** The tool restart this deliberate retry follows; ties its receipt to that card. */
      readonly sourceProcessId?: string;
    };
  }
}

const SERVICE_STATUS_PREFIX = "SERVICE_";

/** Whether a Mate's container is in a failed status, as the listing reads it. */
export function containerFailed(status: string | undefined): boolean {
  const normalized = status?.startsWith(SERVICE_STATUS_PREFIX)
    ? status.slice(SERVICE_STATUS_PREFIX.length)
    : status;
  return normalized !== undefined && normalized.endsWith("FAILED");
}

/**
 * How a Mate is restarted: by HQ where HQ offers its restart (`restartOffered`) or its container
 * failed, else at Zerops.
 */
export function restartWay(status: string | undefined, offered: boolean): "restart" | "hq" {
  return offered || containerFailed(status) ? "hq" : "restart";
}

export const mateRestart: OperationKind<"mate-restart"> = {
  kind: "mate-restart",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(read, receipt, (process) => `The restart ended ${process.status}.`),
  // Its process is in its project's history: held until it ends, an end met while away is read.
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: the restart's process for this very service, running or created since
  // the press.
  effectHandles: effectsByProcess,
};
