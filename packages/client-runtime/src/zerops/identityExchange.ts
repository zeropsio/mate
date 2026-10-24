/**
 * A Mate as the environment machine opens it (spec-mate §3.8): its descriptor is read at the
 * container's `/mate` base, judged, and a registration made that asks HQ for a ticket on every
 * connection attempt. Nothing is minted and no credential is kept.
 *
 * `servedApp` is passed only by a client that might itself be the bundle a container is serving
 * (the web app, same-origin) — a client with no such notion (mobile) omits it and always gets the
 * plain `/mate` prefix.
 */
import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ZeropsMateConnectionRegistration } from "../connection/catalog.ts";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  ZeropsMateConnectionTarget,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import { zeropsMateBaseUrl } from "./candidates.ts";
import { diagnosticFailure, mateDiagnostics, type IdentityExchangeReason } from "./diagnostics.ts";
import type { DescriptorFacts, ExchangeFailure } from "./environments/environmentMachine.ts";
import { mateServerCompatibility } from "./serverCompatibility.ts";

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

/** What the person's Connect of a Mate ended in, as the birth's connect loop reads it. */
export type ZeropsIdentityExchangeResult =
  | { readonly _tag: "Success"; readonly environmentId: EnvironmentId }
  | {
      readonly _tag: "Failure";
      readonly error: string;
      /**
       * Whether trying the same connect again, unchanged, might succeed — a
       * transient fault (the descriptor read timed out or the fetch itself
       * failed, an internal error, an uncertain door-mint) rather than a verdict
       * (`ConnectionBlockedError`'s permission/read-only/authentication/
       * unsupported, or anything else the door said no to).
       * The birth's own connect loop (`ZeropsProjectsPage.tsx`) is the only
       * reader; every other caller shows `error` and stops.
       */
      readonly retryable: boolean;
      readonly upgradeRequired?: boolean;
      readonly serverVersion?: string;
    };

// ── The exchange as the environment machine reads it ─────────────────────────────────────────

const isConnectionTransientError = Schema.is(ConnectionTransientError);

/** What one exchange at a Mate's door answered, read into the machine's terms (DESIGN §4.4). */
export type ExchangeAnswer<C> =
  | {
      readonly ok: true;
      readonly environmentId: EnvironmentId;
      readonly descriptor: DescriptorFacts;
      /** What installing the answer needs; never installed here. */
      readonly credential: C;
    }
  | {
      readonly ok: false;
      readonly failure: ExchangeFailure;
      /** The descriptor the failure was judged on; null when none was read. */
      readonly descriptor: DescriptorFacts | null;
    };

const retryableFailure = (cause: Extract<ExchangeFailure, { class: "retryable" }>["cause"]) =>
  ({ class: "retryable", cause }) as const;

const refusalFailure = (reason: Extract<ExchangeFailure, { class: "refusal" }>["reason"]) =>
  ({ class: "refusal", reason }) as const;

/**
 * The failure class of anything an exchange or a connection can fail with (DESIGN §4.4's table):
 * a `ConnectionBlockedError`, a `ConnectionTransientError`, and a fetch that never reached anything.
 */
export function exchangeFailureOf(cause: unknown): ExchangeFailure {
  if (isConnectionBlockedError(cause)) {
    switch (cause.reason) {
      case "permission":
      case "read-only":
        return refusalFailure({
          kind: "role",
          ...(cause.chiefOwnerName === undefined ? {} : { chiefOwnerName: cause.chiefOwnerName }),
        });
      case "unsupported":
        return refusalFailure({ kind: "version" });
      case "authentication":
        return refusalFailure({ kind: "credential" });
      case "configuration":
        // The door's endpoint was missing or refused the request's shape.
        return retryableFailure({ kind: "descriptor-unreachable" });
    }
  }
  if (isConnectionTransientError(cause)) {
    switch (cause.reason) {
      case "timeout":
        return retryableFailure({ kind: "timeout" });
      case "network":
      case "transport":
        return retryableFailure({ kind: "network" });
      case "endpoint-unavailable":
      case "relay-unavailable":
      case "remote-unavailable":
      case "mate-not-linked":
        return retryableFailure({ kind: "server", status: 500 });
    }
  }
  const tag =
    typeof cause === "object" && cause !== null && "_tag" in cause && typeof cause._tag === "string"
      ? cause._tag
      : undefined;
  if (tag === "RemoteEnvironmentAuthTimeoutError") return retryableFailure({ kind: "timeout" });
  if (tag === "EnvironmentInternalError") return retryableFailure({ kind: "server", status: 500 });
  return retryableFailure({ kind: "network" });
}

/** The descriptor facts the environment machine reasons on (C6). */
export function descriptorFacts(descriptor: ExecutionEnvironmentDescriptor): DescriptorFacts {
  return {
    environmentId: descriptor.environmentId,
    serverVersion: descriptor.serverVersion,
    update: descriptor.update ?? null,
    identity: descriptor.zerops?.identity ?? "unknown",
    identityCheckedAt: descriptor.zerops?.identityCheckedAt ?? null,
  };
}

/**
 * One exchange for the environment machine: the Mate's descriptor, judged (DESIGN §4.4), and the
 * registration that opens it through HQ. A Mate that cannot answer for the person
 * (`zerops.identity = "failed"`), runs a server below the client floor or belongs to another
 * project is not registered.
 */
export async function exchangeAtMate(
  deps: {
    /** `/.well-known/t3/environment` at the Mate's base URL. */
    readonly readDescriptor: (httpBaseUrl: string) => Promise<ExecutionEnvironmentDescriptor>;
  },
  containerOrigin: string,
  options: {
    readonly reason: IdentityExchangeReason;
    readonly orgId: string;
    readonly projectId: string;
    readonly servedApp?: { readonly origin: string; readonly basePath: string };
  },
): Promise<ExchangeAnswer<ZeropsMateConnectionRegistration>> {
  const span = mateDiagnostics.span("identity-exchange", {
    origin: containerOrigin,
    reason: options.reason,
  });
  const fail = (
    failure: ExchangeFailure,
    descriptor: DescriptorFacts | null,
    diagnostic: { readonly code: string } | ReturnType<typeof diagnosticFailure>,
  ): ExchangeAnswer<ZeropsMateConnectionRegistration> => {
    span.end({ outcome: "failure", retryable: failure.class === "retryable", ...diagnostic });
    return { ok: false, failure, descriptor };
  };
  const httpBaseUrl = zeropsMateBaseUrl(containerOrigin, options.servedApp);

  let descriptor: DescriptorFacts;
  let projectId: string | undefined;
  let label: string;
  try {
    const read = await deps.readDescriptor(httpBaseUrl);
    descriptor = descriptorFacts(read);
    projectId = read.zerops?.projectId;
    label = read.label;
  } catch (cause) {
    return fail(
      retryableFailure({ kind: "descriptor-unreachable" }),
      null,
      diagnosticFailure(cause),
    );
  }
  if (mateServerCompatibility(descriptor.serverVersion) === "too-old") {
    return fail(refusalFailure({ kind: "version" }), descriptor, { code: "server-too-old" });
  }
  if (projectId !== options.projectId) {
    return fail(refusalFailure({ kind: "project-mismatch" }), descriptor, {
      code: "project-mismatch",
    });
  }
  if (descriptor.identity === "failed") {
    return fail(retryableFailure({ kind: "identity-failed" }), descriptor, {
      code: "identity-failed",
    });
  }
  span.end({ outcome: "success" });
  return {
    ok: true,
    environmentId: descriptor.environmentId,
    descriptor,
    credential: new ZeropsMateConnectionRegistration({
      target: new ZeropsMateConnectionTarget({
        environmentId: descriptor.environmentId,
        label,
        orgId: options.orgId,
        projectId: options.projectId,
        httpBaseUrl,
      }),
    }),
  };
}

/**
 * Installs a registration the environment machine accepted. A Mate already registered at the same
 * place keeps its supervisor and its shell; anything else is registered.
 */
export const installMateRegistration = Effect.fn("zerops.identityExchange.installMateRegistration")(
  function* (registration: ZeropsMateConnectionRegistration) {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const held = (yield* SubscriptionRef.get(registry.entries)).get(
      registration.target.environmentId,
    );
    const same =
      held?.target._tag === "ZeropsMateConnectionTarget" &&
      held.target.orgId === registration.target.orgId &&
      held.target.projectId === registration.target.projectId &&
      held.target.httpBaseUrl === registration.target.httpBaseUrl;
    if (!same) yield* registry.register(registration);
  },
);
