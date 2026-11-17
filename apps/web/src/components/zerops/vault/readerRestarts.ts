/**
 * The restarts after a vault change: a running process keeps the environment it booted with, so
 * every place Mate writes a value — a Mate's proposal, its ask for a value, the person's own Vault
 * edits — restarts the running services that read it, one restart per service, one after another,
 * as the person's own `service-restart` operation, one at a time per service: saves made while one
 * runs share one more after it. A service that runs nothing is named instead: it reads the value
 * when it next starts. A failed restart stops there, so the card can try the rest again or finish
 * without it.
 */
import type { VaultRestarts } from "@t3tools/client-runtime/data";
import { useSyncExternalStore } from "react";

import { joinNames } from "./vault.logic";
import type { VaultWriteOutcome } from "./VaultPanel";

type Service = VaultRestarts["restart"][number];

/** A service that did not restart after a value changed, and why. */
export interface NotRestarted {
  readonly hostname: string;
  readonly reason: string;
}

/** How restarts ended: the ones done, and the first that failed with the ones not tried after it. */
export interface RestartsEnded {
  readonly restarted: ReadonlyArray<Service>;
  readonly failed: (NotRestarted & { readonly left: ReadonlyArray<Service> }) | null;
}

/** Runs one account operation to its end (`useVaultWriter`'s `run`). */
type Run = (intent: {
  readonly kind: "service-restart";
  readonly orgId: string;
  readonly projectId: string;
  readonly serviceId: string;
}) => Promise<VaultWriteOutcome>;

type Project = { readonly orgId: string; readonly projectId: string };

/**
 * One service's restarts in this tab: the one under way, the one that follows it for the saves
 * made meanwhile (one, however many), and how the last ended — so a card drawn again, or another
 * card, sees a restart under way and a failure without restarting twice.
 */
interface Lane {
  inFlight: Promise<VaultWriteOutcome> | null;
  followUp: Promise<VaultWriteOutcome> | null;
  failure: NotRestarted | null;
}

const lanes = new Map<string, Lane>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version += 1;
  for (const listener of listeners) listener();
};
const laneKey = (projectId: string, serviceId: string) => `${projectId}/${serviceId}`;

/** One restart of a service, queued behind the one under way; saves meanwhile share one more. */
function restartOne(run: Run, project: Project, service: Service): Promise<VaultWriteOutcome> {
  const key = laneKey(project.projectId, service.serviceId);
  const lane = lanes.get(key) ?? { inFlight: null, followUp: null, failure: null };
  lanes.set(key, lane);
  if (lane.followUp !== null) return lane.followUp;
  const start = (): Promise<VaultWriteOutcome> => {
    const restart = run({
      kind: "service-restart",
      orgId: project.orgId,
      projectId: project.projectId,
      serviceId: service.serviceId,
    }).then(
      (outcome) => {
        lane.failure = outcome.ok
          ? null
          : { hostname: service.hostname, reason: outcome.message ?? "Zerops did not do it." };
        if (lane.inFlight === restart) lane.inFlight = null;
        changed();
        return outcome;
      },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : "Zerops did not do it.";
        lane.failure = { hostname: service.hostname, reason: message };
        if (lane.inFlight === restart) lane.inFlight = null;
        changed();
        return { ok: false, code: null, message } as const;
      },
    );
    lane.inFlight = restart;
    changed();
    return restart;
  };
  const before = lane.inFlight;
  if (before === null) return start();
  const followUp = before.then(() => {
    lane.followUp = null;
    return start();
  });
  lane.followUp = followUp;
  return followUp;
}

/** Whether this tab is restarting a service now, and how its last restart here failed. */
export function restartLane(
  projectId: string,
  serviceId: string,
): { readonly restarting: boolean; readonly failure: NotRestarted | null } {
  const lane = lanes.get(laneKey(projectId, serviceId));
  return { restarting: lane?.inFlight != null, failure: lane?.failure ?? null };
}

/** Redraws a caller when any restart in this tab starts or ends (`restartLane` reads it). */
export function useRestartLanes(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}

/** Restarts each service in turn as the person; stops at the first Zerops refuses. */
export async function restartInTurn(
  run: Run,
  project: Project,
  services: ReadonlyArray<Service>,
): Promise<RestartsEnded> {
  const restarted: Service[] = [];
  for (const [at, service] of services.entries()) {
    const outcome = await restartOne(run, project, service);
    if (!outcome.ok)
      return {
        restarted,
        failed: {
          hostname: service.hostname,
          reason: outcome.message ?? "Zerops did not do it.",
          left: services.slice(at),
        },
      };
    restarted.push(service);
  }
  return { restarted, failed: null };
}

const hostnames = (services: ReadonlyArray<Service | string>) =>
  services.map((service) => (typeof service === "string" ? service : service.hostname));

/** "app restarted · worker reads it when it next starts"; `null` where nothing reads it running. */
export function restartedWords(
  restarted: ReadonlyArray<Service | string>,
  notRunning: ReadonlyArray<Service | string>,
  deploying: ReadonlyArray<Service | string> = [],
): string | null {
  const parts: string[] = [];
  if (restarted.length > 0) parts.push(`${joinNames(hostnames(restarted))} restarted`);
  if (deploying.length > 0)
    parts.push(
      `${joinNames(hostnames(deploying))} ${deploying.length === 1 ? "starts" : "start"} with it after ${deploying.length === 1 ? "its deploy" : "their deploys"}`,
    );
  if (notRunning.length > 0)
    parts.push(
      `${joinNames(hostnames(notRunning))} ${notRunning.length === 1 ? "reads" : "read"} it when ${notRunning.length === 1 ? "it next starts" : "they next start"}`,
    );
  return parts.length === 0 ? null : parts.join(" · ");
}

/** While they run: "Restarting app and api…". */
export const restartingWords = (services: ReadonlyArray<Service | string>): string =>
  `Restarting ${joinNames(hostnames(services))}…`;

/** A restart that failed: "app didn't restart: <Zerops' words>". */
export const notRestartedWords = (failed: NotRestarted): string =>
  `${failed.hostname} didn't restart: ${failed.reason.replace(/\.$/u, "")}`;

/** Finished without the restart: what still runs the old value. */
export const unrestartedWords = (left: ReadonlyArray<Service | string>): string =>
  `${joinNames(hostnames(left))} ${left.length === 1 ? "runs" : "run"} the previous value until ${left.length === 1 ? "it restarts" : "they restart"}`;
