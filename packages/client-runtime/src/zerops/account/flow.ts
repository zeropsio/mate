/**
 * The project flow's half of the post-grant stage (DESIGN §4.6, §4.7, §5): how the account runtime
 * feeds the deployment store it built, and what it hands surfaces.
 *
 * - The deployment store answers `deployment` invalidations (§6.2).
 * - The deployment store follows the data runtime's service listings and, holding the project's
 *   activity demand while a stop is shown, its running processes; it reads a service directly
 *   through the account's cells when a push leaves its active version unstated (A14). A
 *   Mate's envelope names a service by hostname, which the account's inventory resolves.
 *
 * The stores are constructed by the account runtime alone (§7.2 rule 6); this module only wires
 * them.
 */
import type * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type { ProjectRef } from "../data/types.ts";
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
  return {
    services: (project: ProjectRef) => atomRegistry.get(data.reads.servicesOf(project)),
    processes: (project: ProjectRef) => atomRegistry.get(data.reads.runningProcessesOf(project)),
    follow: (project, changed, refused) => {
      // A visible stop owns both listings. Navigation holds no project service demand (R7),
      // and an HQ-linked stop may not have appeared in the organization's search yet.
      const lease = run(
        Effect.scoped(
          data.acquire({ kind: "project-topology", project }).pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.catch((error) => Effect.sync(() => refused(error.reason)))),
      );
      // What a pushed version runs comes from the organization's active versions and variables,
      // which the account streams for its session: a stop reads nothing of its own for it (A14).
      // Read once, so the table's next change is one its subscription hears.
      atomRegistry.get(table);
      const unsubscribes = [
        atomRegistry.subscribe(data.reads.servicesOf(project), changed),
        atomRegistry.subscribe(data.reads.runningProcessesOf(project), changed),
        atomRegistry.subscribe(table, changed),
      ];
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
        run(Fiber.interrupt(lease));
      };
    },
    deployedVersion: (service) => atomRegistry.get(data.reads.deployedVersion(service)),
    nowMs: () => data.access.clock.currentTimeMillisUnsafe(),
    setTimer: (delayMs, fire) => {
      const timer = run(
        Effect.sleep(Duration.millis(delayMs)).pipe(Effect.andThen(Effect.sync(fire))),
      );
      return () => {
        timer.interruptUnsafe();
      };
    },
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
