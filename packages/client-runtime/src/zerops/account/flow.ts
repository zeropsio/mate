/**
 * The project flow's half of the post-grant stage (DESIGN §4.6, §4.7, §5): how the account runtime
 * feeds the deployment store it built, and what it hands surfaces.
 *
 * - The deployment store answers `deployment` invalidations (§6.2).
 * - Summary surfaces follow service listings and their embedded active deployments. Detail adds
 *   running processes and follows the account's version/variable table. A Mate's envelope names
 *   a service by hostname, which the account's inventory resolves.
 *
 * The stores are constructed by the account runtime alone (§7.2 rule 6); this module only wires
 * them.
 */
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { type ProjectRef } from "../data/types.ts";
import { accountReadsAtom, projectProcessesAtom } from "../../data/reads.ts";
import { processStatusOf, runningProcessesRead } from "./processBridge.ts";
import type { DeploymentStorePorts } from "../flow/deploymentStore.ts";
import type { EnvelopeServices } from "../flow/envelopeInvalidations.ts";

/** The deployment store's ports over the data runtime's service and process listings. */
export function deploymentStorePorts(
  data: ManagedZeropsDataRuntime,
  atomRegistry: AtomRegistry.AtomRegistry,
  /** The account's services, which the activity demand runs with. */
  services: Context.Context<never>,
): DeploymentStorePorts {
  const run = Effect.runForkWith(services);
  /** The account's entity table: what services run changes with it (`deployedVersion.ts`). */
  const table = Atom.make((get) => get(data.stateAtom).table);
  /** The stops opened in detail, by project: only detail reads their running processes (R7). */
  const detail = new Map<string, number>();
  return {
    services: (project: ProjectRef) => atomRegistry.get(data.reads.servicesOf(project)),
    // Running processes are the account store's, through the in-transit bridge (`processBridge`).
    processes: (project: ProjectRef) =>
      (detail.get(project.projectId) ?? 0) === 0
        ? null
        : runningProcessesRead(project, atomRegistry.get(projectProcessesAtom(project.projectId))),
    follow: (project, changed, refused, scope) => {
      // The drawn stop owns service demand; only opened detail adds process demand (R7).
      // An HQ-linked stop may not have appeared in the organization's search yet.
      const lease = run(
        Effect.scoped(
          data
            .acquire({
              kind: scope === "detail" ? "project-topology" : "project-inventory",
              project,
            })
            .pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.catch((error) => Effect.sync(() => refused(error.reason)))),
      );
      if (scope === "detail")
        detail.set(project.projectId, (detail.get(project.projectId) ?? 0) + 1);
      // Facts another surface reads enrich this same entry, without summary acquiring them.
      // Read once, so the table's next change is one its subscription hears.
      atomRegistry.get(table);
      const unsubscribes = [
        atomRegistry.subscribe(data.reads.servicesOf(project), changed),
        atomRegistry.subscribe(projectProcessesAtom(project.projectId), changed),
        atomRegistry.subscribe(table, changed),
      ];
      return () => {
        if (scope === "detail")
          detail.set(project.projectId, (detail.get(project.projectId) ?? 1) - 1);
        for (const unsubscribe of unsubscribes) unsubscribe();
        run(Fiber.interrupt(lease));
      };
    },
    deployedVersion: (service) => atomRegistry.get(data.reads.deployedVersion(service)),
    // A process's status as the account's store holds it: how a build the store followed ended.
    buildStatus: (process) => {
      const account = atomRegistry.get(accountReadsAtom);
      return account === null
        ? undefined
        : processStatusOf(atomRegistry.get(account.data.fact("process", process.processId)));
    },
    nowMs: () => data.access.clock.currentTimeMillisUnsafe(),
  };
}

/** A Mate envelope's services, as the account's inventory holds them. */
export function envelopeServices(
  data: ManagedZeropsDataRuntime,
  atomRegistry: AtomRegistry.AtomRegistry,
): EnvelopeServices {
  return {
    serviceOf: (projectId, hostname) => {
      for (const record of atomRegistry.get(data.stateAtom).inventory.services.values()) {
        if (
          record.ref.project.projectId === projectId &&
          record.identity.knowledge === "observed" &&
          record.identity.fields.hostname === hostname
        ) {
          return record.ref;
        }
      }
      return null;
    },
  };
}
