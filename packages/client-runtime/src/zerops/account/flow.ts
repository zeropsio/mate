/**
 * The project flow's half of the post-grant stage (DESIGN §4.6, §4.7, §5): how the account runtime
 * feeds the stores it built — the Gitea sessions, the forge store, the flow's command attempts
 * and the deployment store — and what it hands surfaces.
 *
 * - The sessions and the forge hear the tab from the account's signals (§6.4): a hidden tab
 *   starts no forge read, a page shown again runs what came due, a visible wake tries every wait
 *   again and re-reads what is old, and the network coming back tries the sessions again.
 * - The forge answers `forge-*` invalidations and the deployment store `deployment` ones (§6.2);
 *   a verb's settlement sends its own through the account's bus.
 * - The deployment store follows the data runtime's service listings and, holding the project's
 *   activity demand while a stop is shown, its running processes; a Mate's envelope names a
 *   service by hostname, which the account's inventory resolves.
 *
 * The stores are constructed by the account runtime alone (§7.2 rule 6); this module only wires
 * them. The forge stands on a host that gives it ports — the web; a host without Gitea surfaces
 * builds none.
 */
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { Instant } from "../data/access/grant.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type { ProjectRef } from "../data/types.ts";
import type { DeploymentStorePorts } from "../flow/deploymentStore.ts";
import type { EnvelopeServices } from "../flow/envelopeInvalidations.ts";
import type { FlowCommandPorts, FlowCommands } from "../flow/flowCommands.ts";
import type { ForgeInvalidation, ForgeStore, ForgeStorePorts } from "../forge/forgeStore.ts";
import type { GiteaSessions, GiteaSessionsPorts } from "../forge/giteaSession.ts";
import type { Invalidation, InvalidationBus } from "../knowledge/invalidation.ts";
import type { PlatformSignal, PlatformSignals } from "../knowledge/signals.ts";

/** What the forge reaches Gitea, its broker and the tab's time through. */
export interface AccountForgePorts {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => Instant;
  readonly random: () => number;
  /** Tells one throwaway apart from another minted in the same second. */
  readonly nonce: () => string;
  /** Arms a timer; the returned function disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

/** The person's Gitea, as surfaces read it and act on it. */
export interface AccountForge {
  readonly sessions: GiteaSessions;
  readonly store: ForgeStore;
  readonly commands: FlowCommands;
}

export interface ForgeWiring {
  readonly sessionPorts: GiteaSessionsPorts;
  readonly storePorts: (sessions: GiteaSessions) => ForgeStorePorts;
  readonly commandPorts: (sessions: GiteaSessions) => FlowCommandPorts;
  readonly start: (forge: AccountForge) => ForgeStage;
}

/** The forge as the account runtime drives it. */
export interface ForgeStage {
  readonly forge: AccountForge;
  readonly hear: (signal: PlatformSignal) => void;
  readonly invalidate: (invalidation: ForgeInvalidation) => void;
  readonly shows: (invalidation: ForgeInvalidation) => boolean;
  /** Forgets every Gitea token first, then ends the stores (§5 L9). */
  readonly dispose: () => void;
}

export function makeForgeWiring(options: {
  readonly ports: AccountForgePorts;
  readonly signals: PlatformSignals;
  readonly invalidations: InvalidationBus;
  /** The account's services, which the bus runs with. */
  readonly services: Context.Context<never>;
}): ForgeWiring {
  const { ports, signals, invalidations } = options;
  const run = Effect.runForkWith(options.services);
  return {
    sessionPorts: { ...ports, visible: () => !signals.hidden() },
    storePorts: (sessions) => ({
      now: ports.now,
      random: ports.random,
      setTimer: ports.setTimer,
      sessions,
    }),
    commandPorts: (sessions) => ({
      capability: sessions.capability,
      subscribe: sessions.subscribe,
      clientFor: (origin) => sessions.clientFor(origin),
      invalidate: (invalidation: Invalidation) => {
        run(invalidations.invalidate(invalidation));
      },
      setTimer: ports.setTimer,
    }),
    start: (forge) => {
      const { sessions, store, commands } = forge;
      store.setVisible(!signals.hidden());
      return {
        forge,
        hear: (signal) => {
          switch (signal.type) {
            case "visibility":
              store.setVisible(!signal.hidden);
              // Shown again: what came due while hidden runs now; a visible wake says more.
              if (!signal.hidden) sessions.resume();
              return;
            case "network":
              if (signal.online) sessions.online();
              return;
            case "wake":
              if (signal.visible) {
                sessions.wake();
                store.wake();
              } else {
                sessions.resume();
              }
              return;
            case "restored":
              // The forge hears a restore through the visible wake that comes with it.
              return;
          }
        },
        invalidate: store.invalidate,
        shows: store.shows,
        dispose: () => {
          sessions.close();
          commands.dispose();
          store.dispose();
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
  return {
    services: (project: ProjectRef) => atomRegistry.get(data.reads.servicesOf(project)),
    processes: (project: ProjectRef) => atomRegistry.get(data.reads.runningProcessesOf(project)),
    follow: (project, changed) => {
      // The running processes are read only while their demand is held; the services are the
      // account's inventory demand's.
      const lease = run(
        Effect.scoped(
          data.acquire({ kind: "project-activity", project }).pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.ignore),
      );
      const unsubscribes = [
        atomRegistry.subscribe(data.reads.servicesOf(project), changed),
        atomRegistry.subscribe(data.reads.runningProcessesOf(project), changed),
      ];
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
        run(Fiber.interrupt(lease));
      };
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
