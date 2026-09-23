/**
 * The web's ports for the account runtime's Mate environments (DESIGN §7.3): the door through the
 * connection runtime, the connection catalog and its links, the probe over `fetch`, and this
 * account's storage. Adapters only: every decision is the runtime's.
 */
import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import {
  ConnectionBlockedError,
  EnvironmentRegistry,
  connectionCatalogDisplayUrl,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type {
  AccountEnvironmentPorts,
  DoorCredential,
  RegisteredEnvironment,
} from "@t3tools/client-runtime/zerops/account/runtime";
import { normalizeOrigin, zeropsMateBaseUrl } from "@t3tools/client-runtime/zerops/candidates";
import { readZeropsContainer } from "@t3tools/client-runtime/zerops/containerHealth";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import {
  REGISTRATION_RECORDS_KEY,
  systemExchangeClock,
  type LinkPhase,
} from "@t3tools/client-runtime/zerops/environments";
import {
  descriptorFacts,
  exchangeAtDoor,
  installDoorRegistration,
  prepareDoorRegistration,
  readDoorDescriptor,
} from "@t3tools/client-runtime/zerops/identityExchange";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";

import { appBasePath } from "~/basePath";
import { environmentCatalog } from "~/connection/catalog";
import { connectionAtomRuntime } from "~/connection/runtime";
import { randomUUID } from "~/lib/utils";

import { accountLocalStorage, accountStorageKey } from "./accountLifetime";
import { birthsForEnvironments } from "./zeropsBirths";

// ── The door, through the connection runtime ─────────────────────────────────────────────────

const doorScheduler = createAtomCommandScheduler();

const readDescriptorCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:read-door-descriptor",
  execute: readDoorDescriptor,
});

/**
 * The Zerops door. Single-flight on the container's base URL so two exchanges can never mint
 * two credentials for the same environment at once.
 */
const prepareCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:prepare-door-registration",
  scheduler: doorScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: { readonly httpBaseUrl: string }) => input.httpBaseUrl,
  },
  execute: prepareDoorRegistration,
});

const installCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:install-door-registration",
  execute: installDoorRegistration,
});

const retryLinkCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:retry-link",
  execute: (environmentId: EnvironmentId) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.retryNow(environmentId))),
});

const quiet = { reportFailure: false } as const;

const servedApp = () => ({ origin: window.location.origin, basePath: appBasePath() });

/** An accepted registration, installed through `registry.rotateCredential` or `register`. */
function doorCredential(
  registry: AtomRegistry.AtomRegistry,
  registration: BearerConnectionRegistration,
): DoorCredential {
  return {
    install: async () => {
      const result = await runAtomCommand(registry, installCommand, registration, quiet);
      return { ok: result._tag !== "Failure" };
    },
  };
}

// ── The catalog and its links ────────────────────────────────────────────────────────────────

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

/** Region L as the supervisor publishes it; null for a block that names no reason. */
export function linkPhaseOf(state: SupervisorConnectionState): LinkPhase | null {
  switch (state.phase) {
    case "available":
      return { phase: "idle" };
    case "offline":
      return { phase: "offline" };
    case "connecting":
      return { phase: "connecting" };
    case "connected":
      return { phase: "connected" };
    case "backoff":
      return { phase: "backoff", retryAtMs: state.retryAt };
    case "blocked":
      return isConnectionBlockedError(state.lastFailure)
        ? { phase: "blocked", reason: state.lastFailure.reason }
        : null;
  }
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
            links.set(
              environmentId,
              registry.subscribe(
                environmentCatalog.stateAtom(environmentId),
                (result) => {
                  const state = Option.getOrNull(AsyncResult.value(result));
                  const phase = state === null ? null : linkPhaseOf(state);
                  if (phase !== null) listener.link(environmentId, phase);
                },
                { immediate: true },
              ),
            );
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

/**
 * The account's records over its scoped `localStorage`, and another tab's write of them (§6.7).
 * A cleared storage names no key.
 */
export const recordsStorage: AccountEnvironmentPorts["records"] = {
  getItem: (key) => {
    try {
      return accountLocalStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      accountLocalStorage.setItem(key, value);
    } catch {
      // Records are personal context: a Mate this tab could not remember reconnects on demand.
    }
  },
  listen: (changed) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === accountStorageKey(REGISTRATION_RECORDS_KEY)) {
        changed();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
};

// ── The ports ────────────────────────────────────────────────────────────────────────────────

/**
 * The Mate environments' ports on the web, for one account epoch: `client` is the session's, and
 * `registry` the atom registry the connection runtime publishes to.
 */
export function webEnvironmentPorts(input: {
  readonly client: ZeropsApiClient;
  readonly registry: AtomRegistry.AtomRegistry;
}): AccountEnvironmentPorts {
  const { client, registry } = input;
  const descriptorAt = async (httpBaseUrl: string) => {
    const result = await runAtomCommand(registry, readDescriptorCommand, { httpBaseUrl }, quiet);
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  };
  return {
    clock: systemExchangeClock,
    door: {
      exchange: async (request) => {
        const answer = await exchangeAtDoor(
          {
            // The token is minted in the organization that lists the Mate's project.
            throwaway: client.session?.accessToken
              ? {
                  platform: zeropsThrowawayPlatform(client, request.signal),
                  clientId: request.organizationId,
                  projectId: request.projectId,
                  nonce: randomUUID(),
                }
              : null,
            readDescriptor: descriptorAt,
            prepare: (prepared) => runAtomCommand(registry, prepareCommand, prepared, quiet),
            environmentOf: (registration) => registration.target.environmentId,
          },
          request.origin,
          {
            reason: request.reason,
            expectedProjectId: request.projectId,
            servedApp: servedApp(),
          },
        );
        return answer.ok
          ? { ...answer, credential: doorCredential(registry, answer.credential) }
          : answer;
      },
      readDescriptor: async (origin) =>
        descriptorFacts(await descriptorAt(zeropsMateBaseUrl(origin, servedApp()))),
      retryLink: (environmentId) => {
        void runAtomCommand(registry, retryLinkCommand, environmentId, quiet);
      },
      remove: (environmentId) => {
        void runAtomCommand(registry, environmentCatalog.remove, environmentId, quiet);
      },
    },
    probe: (origin, signal) =>
      readZeropsContainer(origin, globalThis.fetch.bind(globalThis), signal),
    intents: intentStorage,
    records: recordsStorage,
    catalog: catalogPort(registry),
    births: birthsForEnvironments,
  };
}
