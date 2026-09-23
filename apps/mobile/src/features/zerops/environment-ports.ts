/**
 * The account runtime's ports on a device (DESIGN §7.5): the device's signals, the access grant's
 * verifier over the session's client, and the Mate environments' — the door through the
 * connection runtime, the connection catalog and its links, the probe over `fetch`, and the
 * account's personal context. Adapters only: every decision is the runtime's.
 */
import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import {
  ConnectionBlockedError,
  CredentialStore,
  EnvironmentRegistry,
  connectionCatalogDisplayUrl,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { ZeropsApiClient, ZeropsUser } from "@t3tools/client-runtime/zerops";
import type {
  AccountEnvironmentPorts,
  AccountRuntimePorts,
  DoorCredential,
  RegisteredEnvironment,
} from "@t3tools/client-runtime/zerops/account/runtime";
import { normalizeOrigin, zeropsMateBaseUrl } from "@t3tools/client-runtime/zerops/candidates";
import { readZeropsContainer } from "@t3tools/client-runtime/zerops/containerHealth";
import {
  DEFAULT_ZEROPS_GRANT_POLICY,
  makeRestAccessVerifier,
  type AccountScope,
} from "@t3tools/client-runtime/zerops/data";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { systemExchangeClock, type LinkPhase } from "@t3tools/client-runtime/zerops/environments";
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
import { AsyncResult } from "effect/unstable/reactivity";

import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { loadAccountRecords, memoryIntents, NO_BIRTHS } from "./account-ports";
import { mobilePlatformSignals } from "./platform-signals";
import { mobileZeropsStorage } from "./storage";

// ── The door, through the connection runtime ─────────────────────────────────────────────────

const doorScheduler = createAtomCommandScheduler();

const readDescriptorCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:zerops:read-door-descriptor",
  execute: readDoorDescriptor,
});

/**
 * The Zerops door. Single-flight on the container's base URL so two exchanges can never mint
 * two credentials for the same environment at once.
 */
const prepareCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:zerops:prepare-door-registration",
  scheduler: doorScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: { readonly httpBaseUrl: string }) => input.httpBaseUrl,
  },
  execute: prepareDoorRegistration,
});

const installCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:zerops:install-door-registration",
  execute: installDoorRegistration,
});

const retryLinkCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:zerops:retry-link",
  execute: (environmentId: EnvironmentId) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.retryNow(environmentId))),
});

/** Which door minted a connection's credential; null when none is stored or it names none. */
const credentialOriginCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:zerops:credential-origin",
  execute: (connectionId: string) =>
    CredentialStore.ConnectionCredentialStore.pipe(
      Effect.flatMap((credentials) => credentials.get(connectionId)),
      Effect.map((credential) =>
        Option.isSome(credential) ? (credential.value.origin ?? null) : null,
      ),
    ),
});

const quiet = { reportFailure: false } as const;

/** An accepted registration, installed through `registry.rotateCredential` or `register`. */
function doorCredential(registration: BearerConnectionRegistration): DoorCredential {
  return {
    install: async () => {
      const result = await runAtomCommand(appAtomRegistry, installCommand, registration, quiet);
      return { ok: result._tag !== "Failure" };
    },
  };
}

async function descriptorAt(httpBaseUrl: string) {
  const result = await runAtomCommand(
    appAtomRegistry,
    readDescriptorCommand,
    { httpBaseUrl },
    quiet,
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

// ── The catalog and its links ────────────────────────────────────────────────────────────────

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

/** Region L as the supervisor publishes it; null for a block that names no reason. */
function linkPhaseOf(state: SupervisorConnectionState): LinkPhase | null {
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
 * The account's environments in the device's catalog, and every publication of each one's link.
 * The device also holds environments it paired with a link, a relay or SSH: the account's are the
 * ones the Zerops door registered, so only those are the account's to release.
 */
const catalogPort: AccountEnvironmentPorts["catalog"] = {
  listen: (listener) => {
    const links = new Map<EnvironmentId, () => void>();
    let publication = 0;
    let stopped = false;
    const stopCatalog = appAtomRegistry.subscribe(
      environmentCatalog.catalogValueAtom,
      ({ entries }) => {
        publication += 1;
        const published = publication;
        void Promise.all(
          [...entries].map(
            async ([environmentId, entry]): Promise<RegisteredEnvironment | null> => {
              if (entry.target._tag !== "BearerConnectionTarget") return null;
              const minted = await runAtomCommand(
                appAtomRegistry,
                credentialOriginCommand,
                entry.target.connectionId,
                quiet,
              );
              if (minted._tag === "Failure" || minted.value !== "zerops-identity") return null;
              const url = connectionCatalogDisplayUrl(entry);
              return { environmentId, origin: url === null ? null : normalizeOrigin(url) };
            },
          ),
        ).then((registered) => {
          if (stopped || published !== publication) return;
          listener.environments(registered.filter((environment) => environment !== null));
        });
        for (const [environmentId, stop] of links) {
          if (entries.has(environmentId)) continue;
          links.delete(environmentId);
          stop();
        }
        for (const environmentId of entries.keys()) {
          if (links.has(environmentId)) continue;
          links.set(
            environmentId,
            appAtomRegistry.subscribe(
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
      },
      { immediate: true },
    );
    return () => {
      stopped = true;
      stopCatalog();
      for (const stop of links.values()) stop();
      links.clear();
    };
  },
};

// ── The ports ────────────────────────────────────────────────────────────────────────────────

export type MobileAccountPorts = Pick<AccountRuntimePorts, "verifier" | "signals" | "environments">;

/**
 * The account runtime's ports for one verified account: `client` is the session's, and `onUser`
 * hears each user a grant round reads. The account's records are read from the device first.
 */
export async function mobileAccountPorts(input: {
  readonly account: AccountScope;
  readonly client: ZeropsApiClient;
  readonly onUser: (user: ZeropsUser) => void;
}): Promise<MobileAccountPorts> {
  const { account, client } = input;
  const records = await loadAccountRecords(mobileZeropsStorage, account.account.accountId);
  return {
    verifier: makeRestAccessVerifier({
      client,
      account: account.account,
      concurrency: DEFAULT_ZEROPS_GRANT_POLICY.roundProjectConcurrency,
      onUser: input.onUser,
    }),
    signals: mobilePlatformSignals(),
    environments: {
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
                    nonce: uuidv4(),
                  }
                : null,
              readDescriptor: descriptorAt,
              prepare: (prepared) =>
                runAtomCommand(appAtomRegistry, prepareCommand, prepared, quiet),
              environmentOf: (registration) => registration.target.environmentId,
            },
            request.origin,
            { reason: request.reason, expectedProjectId: request.projectId },
          );
          return answer.ok ? { ...answer, credential: doorCredential(answer.credential) } : answer;
        },
        readDescriptor: async (origin) =>
          descriptorFacts(await descriptorAt(zeropsMateBaseUrl(origin))),
        retryLink: (environmentId) => {
          void runAtomCommand(appAtomRegistry, retryLinkCommand, environmentId, quiet);
        },
        remove: (environmentId) => {
          void runAtomCommand(appAtomRegistry, environmentCatalog.remove, environmentId, quiet);
        },
      },
      probe: (origin, signal) =>
        readZeropsContainer(origin, globalThis.fetch.bind(globalThis), signal),
      intents: memoryIntents(),
      records,
      catalog: catalogPort,
      births: NO_BIRTHS,
    },
  };
}
