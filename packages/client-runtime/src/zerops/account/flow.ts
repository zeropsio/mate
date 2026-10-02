/**
 * The project flow's half of the post-grant stage (DESIGN §4.6, §4.7, §5): how the account runtime
 * feeds the stores it built — the Gitea sessions and the deployment store — and what it hands
 * surfaces.
 *
 * - The sessions hear the tab from the account's signals (§6.4): a page shown again runs what came
 *   due, a visible wake tries every wait again, and the network coming back tries them again.
 * - The deployment store answers `deployment` invalidations (§6.2).
 * - The deployment store follows the data runtime's service listings and, holding the project's
 *   activity demand while a stop is shown, its running processes; it reads a service directly
 *   through the account's cells when a push leaves its active version unstated (A14). A
 *   Mate's envelope names a service by hostname, which the account's inventory resolves.
 *
 * The stores are constructed by the account runtime alone (§7.2 rule 6); this module only wires
 * them. The Gitea sessions stand on a host that gives them ports — the web; a host without Gitea
 * surfaces builds none.
 */
import type * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { Instant } from "../data/access/grant.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type { ProjectRef } from "../data/types.ts";
import type { DeploymentStorePorts } from "../flow/deploymentStore.ts";
import type { EnvelopeServices } from "../flow/envelopeInvalidations.ts";
import type { GiteaSessions, GiteaSessionsPorts } from "../forge/giteaSession.ts";
import type { PlatformSignal, PlatformSignals } from "../knowledge/signals.ts";

/** What the Gitea sessions reach Gitea, its broker and the tab's time through. */
export interface AccountForgePorts {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => Instant;
  readonly random: () => number;
  /** Tells one throwaway apart from another minted in the same second. */
  readonly nonce: () => string;
  /** Arms a timer; the returned function disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

/** The person's Gitea, as surfaces read it: their sessions. */
export interface AccountForge {
  readonly sessions: GiteaSessions;
}

export interface ForgeWiring {
  readonly sessionPorts: GiteaSessionsPorts;
  readonly start: (forge: AccountForge) => ForgeStage;
}

/** The Gitea sessions as the account runtime drives them. */
export interface ForgeStage {
  readonly forge: AccountForge;
  readonly hear: (signal: PlatformSignal) => void;
  /** Forgets every Gitea token (§5 L9). */
  readonly dispose: () => void;
}

export function makeForgeWiring(options: {
  readonly ports: AccountForgePorts;
  readonly signals: PlatformSignals;
}): ForgeWiring {
  const { ports, signals } = options;
  return {
    sessionPorts: { ...ports, visible: () => !signals.hidden() },
    start: (forge) => {
      const { sessions } = forge;
      return {
        forge,
        hear: (signal) => {
          switch (signal.type) {
            case "visibility":
              // Shown again: what came due while hidden runs now; a visible wake says more.
              if (!signal.hidden) sessions.resume();
              return;
            case "network":
              if (signal.online) sessions.online();
              return;
            case "wake":
              if (signal.visible) sessions.wake();
              else sessions.resume();
              return;
            case "restored":
              // The sessions hear a restore through the visible wake that comes with it.
              return;
          }
        },
        dispose: () => {
          sessions.close();
        },
      };
    },
  };
}

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
      // The running processes are read only while their demand is held; the services are the
      // account's inventory demand's. A demand the platform refuses is never read: the store
      // hears why, so the stop fails what it could not prove.
      const lease = run(
        Effect.scoped(
          data.acquire({ kind: "project-activity", project }).pipe(Effect.andThen(Effect.never)),
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
    random: Math.random,
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
