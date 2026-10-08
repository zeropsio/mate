/**
 * The web's ports for the account runtime's Mate environments (DESIGN §7.3): the door through the
 * connection runtime, the connection catalog and its links, the probe through the data layer's
 * reads (`mateContainerReads`), the Mate sessions this account keeps, and this tab's intents.
 * Adapters only: every decision is the runtime's.
 */
import { shownHqVerdictAtom } from "@t3tools/client-runtime/data";
import { accountThrowawayDebt } from "./throwawayDebt";
import { fetchRemoteSessionState } from "@t3tools/client-runtime/authorization";
import {
  connectionAdmission,
  type BearerConnectionRegistration,
} from "@t3tools/client-runtime/connection";
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
import { mateContainerReads } from "@t3tools/client-runtime/data";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import {
  closeOffWordOf,
  systemExchangeClock,
  type CloseOffWord,
  type LinkPhase,
  type RememberedTarget,
} from "@t3tools/client-runtime/zerops/environments";
import {
  descriptorFacts,
  exchangeAtDoor,
  installDoorRegistration,
  prepareDoorRegistration,
  type KeptDoorSession,
} from "@t3tools/client-runtime/zerops/identityExchange";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { appBasePath } from "~/basePath";
import { environmentCatalog } from "~/connection/catalog";
import { connectionAtomRuntime } from "~/connection/runtime";
import { randomUUID } from "~/lib/utils";
import { environmentIdFromAddress } from "~/routes/-environmentRoute";
import { hqMatesAtom, hqNavigationAtom, hqProjectOf } from "~/state/zerops";

import { accountStorageKey, captureAccountLifetime } from "./accountLifetime";
import {
  endKeptSession,
  forgetKeptMateSession,
  keepMintedMateSession,
  keptSessionHeld,
  keptSessions,
} from "./keptSessions";
import { mateDescriptors } from "./mateDescriptors";
import { closeOffPendingProjects, pressesInFlight } from "./matePress";

// ── The door, through the connection runtime ─────────────────────────────────────────────────

const doorScheduler = createAtomCommandScheduler();

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

/**
 * How long a kept session's check may take: a Mate that answers its descriptor and stalls here
 * must leave the exchange's deadline to the throwaway that follows.
 */
const KEPT_SESSION_CHECK_TIMEOUT_MS = 3_000;

/** The Mate's own word on a session: `/api/auth/session` with it as the bearer. */
const sessionStateCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:zerops:read-kept-session",
  execute: fetchRemoteSessionState,
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

/**
 * An accepted registration, installed through `registry.rotateCredential` or `register`, and kept
 * for the target once installed, so the next load presents it again (`keptSessions.ts`) — only
 * for the account whose exchange opened it; the session it displaced ends at its Mate only where no
 * other tab may still use it (`keepMintedMateSession`).
 */
function doorCredential(
  registry: AtomRegistry.AtomRegistry,
  key: string,
  registration: BearerConnectionRegistration,
  sameAccount: () => boolean,
): DoorCredential {
  return {
    install: async () => {
      const result = await runAtomCommand(registry, installCommand, registration, quiet);
      if (result._tag === "Failure") return { ok: false };
      if (sameAccount()) keepMintedMateSession(key, registration);
      return { ok: true };
    },
  };
}

/** Whether two base URLs name the same place; one that does not parse names none. */
function sameBaseUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href.replace(/\/+$/, "") === new URL(right).href.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

/** The tags of an answer the Mate gave about a session: it said something this client can act on. */
const SESSION_ANSWER_TAGS: ReadonlySet<string> = new Set([
  "RemoteEnvironmentAuthInvalidJsonError",
  "EnvironmentRequestInvalidError",
  "EnvironmentAuthInvalidError",
  "EnvironmentScopeRequiredError",
  "EnvironmentOperationForbiddenError",
  "EnvironmentResourceNotFoundError",
]);

/**
 * Whether a kept session's check failing is no word from its Mate — no answer in time, no answer
 * at all, a server error — rather than an answer: a state this client cannot read, a refusal or a
 * route it does not serve all say the session is not one this client can present.
 */
export function keptSessionUnanswered(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("_tag" in cause)) return true;
  const tag = String(cause._tag);
  if (tag === "RemoteEnvironmentAuthUndeclaredStatusError") {
    return !("status" in cause) || typeof cause.status !== "number" || cause.status >= 500;
  }
  return !SESSION_ANSWER_TAGS.has(tag);
}

/** Kept sessions an exchange of this page got no word on: the next exchange of each mints. */
const unansweredKept = new Set<string>();

/** Whether the target's exchange presents a kept session first, past the mint pace. */
function presentsKept(key: string): boolean {
  const registration = keptSessions.read(key);
  return registration !== null && !unansweredKept.has(registration.credential.token);
}

/**
 * The session an earlier load kept for this target, as one exchange presents it again: only at
 * the base URL it was opened at, and only once its Mate says it still holds it.
 */
function keptDoorSession(
  registry: AtomRegistry.AtomRegistry,
  key: string,
): KeptDoorSession<BearerConnectionRegistration> | null {
  const registration = keptSessions.read(key);
  if (registration === null) return null;
  const { httpBaseUrl } = registration.profile;
  return {
    credential: registration,
    check: async (at) => {
      if (!sameBaseUrl(httpBaseUrl, at.httpBaseUrl)) {
        // Kept at another address: ended there, and never presented here.
        endKeptSession(registration);
        return false;
      }
      const result = await runAtomCommand(
        registry,
        sessionStateCommand,
        {
          httpBaseUrl,
          bearerToken: registration.credential.token,
          timeoutMs: KEPT_SESSION_CHECK_TIMEOUT_MS,
        },
        quiet,
      );
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        // An answer this client cannot use is not held: a throwaway opens a session it can.
        if (!keptSessionUnanswered(cause)) return false;
        throw cause;
      }
      if (keptSessionHeld(result.value)) return true;
      // Live but short of a scope this client asks for now: ended, so a throwaway opens one.
      if (result.value.authenticated) endKeptSession(registration);
      return false;
    },
    forget: () => {
      keptSessions.forget(key, registration.credential.token);
    },
    unanswered: unansweredKept.has(registration.credential.token),
    answered: (answered) => {
      if (answered) unansweredKept.delete(registration.credential.token);
      else unansweredKept.add(registration.credential.token);
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
 * The Mates whose session this account keeps (`keptSessions.ts`): each target, the environment its
 * session serves and the address it was opened at — a route to one is found with no read.
 */
export function rememberedMates(): ReadonlyArray<RememberedTarget> {
  return keptSessions.keys().flatMap((targetKey) => {
    const registration = keptSessions.read(targetKey);
    return registration === null
      ? []
      : [
          {
            targetKey,
            environmentId: registration.target.environmentId,
            origin: normalizeOrigin(registration.profile.httpBaseUrl),
            orgId: null,
          },
        ];
  });
}

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
 * The Mate environments' ports on the web, for one account epoch: `client` is the session's, and
 * `registry` the atom registry the connection runtime publishes to.
 */
export function webEnvironmentPorts(input: {
  readonly client: ZeropsApiClient;
  readonly registry: AtomRegistry.AtomRegistry;
}): AccountEnvironmentPorts {
  const { client, registry } = input;
  return {
    clock: systemExchangeClock,
    door: {
      exchange: async (request) => {
        const sameAccount = captureAccountLifetime();
        const answer = await exchangeAtDoor(
          {
            // The token is minted in the organization that lists the Mate's project.
            throwaway: client.session?.accessToken
              ? {
                  platform: zeropsThrowawayPlatform(client, {
                    debt: accountThrowawayDebt(client),
                    signal: request.signal,
                    asked: request.asked,
                  }),
                  clientId: request.organizationId,
                  projectId: request.projectId,
                  nonce: randomUUID(),
                }
              : null,
            readDescriptor: (httpBaseUrl) =>
              mateDescriptors.descriptor(httpBaseUrl, request.signal),
            prepare: (prepared) => runAtomCommand(registry, prepareCommand, prepared, quiet),
            environmentOf: (registration) => registration.target.environmentId,
            kept: keptDoorSession(registry, request.key),
          },
          request.origin,
          {
            reason: request.reason,
            expectedProjectId: request.projectId,
            servedApp: servedApp(),
          },
        );
        return answer.ok
          ? {
              ...answer,
              credential: doorCredential(registry, request.key, answer.credential, sameAccount),
            }
          : answer;
      },
      // A kept session its Mate gave no word on mints next time: that exchange waits on the pace.
      kept: presentsKept,
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
      forgetKept: forgetKeptMateSession,
      park: (environmentId) => {
        void runAtomCommand(registry, parkCommand, environmentId, quiet);
      },
      unpark: (environmentId) => {
        void runAtomCommand(registry, unparkCommand, environmentId, quiet);
      },
    },
    ...mateContainerReads(mateDescriptors.read),
    intents: intentStorage,
    remembered: rememberedMates,
    catalog: catalogPort(registry),
    route: () => {
      const environmentId = environmentIdFromAddress(window.location.pathname, appBasePath());
      return environmentId === null ? null : EnvironmentId.make(environmentId);
    },
    admission: connectionAdmission,
    // Any press in flight: the background mints no throwaway meanwhile.
    pressInFlight: pressesInFlight,
    hqIndex: hqIndexPort(registry),
    // Nobody is let into a Mate before its project is closed off: HQ's word, and where HQ says
    // nothing, what this browser's own presses know.
    closeOff: closeOffPort(registry),
    closeOffPending: closeOffPendingProjects,
  };
}
