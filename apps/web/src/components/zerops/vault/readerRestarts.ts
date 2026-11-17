/**
 * The restarts after a vault change: a running process keeps the environment it booted with, so
 * every place Mate writes a value — a Mate's proposal, its ask for a value, the person's own Vault
 * edits — restarts the running services that read it, one restart per service, one after another,
 * as the person's own `service-restart` operation. A service that runs nothing is named instead:
 * it reads the value when it next starts. A failed restart stops there, so the card can try the
 * rest again or finish without it.
 */
import type { VaultRestarts } from "@t3tools/client-runtime/data";

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

/** Restarts each service in turn as the person; stops at the first Zerops refuses. */
export async function restartInTurn(
  run: Run,
  project: { readonly orgId: string; readonly projectId: string },
  services: ReadonlyArray<Service>,
): Promise<RestartsEnded> {
  const restarted: Service[] = [];
  for (const [at, service] of services.entries()) {
    const outcome = await run({
      kind: "service-restart",
      orgId: project.orgId,
      projectId: project.projectId,
      serviceId: service.serviceId,
    });
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
): string | null {
  const parts: string[] = [];
  if (restarted.length > 0) parts.push(`${joinNames(hostnames(restarted))} restarted`);
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
