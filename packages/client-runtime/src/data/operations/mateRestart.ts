/**
 * Restarting a Mate's container, at Zerops. The platform refuses to restart a service that has
 * failed (`serviceStackIsFailed`, measured on three Mates after a platform outage, 2026-10-01), so
 * a failed container is stopped and, once its stop's process has ended, started. The restart's
 * (or the start's) process is the operation's handle: its row in the process family reflects it,
 * and its terminal status ends it. No clock waits out a stop or decides an end.
 *
 * @module data/operations/mateRestart
 */
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/reactivity";

import { linkKeys } from "../model.ts";
import { sameValue } from "../projections/equal.ts";
import { UNOBSERVED_PHASES } from "../projections/operationEnd.ts";
import type { AccountStore, Projection } from "../store.ts";
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, runningIn, settledByProcess } from "./processEnd.ts";

/** How a container is brought back: restarted, or — failed — stopped, then started. */
type RestartWay = "restart" | "stop-then-start";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "mate-restart": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
      readonly way: RestartWay;
      /** The tool restart this deliberate retry follows; ties its receipt to that card. */
      readonly sourceProcessId?: string;
    };
  }
}

const SERVICE_STATUS_PREFIX = "SERVICE_";

/** The way back for a container in the status the listing reads for it. */
export function restartWay(status: string | undefined): RestartWay {
  const normalized = status?.startsWith(SERVICE_STATUS_PREFIX)
    ? status.slice(SERVICE_STATUS_PREFIX.length)
    : status;
  return normalized !== undefined && normalized.endsWith("FAILED") ? "stop-then-start" : "restart";
}

/** The action of the way's last verb: the process that brings the container back. */
const lastVerbOf = (way: RestartWay) => (way === "restart" ? "stack.restart" : "stack.start");

export const mateRestart: OperationKind<"mate-restart"> = {
  kind: "mate-restart",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(read, receipt, (process) => `The restart ended ${process.status}.`),
  // Its process is in its project's history: held until it ends, an end met while away is read.
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: the way's last verb running for this very service — never its stop,
  // which alone would end the operation with the container stopped.
  effectHandles: (read, intent) =>
    runningIn(
      read,
      intent.projectId,
      (process) =>
        process.actionName === lastVerbOf(intent.way) &&
        process.serviceStackIds.includes(intent.serviceId),
    ),
};

type StopWatch = "waiting" | "ended" | "unobservable";

/**
 * A stop's process as its organization's link observes it: ended (a terminal row, or no longer
 * counted as running), or no longer observable — the link paused (the organization or the account
 * left) or refused — or still to be seen.
 */
const stopWatch: Projection<
  { readonly orgId: string; readonly projectId: string; readonly processId: string },
  StopWatch
> = {
  name: "stopWatch",
  keyOf: ({ orgId, projectId, processId }) => `${orgId}:${projectId}:${processId}`,
  equals: sameValue,
  derive: (read, { orgId, projectId, processId }) => {
    if (
      read.fact("process", processId).kind === "known" &&
      !read.index("running", projectId).has(processId)
    )
      return "ended";
    return UNOBSERVED_PHASES.has(read.stream(linkKeys.zerops(orgId)).phase)
      ? "unobservable"
      : "waiting";
  },
};

/** Waits, on the store's facts alone, until a stop has ended or can no longer be observed. */
export const untilStopSettles =
  (store: AccountStore, registry: AtomRegistry.AtomRegistry) =>
  (orgId: string, projectId: string, processId: string): Effect.Effect<"ended" | "unobservable"> =>
    Effect.callback<"ended" | "unobservable">((resume) => {
      const atom = store.data.project(stopWatch, { orgId, projectId, processId });
      let cancel: () => void = () => {};
      cancel = registry.subscribe(
        atom,
        (watch) => {
          if (watch === "waiting") return;
          resume(Effect.succeed(watch));
          cancel();
        },
        { immediate: true },
      );
      return Effect.sync(() => cancel());
    });
