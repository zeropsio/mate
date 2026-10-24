/**
 * The web's ports for the account runtime's Mate environments (DESIGN §7.3): the exchange through
 * the connection runtime, the connection catalog and its links, the probe through the data layer's
 * reads (`mateContainerReads`), and this tab's intents. Adapters only: every decision is the
 * runtime's.
 */
import {
  ConnectionBlockedError,
  EnvironmentRegistry,
  connectionAdmission,
  connectionCatalogDisplayUrl,
  type SupervisorConnectionState,
  type ZeropsMateConnectionRegistration,
} from "@t3tools/client-runtime/connection";
import { mateContainerReads } from "@t3tools/client-runtime/data";
import type {
  AccountEnvironmentPorts,
  DoorCredential,
  RegisteredEnvironment,
} from "@t3tools/client-runtime/zerops/account/runtime";
import { normalizeOrigin, zeropsMateBaseUrl } from "@t3tools/client-runtime/zerops/candidates";
import {
  automaticUpdateFrom,
  closeOffWordOf,
  systemExchangeClock,
  type CloseOffWord,
  type LinkPhase,
} from "@t3tools/client-runtime/zerops/environments";
import {
  descriptorFacts,
  exchangeAtMate,
  installMateRegistration,
} from "@t3tools/client-runtime/zerops/identityExchange";
import { createRuntimeCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { appBasePath } from "~/basePath";
import { environmentCatalog } from "~/connection/catalog";
import { connectionAtomRuntime } from "~/connection/runtime";
import { environmentIdFromAddress } from "~/routes/-environmentRoute";
import { serverEnvironment } from "~/state/server";
import { hqMatesAtom, hqNavigationAtom, hqProjectOf } from "~/state/zerops";

import { accountStorageKey } from "./accountLifetime";
import { mateDescriptors } from "./mateDescriptors";
import { closeOffPendingProjects } from "./matePress";

// ── The exchange, through the connection runtime ─────────────────────────────────────────────

/** Registers a Mate the exchange accepted; one already registered at the same place stays. */
const installCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:install-mate-registration",
  execute: installMateRegistration,
});

const retryLinkCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:retry-link",
  execute: (environmentId: EnvironmentId) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.retryNow(environmentId))),
});

const parkCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:park",
  execute: (environmentId: EnvironmentId) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.park(environmentId))),
});

const unparkCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:unpark",
  execute: (environmentId: EnvironmentId) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.unpark(environmentId))),
});

const quiet = { reportFailure: false } as const;

const servedApp = () => ({ origin: window.location.origin, basePath: appBasePath() });

/** An accepted registration, installed through the connection registry. */
function mateCredential(
  registry: AtomRegistry.AtomRegistry,
  registration: ZeropsMateConnectionRegistration,
): DoorCredential {
  return {
    install: async () => {
      const result = await runAtomCommand(registry, installCommand, registration, quiet);
      return result._tag === "Failure" ? { ok: false } : { ok: true };
    },
  };
}

// ── The catalog and its links ────────────────────────────────────────────────────────────────

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

/** Region L as the supervisor publishes it; null for a block that names no reason. */
export function linkPhaseOf(state: SupervisorConnectionState): LinkPhase | null {
  const unavailable =
    state.lastFailure?.reason === "remote-unavailable"
      ? { unavailableReason: state.lastFailure.detail }
      : state.lastFailure?.reason === "mate-not-linked"
        ? { unavailableReason: state.lastFailure.detail, noLink: true as const }
        : {};
  switch (state.phase) {
    case "available":
      return { phase: "idle" };
    case "offline":
      return { phase: "offline" };
    case "connecting":
      return { phase: "connecting", ...unavailable };
    case "connected":
      return { phase: "connected" };
    case "backoff":
      return { phase: "backoff", retryAtMs: state.retryAt, ...unavailable };
    case "blocked":
      return isConnectionBlockedError(state.lastFailure)
        ? {
            phase: "blocked",
            reason: state.lastFailure.reason,
            ...(state.lastFailure.chiefOwnerName === undefined
              ? {}
              : { chiefOwnerName: state.lastFailure.chiefOwnerName }),
          }
        : null;
  }
}

/**
 * HQ's word on which Mates' projects are closed off, from its structure as this tab holds it —
 * HQ's answer now, or what was last known of it (`closeOffWordOf`). None while nothing is known.
 */
export function closeOffPort(
  registry: AtomRegistry.AtomRegistry,
): AccountEnvironmentPorts["closeOff"] {
  let last: { readonly view: unknown; readonly word: CloseOffWord } | null = null;
  return {
    read: () => {
      const view = registry.get(hqNavigationAtom);
      if (view.orgId === null || view.structure === null) return null;
      if (last?.view !== view) {
        last = { view, word: closeOffWordOf(view.orgId, view.structure, view.live) };
      }
      return last.word;
    },
    subscribe: (listener) => registry.subscribe(hqNavigationAtom, listener),
  };
}

/**
 * The catalog's environments, and every publication of each one's link: a repeated rejection is
 * counted by the runtime, never coalesced here.
 */
function catalogPort(registry: AtomRegistry.AtomRegistry): AccountEnvironmentPorts["catalog"] {
  return {
    listen: (listener) => {
      const links = new Map<EnvironmentId, () => void>();
      const stopCatalog = registry.subscribe(
        environmentCatalog.catalogValueAtom,
        ({ entries }) => {
          const registered: Array<RegisteredEnvironment> = [];
          for (const [environmentId, entry] of entries) {
            const url = connectionCatalogDisplayUrl(entry);
            registered.push({ environmentId, origin: url === null ? null : normalizeOrigin(url) });
          }
          for (const [environmentId, stop] of links) {
            if (entries.has(environmentId)) continue;
            links.delete(environmentId);
            stop();
          }
          for (const environmentId of entries.keys()) {
            if (links.has(environmentId)) continue;
            const stopLink = registry.subscribe(
              environmentCatalog.stateAtom(environmentId),
              (result) => {
                const state = Option.getOrNull(AsyncResult.value(result));
                const phase = state === null ? null : linkPhaseOf(state);
                if (phase !== null) listener.link(environmentId, phase);
              },
              { immediate: true },
            );
            // Its server's word on an automatic update, as last said: an unread config says none.
            let underway: string | null = null;
            const stopUpdate = registry.subscribe(
              serverEnvironment.configValueAtom(environmentId),
              (config) => {
                if (config === null) return;
                const from = automaticUpdateFrom(config.environment.update);
                if (from === underway) return;
                underway = from;
                listener.updateUnderway(environmentId, from);
              },
              { immediate: true },
            );
            links.set(environmentId, () => {
              stopLink();
              stopUpdate();
            });
          }
          listener.environments(registered);
        },
        { immediate: true },
      );
      return () => {
        stopCatalog();
        for (const stop of links.values()) stop();
        links.clear();
      };
    },
  };
}

// ── This account's storage ───────────────────────────────────────────────────────────────────

/** This tab's container intents, under the account's key (C8); unreadable storage keeps none. */
const intentStorage: AccountEnvironmentPorts["intents"] = {
  read: () => {
    const key = accountStorageKey("container-intents.v1");
    try {
      return key === null ? null : window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (value) => {
    const key = accountStorageKey("container-intents.v1");
    if (key === null) return;
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      // A storage policy that refuses the write leaves the intent in memory only.
    }
  },
};

// ── The ports ────────────────────────────────────────────────────────────────────────────────

/**
 * HQ's index of the Mates the reader observes (`hqMatesAtom`): the project whose Mate serves an
 * environment, for a route or an action no record or descriptor names yet.
 */
export function hqIndexPort(
  registry: AtomRegistry.AtomRegistry,
): NonNullable<AccountEnvironmentPorts["hqIndex"]> {
  return {
    projectOf: (environmentId) => hqProjectOf(registry.get(hqMatesAtom), environmentId),
    // Read once as it mounts, so the listener hears HQ's next word, not the atom's own first read.
    subscribe: (listener) => {
      let mounted = false;
      const stop = registry.subscribe(
        hqMatesAtom,
        () => {
          if (mounted) listener();
        },
        { immediate: true },
      );
      mounted = true;
      return stop;
    },
  };
}

/**
 * The Mate environments' ports on the web, for one account epoch: `registry` is the atom registry
 * the connection runtime publishes to.
 */
export function webEnvironmentPorts(registry: AtomRegistry.AtomRegistry): AccountEnvironmentPorts {
  return {
    clock: systemExchangeClock,
    door: {
      exchange: async (request) => {
        const answer = await exchangeAtMate(
          {
            readDescriptor: (httpBaseUrl) =>
              mateDescriptors.descriptor(httpBaseUrl, request.signal),
          },
          request.origin,
          {
            reason: request.reason,
            orgId: request.organizationId,
            projectId: request.projectId,
            servedApp: servedApp(),
          },
        );
        return answer.ok
          ? { ...answer, credential: mateCredential(registry, answer.credential) }
          : answer;
      },
      readDescriptor: async (origin, signal) =>
        descriptorFacts(
          await mateDescriptors.descriptor(zeropsMateBaseUrl(origin, servedApp()), signal),
        ),
      retryLink: (environmentId) => {
        void runAtomCommand(registry, retryLinkCommand, environmentId, quiet);
      },
      remove: (environmentId) => {
        void runAtomCommand(registry, environmentCatalog.remove, environmentId, quiet);
      },
      park: (environmentId) => {
        void runAtomCommand(registry, parkCommand, environmentId, quiet);
      },
      unpark: (environmentId) => {
        void runAtomCommand(registry, unparkCommand, environmentId, quiet);
      },
    },
    ...mateContainerReads(mateDescriptors.read),
    intents: intentStorage,
    catalog: catalogPort(registry),
    route: () => {
      const environmentId = environmentIdFromAddress(window.location.pathname, appBasePath());
      return environmentId === null ? null : EnvironmentId.make(environmentId);
    },
    admission: connectionAdmission,
    hqIndex: hqIndexPort(registry),
    // Nobody is let into a Mate before its project is closed off: HQ's word, and where HQ says
    // nothing, what this browser's own presses know.
    closeOff: closeOffPort(registry),
    closeOffPending: closeOffPendingProjects,
  };
}
