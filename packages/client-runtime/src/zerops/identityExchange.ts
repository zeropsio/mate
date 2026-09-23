import * as Schema from "effect/Schema";
import { ConnectionBlockedError, ConnectionTransientError } from "../connection/model.ts";
/**
 * The container's `/mate` door, shared by every client.
 *
 * A throwaway is minted for this one Mate, handed to `connect`, and deleted
 * whatever the door answered (`doorThrowaway.ts`). The account's own Zerops
 * token stays in the app and reaches the Zerops API only.
 *
 * `servedApp` is passed only by a client that might itself be the bundle a
 * container is serving (the web app, same-origin) — a client with no such
 * notion (mobile) omits it and always gets the plain `/mate` prefix.
 */

import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

import type { ZeropsThrowawayPlatform } from "../authorization/zeropsThrowaway.ts";
import { squashAtomCommandFailure, type AtomCommandResult } from "../state/runtime.ts";
import { ZeropsApiError } from "./api.ts";
import { zeropsMateBaseUrl } from "./candidates.ts";
import { diagnosticFailure, mateDiagnostics, type IdentityExchangeReason } from "./diagnostics.ts";
import { connectThroughThrowaway } from "./doorThrowaway.ts";
import type { DescriptorFacts, ExchangeFailure } from "./environments/environmentMachine.ts";
import { zeropsErrorMessage } from "./errors.ts";
import { mateServerCompatibility } from "./serverCompatibility.ts";

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

export type ZeropsIdentityExchangeResult =
  | { readonly _tag: "Success"; readonly environmentId: EnvironmentId }
  | {
      readonly _tag: "Failure";
      readonly error: string;
      /**
       * Whether trying the same connect again, unchanged, might succeed — a
       * transient fault (the descriptor read timed out or the fetch itself
       * failed, an internal error, an uncertain door-mint, a mint that waited
       * out the account window) rather than a verdict
       * (`ConnectionBlockedError`'s permission/read-only/authentication/
       * unsupported, or anything else the door said no to).
       * The birth's own connect loop (`ZeropsProjectsPage.tsx`) is the only
       * reader; every other caller shows `error` and stops.
       */
      readonly retryable: boolean;
      readonly upgradeRequired?: boolean;
      readonly serverVersion?: string;
    };

/**
 * The failure tags a retry might clear on its own — the descriptor read
 * timing out or never reaching the network, and the environment's own
 * internal error. Named by tag rather than `instanceof`: `RemoteEnvironment-
 * Auth*Error` are `Data.TaggedError`s from a package this one does not
 * depend on, and `EnvironmentInternalError` is a `Schema.TaggedError` from
 * the wire contract — the tag is the one thing both carry.
 */
const RETRYABLE_IDENTITY_FAILURE_TAGS: ReadonlySet<string> = new Set([
  "RemoteEnvironmentAuthTimeoutError",
  "RemoteEnvironmentAuthFetchError",
  "EnvironmentInternalError",
]);

function isRetryableIdentityFailure(cause: unknown): boolean {
  // A verdict, never a fault to retry past: the door knows the caller and
  // said no on purpose.
  if (isConnectionBlockedError(cause)) return false;
  const tag =
    typeof cause === "object" && cause !== null && "_tag" in cause && typeof cause._tag === "string"
      ? cause._tag
      : undefined;
  return tag !== undefined && RETRYABLE_IDENTITY_FAILURE_TAGS.has(tag);
}

/**
 * What it takes to mint one throwaway: the two platform calls, the org that
 * holds the token and the project it is named for. `null` when nobody is
 * signed in, which is the one case where there is nothing to mint with.
 */
export interface ZeropsDoorThrowaway {
  readonly platform: ZeropsThrowawayPlatform;
  readonly clientId: string;
  readonly projectId: string;
  /** Tells this throwaway apart from another minted in the same second. */
  readonly nonce: string;
}

export interface ZeropsIdentityExchangeDeps<E> {
  readonly throwaway: ZeropsDoorThrowaway | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
  /** Told when a throwaway could not be taken back; never fails the connect. */
  readonly onOrphanedThrowaway?: ((cause: unknown) => void) | undefined;
}

export async function exchangeZeropsContainerIdentity<E>(
  deps: ZeropsIdentityExchangeDeps<E>,
  containerOrigin: string,
  options: {
    readonly reason: IdentityExchangeReason;
    readonly servedApp?: {
      readonly origin: string;
      readonly basePath: string;
    };
  },
): Promise<ZeropsIdentityExchangeResult> {
  const span = mateDiagnostics.span("identity-exchange", {
    origin: containerOrigin,
    reason: options.reason,
  });
  const throwaway = deps.throwaway;
  if (!throwaway) {
    span.end({ outcome: "failure", retryable: false, code: "signed-out" });
    return {
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
      retryable: false,
    };
  }
  const httpBaseUrl = zeropsMateBaseUrl(containerOrigin, options.servedApp);
  let result: AtomCommandResult<EnvironmentId, E>;
  try {
    result = await connectThroughThrowaway({
      platform: throwaway.platform,
      clientId: throwaway.clientId,
      projectId: throwaway.projectId,
      nonce: throwaway.nonce,
      ...(deps.onOrphanedThrowaway === undefined ? {} : { onOrphaned: deps.onOrphanedThrowaway }),
      connect: (doorToken) => deps.connect({ httpBaseUrl, doorToken }),
    });
  } catch (cause) {
    // The mint itself failed — the account is signed out, the platform is
    // down, or the org refused. The door was never reached, so there is
    // nothing to report about it. An "uncertain" mint (the write's own
    // outcome was never learned) and one that waited out the account window
    // (`access-unverified`, DESIGN §4.4) are worth trying again; every other
    // kind is the platform's settled word.
    const retryable =
      cause instanceof ZeropsApiError &&
      (cause.kind === "uncertain" || cause.kind === "access-unverified");
    span.end({ outcome: "failure", retryable, ...diagnosticFailure(cause) });
    return {
      _tag: "Failure",
      error: `Could not connect to this container. ${zeropsErrorMessage(cause)}`,
      retryable,
    };
  }
  if (result._tag === "Failure") {
    const failure = squashAtomCommandFailure(result);
    const reason = zeropsErrorMessage(failure);
    const retryable = isRetryableIdentityFailure(failure);
    span.end({ outcome: "failure", retryable, ...diagnosticFailure(failure) });
    return {
      _tag: "Failure",
      error: `Could not connect to this container. ${reason}`,
      retryable,
      ...(isConnectionBlockedError(failure) && failure.reason === "unsupported"
        ? {
            upgradeRequired: true,
            ...(failure.serverVersion ? { serverVersion: failure.serverVersion } : {}),
          }
        : {}),
    };
  }
  span.end({ outcome: "success" });
  return { _tag: "Success", environmentId: result.value };
}

// ── The door as the exchange driver reads it ──────────────────────────────────────────────────

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

const SESSION_ENDED = refusalFailure({ kind: "access", reason: "epoch-closed" });

/**
 * The failure class of anything an exchange can fail with (DESIGN §4.4's table): the mint's
 * `ZeropsApiError`, the door's and the token exchange's `ConnectionBlockedError` and
 * `ConnectionTransientError`, and a fetch that never reached anything.
 */
export function exchangeFailureOf(cause: unknown): ExchangeFailure {
  if (cause instanceof ZeropsApiError) {
    switch (cause.kind) {
      case "network":
        return retryableFailure({ kind: "network" });
      case "access-unverified":
        return retryableFailure({ kind: "access-unverified" });
      case "expired-session":
        return SESSION_ENDED;
      case "forbidden":
      case "not-found":
        // The organization refused the mint: no later round changes that by itself.
        return refusalFailure({ kind: "access", reason: "role-denies" });
      case "uncertain":
      case "server":
      case "invalid-input":
      case "unexpected":
        return retryableFailure({ kind: "mint", status: cause.status ?? 0 });
    }
  }
  if (isConnectionBlockedError(cause)) {
    switch (cause.reason) {
      case "permission":
      case "read-only":
        return refusalFailure({ kind: "role" });
      case "unsupported":
        return refusalFailure({ kind: "version" });
      case "authentication":
        return retryableFailure({ kind: "rejected" });
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

export interface DoorExchangeDeps<C, E> {
  readonly throwaway: ZeropsDoorThrowaway | null;
  /** `/.well-known/t3/environment` at the Mate's base URL. */
  readonly readDescriptor: (httpBaseUrl: string) => Promise<ExecutionEnvironmentDescriptor>;
  /** The door and the token exchange: a credential for the Mate, not yet installed anywhere. */
  readonly prepare: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
    readonly expectedProjectId: string;
  }) => Promise<AtomCommandResult<C, E>>;
  readonly environmentOf: (credential: C) => EnvironmentId;
  readonly onOrphanedThrowaway?: ((cause: unknown) => void) | undefined;
}

/**
 * One exchange for the exchange driver: the descriptor, the mint, the door and the token
 * exchange (DESIGN §4.4), with every answer read into a failure class and nothing installed.
 *
 * The descriptor is read first, so a Mate that cannot answer for the person
 * (`zerops.identity = "failed"`), runs a server below the client floor or belongs to another
 * project costs no throwaway.
 */
export async function exchangeAtDoor<C, E>(
  deps: DoorExchangeDeps<C, E>,
  containerOrigin: string,
  options: {
    readonly reason: IdentityExchangeReason;
    readonly expectedProjectId: string;
    readonly servedApp?: { readonly origin: string; readonly basePath: string };
  },
): Promise<ExchangeAnswer<C>> {
  const span = mateDiagnostics.span("identity-exchange", {
    origin: containerOrigin,
    reason: options.reason,
  });
  const fail = (
    failure: ExchangeFailure,
    descriptor: DescriptorFacts | null,
    diagnostic: { readonly code: string } | ReturnType<typeof diagnosticFailure>,
  ): ExchangeAnswer<C> => {
    span.end({ outcome: "failure", retryable: failure.class === "retryable", ...diagnostic });
    return { ok: false, failure, descriptor };
  };
  const throwaway = deps.throwaway;
  if (!throwaway) return fail(SESSION_ENDED, null, { code: "signed-out" });
  const httpBaseUrl = zeropsMateBaseUrl(containerOrigin, options.servedApp);

  let descriptor: DescriptorFacts;
  let projectId: string | undefined;
  try {
    const read = await deps.readDescriptor(httpBaseUrl);
    descriptor = descriptorFacts(read);
    projectId = read.zerops?.projectId;
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
  if (projectId !== options.expectedProjectId) {
    return fail(refusalFailure({ kind: "project-mismatch" }), descriptor, {
      code: "project-mismatch",
    });
  }
  if (descriptor.identity === "failed") {
    return fail(retryableFailure({ kind: "identity-failed" }), descriptor, {
      code: "identity-failed",
    });
  }

  let result: AtomCommandResult<C, E>;
  try {
    result = await connectThroughThrowaway({
      platform: throwaway.platform,
      clientId: throwaway.clientId,
      projectId: throwaway.projectId,
      nonce: throwaway.nonce,
      ...(deps.onOrphanedThrowaway === undefined ? {} : { onOrphaned: deps.onOrphanedThrowaway }),
      connect: (doorToken) =>
        deps.prepare({ httpBaseUrl, doorToken, expectedProjectId: options.expectedProjectId }),
    });
  } catch (cause) {
    return fail(exchangeFailureOf(cause), descriptor, diagnosticFailure(cause));
  }
  if (result._tag === "Failure") {
    const cause = squashAtomCommandFailure(result);
    return fail(exchangeFailureOf(cause), descriptor, diagnosticFailure(cause));
  }
  span.end({ outcome: "success" });
  return {
    ok: true,
    environmentId: deps.environmentOf(result.value),
    descriptor,
    credential: result.value,
  };
}
