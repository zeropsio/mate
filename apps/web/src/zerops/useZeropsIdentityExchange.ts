import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import {
  normalizeOrigin,
  zeropsMateBaseUrl,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import type { OrganizationRef } from "@t3tools/client-runtime/zerops/data";
import type { IdentityExchangeReason } from "@t3tools/client-runtime/zerops/diagnostics";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import {
  reachabilityPhrase,
  systemExchangeClock,
  type ConnectOutcome,
  type ExchangeDriver,
  type ExchangeDriverPorts,
} from "@t3tools/client-runtime/zerops/environments";
import {
  descriptorFacts,
  exchangeAtDoor,
  exchangeZeropsContainerIdentity as exchangeZeropsContainerIdentityShared,
  installDoorRegistration,
  prepareDoorRegistration,
  readDoorDescriptor,
  type ZeropsDoorThrowaway,
  type ZeropsIdentityExchangeResult,
} from "@t3tools/client-runtime/zerops/identityExchange";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { createContext, useCallback, useContext } from "react";

import { appBasePath } from "~/basePath";
import { environmentCatalog } from "~/connection/catalog";
import { connectionAtomRuntime } from "~/connection/runtime";
import { randomUUID } from "~/lib/utils";

import { invalidateZerops } from "./accountInvalidations";
import { captureAccountLifetime } from "./accountLifetime";
import { inventoryCandidates } from "./inventoryContext";
import { beginEnvironmentIdentityExchange, rememberRegistration } from "./registrationRecords";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { promoteBirth } from "./zeropsBirths";

export type { ZeropsIdentityExchangeResult };

export async function exchangeZeropsContainerIdentity<E>(input: {
  readonly containerOrigin: string;
  readonly reason: IdentityExchangeReason;
  readonly appOrigin: string;
  readonly basePath: string;
  readonly throwaway: ZeropsDoorThrowaway | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
}): Promise<ZeropsIdentityExchangeResult> {
  return exchangeZeropsContainerIdentityShared(
    { throwaway: input.throwaway, connect: input.connect },
    input.containerOrigin,
    { reason: input.reason, servedApp: { origin: input.appOrigin, basePath: input.basePath } },
  );
}

// ── The driver's ports, backed by the connection runtime ─────────────────────────────────────

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

/** What the ports read from the mounted account each time they run. */
export interface ExchangeInputs {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly client: ZeropsApiClient;
  readonly activeOrganizationId: string | undefined;
  readonly organizationRef: (organizationId: string) => OrganizationRef;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
}

const quiet = { reportFailure: false } as const;

const servedApp = () => ({ origin: window.location.origin, basePath: appBasePath() });

/**
 * The exchange driver's ports on the web: the door through the connection runtime, installs
 * through `registry.rotateCredential` or `register`, and what every installed environment writes:
 * its target's registration record and the creation hand-off.
 */
export function webExchangePorts(
  read: () => ExchangeInputs,
): ExchangeDriverPorts<BearerConnectionRegistration> {
  const candidateFor = (key: string) =>
    read().candidates.find((candidate) => candidate.key === key);
  const descriptorAt = async (registry: AtomRegistry.AtomRegistry, httpBaseUrl: string) => {
    const result = await runAtomCommand(registry, readDescriptorCommand, { httpBaseUrl }, quiet);
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  };
  return {
    clock: systemExchangeClock,
    exchange: async (request) => {
      const { registry, client, activeOrganizationId } = read();
      const candidate = candidateFor(request.key);
      // The inventory no longer names this target: its presence is read again.
      if (candidate === undefined) {
        return {
          ok: false,
          failure: { class: "refusal", reason: { kind: "project-mismatch" } },
          descriptor: null,
        };
      }
      // The token is minted in the org that owns the Mate's project — the active organization
      // only stands in when the project read carried none.
      const clientId = candidate.project.clientId ?? activeOrganizationId;
      return exchangeAtDoor(
        {
          throwaway:
            client.session?.accessToken && clientId
              ? {
                  platform: zeropsThrowawayPlatform(client, request.signal),
                  clientId,
                  projectId: candidate.project.id,
                  nonce: randomUUID(),
                }
              : null,
          readDescriptor: (httpBaseUrl) => descriptorAt(registry, httpBaseUrl),
          prepare: (input) => runAtomCommand(registry, prepareCommand, input, quiet),
          environmentOf: (registration) => registration.target.environmentId,
        },
        request.origin,
        {
          reason: request.reason,
          expectedProjectId: candidate.project.id,
          servedApp: servedApp(),
        },
      );
    },
    install: async ({ key, environmentId, credential }) => {
      const alive = captureAccountLifetime();
      const { registry, activeOrganizationId } = read();
      const candidate = candidateFor(key);
      // The catalog publishes the registration before the target is remembered below.
      const finish = beginEnvironmentIdentityExchange(credential.profile.httpBaseUrl);
      try {
        const result = await runAtomCommand(registry, installCommand, credential, quiet);
        if (result._tag === "Failure" || !alive()) return { ok: false };
        // The signer's tag, the review and the Git tab read the project off this record (H12):
        // every exchange that installs an environment writes it the same way.
        const orgId = candidate?.project.clientId ?? activeOrganizationId;
        rememberRegistration({
          targetKey: key,
          environmentId,
          origin: normalizeOrigin(credential.profile.httpBaseUrl),
          projectRef:
            candidate === undefined || orgId === undefined
              ? null
              : { projectId: candidate.project.id, orgId },
          name: candidate?.project.name ?? null,
        });
        // The birth is over: its opening job waits on the environment the exchange named.
        if (candidate !== undefined) promoteBirth(candidate.project.id, String(environmentId));
        return { ok: true };
      } finally {
        finish();
      }
    },
    readDescriptor: async (origin) =>
      descriptorFacts(await descriptorAt(read().registry, zeropsMateBaseUrl(origin, servedApp()))),
    retryLink: (environmentId) => {
      void runAtomCommand(read().registry, retryLinkCommand, environmentId, quiet);
    },
    // The inventory of the organization that owns the target's project, or of the active one
    // when the inventory no longer names the target (DESIGN §6.2).
    refreshPresence: (key) => {
      const { activeOrganizationId, organizationRef } = read();
      const organizationId = candidateFor(key)?.project.clientId ?? activeOrganizationId;
      if (organizationId === undefined) return;
      invalidateZerops({ topic: "inventory", organization: organizationRef(organizationId) });
    },
    retire: (_key, environmentId) => {
      if (environmentId === null) return;
      void runAtomCommand(read().registry, environmentCatalog.remove, environmentId, quiet);
    },
  };
}

// ── The user's Connect ───────────────────────────────────────────────────────────────────────

export const ExchangeDriverContext = createContext<ExchangeDriver | null>(null);

export function useExchangeDriver(): ExchangeDriver {
  const driver = useContext(ExchangeDriverContext);
  if (driver === null) throw new Error("The exchange driver requires ZeropsEnvironmentLifetime.");
  return driver;
}

/** A settled Connect as the projects page reads it. */
export function connectResult(outcome: ConnectOutcome): ZeropsIdentityExchangeResult {
  switch (outcome._tag) {
    case "Connected":
      return { _tag: "Success", environmentId: outcome.environmentId };
    case "Closed":
      return { _tag: "Failure", error: "This account session has ended.", retryable: false };
    case "NotConnected": {
      const verdict = outcome.reachability;
      const text = reachabilityPhrase(verdict, { nowMs: Date.now(), mateName: "This Mate" }).text;
      const upgrade = verdict.kind === "update-required" || verdict.kind === "update-unavailable";
      return {
        _tag: "Failure",
        error: `Could not connect to this container. ${text ?? ""}`.trim(),
        retryable: !TERMINAL_CONNECT.has(verdict.kind),
        ...(upgrade
          ? {
              upgradeRequired: true,
              ...(outcome.descriptor === null
                ? {}
                : { serverVersion: outcome.descriptor.serverVersion }),
            }
          : {}),
      };
    }
  }
}

/** The verdicts a retry of the same Connect does not change. */
const TERMINAL_CONNECT: ReadonlySet<string> = new Set([
  "gone",
  "replaced",
  "refused-role",
  "refused-configuration",
  "update-required",
  "update-unavailable",
  "no-address",
]);

/**
 * The user's Connect on a container, by its origin: a demand on the exchange driver, which runs
 * the exchange, installs the credential and answers with the environment — or with why it did
 * not. `reason` names the exchange in diagnostics.
 */
export function useZeropsIdentityExchange(reason: IdentityExchangeReason) {
  const driver = useExchangeDriver();
  const inventory = useZeropsInventory();

  return useCallback(
    async (containerOrigin: string): Promise<ZeropsIdentityExchangeResult> => {
      const candidate = inventoryCandidates(inventory).find(
        (entry) =>
          entry.containerOrigin &&
          normalizeOrigin(entry.containerOrigin) === normalizeOrigin(containerOrigin),
      );
      if (candidate === undefined) {
        return {
          _tag: "Failure",
          error: "This environment is not in your verified Zerops projects.",
          retryable: false,
        };
      }
      return connectResult(await driver.connect(candidate.key, reason));
    },
    [driver, inventory.projects, inventory.services, reason],
  );
}
