import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import {
  EnvironmentCloudEndpointUnavailableError,
  type EnvironmentCloudLinkStateResult,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
  EnvironmentHttpUnauthorizedError,
} from "@t3tools/contracts";
import { type RelayProtectedError as RelayProtectedErrorType } from "@t3tools/contracts/relay";
import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import { ManagedRelay } from "@t3tools/client-runtime/relay";

import { primaryEnvironmentHttpLayer } from "../environments/primary/httpLayer";
import { resolveCloudPublicConfig } from "./publicConfig";

export function normalizeRelayBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/g, "");
}

function relayUrl(): string | null {
  return resolveCloudPublicConfig().relayUrl;
}

export class CloudEnvironmentLinkError extends Data.TaggedError("CloudEnvironmentLinkError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly traceId?: string;
}> {}

const isEnvironmentCloudApiError = Schema.is(
  Schema.Union([
    EnvironmentHttpBadRequestError,
    EnvironmentHttpUnauthorizedError,
    EnvironmentHttpForbiddenError,
    EnvironmentHttpConflictError,
    EnvironmentHttpInternalServerError,
    EnvironmentCloudEndpointUnavailableError,
  ]),
);

function relayProtectedErrorMessage(error: RelayProtectedErrorType): string {
  switch (error._tag) {
    case "RelayAuthInvalidError":
      switch (error.reason) {
        case "missing_bearer":
        case "invalid_bearer":
          return "Relay rejected the cloud session token.";
        case "invalid_dpop":
          return "Relay rejected the DPoP proof.";
        case "not_authorized":
          return "Relay rejected the authenticated request.";
      }
    case "RelayEnvironmentLinkProofExpiredError":
      return "Relay rejected an expired environment link proof.";
    case "RelayEnvironmentLinkProofInvalidError":
      return `Relay rejected the environment link proof (${error.reason}).`;
    case "RelayEnvironmentLinkFailedError":
      return `Relay could not link the environment (${error.reason}).`;
    case "RelayEnvironmentLinkUnavailableError":
      return `Relay cannot verify the linked Zerops project (${error.reason}).`;
    case "RelayAgentActivityPublishProofExpiredError":
      return "Relay rejected an expired agent activity publish proof.";
    case "RelayAgentActivityPublishProofInvalidError":
      return `Relay rejected the agent activity publish proof (${error.reason}).`;
    case "RelayInternalError":
      return `Relay encountered an internal error (${error.reason}).`;
  }
}

function decodedRelayClientError(message: string) {
  return (cause: ManagedRelay.ManagedRelayClientError) => {
    const relayError =
      cause._tag === "ManagedRelayRequestFailedError" ? cause.relayError : undefined;
    const traceId = cause._tag === "ManagedRelayRequestFailedError" ? cause.traceId : undefined;
    const detail = relayError ? relayProtectedErrorMessage(relayError) : null;
    return new CloudEnvironmentLinkError({
      message: detail ? `${message}: ${detail}` : message,
      cause,
      ...(traceId ? { traceId } : {}),
    });
  };
}

function findEnvironmentCloudApiError(cause: unknown): { readonly message: string } | null {
  if (isEnvironmentCloudApiError(cause)) {
    return cause;
  }
  if (typeof cause !== "object" || cause === null) {
    return null;
  }
  return "cause" in cause ? findEnvironmentCloudApiError(cause.cause) : null;
}

const environmentApiError = (message: string) => (cause: unknown) => {
  const environmentError = findEnvironmentCloudApiError(cause);
  return new CloudEnvironmentLinkError({
    message: environmentError
      ? `${message.replace(/[.:]$/, "")}: ${environmentError.message}`
      : message,
    cause,
  });
};

// The link proof's legacy `origin` field (a loopback host/port pair) is only
// meaningful for a desktop server reached via a local connector — it is not
// used to derive the Zerops-bound `endpointOrigin` the server now stamps into
// the proof itself (apps/server/src/cloud/http.ts's
// resolveZeropsLinkProofOrigin). It stays a fixed placeholder here because
// the field is still required by the unchanged RelayLinkProofRequest shape.
function endpointOrigin(httpBaseUrl: string) {
  const url = new URL(httpBaseUrl);
  return {
    localHttpHost: "127.0.0.1",
    localHttpPort: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

export interface CloudLinkTarget {
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export type CloudLinkState = EnvironmentCloudLinkStateResult;

export function readPrimaryCloudLinkState(input: {
  readonly target: CloudLinkTarget;
}): Effect.Effect<CloudLinkState | null, CloudEnvironmentLinkError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);
    return yield* client.connect
      .linkState({ headers: {} })
      .pipe(Effect.mapError(environmentApiError("Could not read environment cloud link state.")));
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}

export function updatePrimaryCloudPreferences(input: {
  readonly target: CloudLinkTarget;
  readonly publishAgentActivity: boolean;
}): Effect.Effect<CloudLinkState, CloudEnvironmentLinkError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);
    return yield* client.connect
      .preferences({
        headers: {},
        payload: input,
      })
      .pipe(
        Effect.mapError(environmentApiError("Could not update environment cloud preferences.")),
      );
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}

// The relay no longer exposes an unlink endpoint (RelayClientGroup shrank to
// RelayLinkGroup, linking only) — unlinking is purely local now: the
// environment forgets its own relay credentials, and there is nothing left to
// revoke relay-side.
export function unlinkPrimaryEnvironmentFromCloud(input: {
  readonly target: CloudLinkTarget;
}): Effect.Effect<void, CloudEnvironmentLinkError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);
    yield* client.connect
      .unlink({ headers: {} })
      .pipe(Effect.mapError(environmentApiError("Could not unlink the environment from cloud.")));
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}

function ensureLinkedEnvironmentMatches(input: {
  readonly expectedEnvironmentId: string;
  readonly environmentId: string;
}): Effect.Effect<void, CloudEnvironmentLinkError> {
  if (input.environmentId !== input.expectedEnvironmentId) {
    return new CloudEnvironmentLinkError({
      message: "Relay returned credentials for a different environment.",
    });
  }
  return Effect.void;
}

/**
 * Links an environment to the relay purely to publish agent activity
 * (notifications and Live Activities to mobile clients) — the relay no longer
 * provisions managed tunnels, so every environment is reached over its own
 * public origin, never through the relay.
 *
 * `zeropsToken` is the caller's own Zerops access token, forwarded as the
 * relay's bearer credential (RelayClientAuth). The resulting proof is signed
 * server-side by the target environment and carries `zeropsProjectId` /
 * `endpointOrigin` (see apps/server/src/cloud/http.ts's makeCloudLinkProof) —
 * derived from the environment's own T3CODE_ZEROPS_PROJECT_ID and the public
 * origin the linking browser reached it through, not sent by this function.
 * No UI in this codebase currently calls this — a Settings → Notifications
 * trigger is the natural home for one, built against a Zerops candidate's
 * `containerOrigin` (`@t3tools/client-runtime/zerops/candidates`) as `target`.
 */
export function linkPrimaryEnvironmentToCloud(input: {
  readonly target: CloudLinkTarget;
  readonly zeropsToken: string;
}): Effect.Effect<
  void,
  CloudEnvironmentLinkError,
  HttpClient.HttpClient | ManagedRelay.ManagedRelayClient
> {
  return Effect.gen(function* () {
    const configuredRelayUrl = relayUrl();
    if (!configuredRelayUrl) {
      return yield* new CloudEnvironmentLinkError({
        message: "T3CODE_RELAY_URL is not configured.",
      });
    }
    const relayClient = yield* ManagedRelay.ManagedRelayClient;
    const environmentClient = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);

    const challenge = yield* relayClient
      .createEnvironmentLinkChallenge({
        zeropsToken: input.zeropsToken,
        payload: {
          notificationsEnabled: true,
          liveActivitiesEnabled: true,
        },
      })
      .pipe(
        Effect.mapError(
          decodedRelayClientError(
            `${configuredRelayUrl}/v1/client/environment-link-challenges failed`,
          ),
        ),
      );
    const proof = yield* environmentClient.connect
      .linkProof({
        headers: {},
        payload: {
          challenge: challenge.challenge,
          relayIssuer: configuredRelayUrl,
          endpoint: {
            httpBaseUrl: input.target.httpBaseUrl,
            wsBaseUrl: input.target.wsBaseUrl,
            providerKind: "manual",
          },
          origin: endpointOrigin(input.target.httpBaseUrl),
        },
      })
      .pipe(Effect.mapError(environmentApiError("Could not obtain environment link proof.")));
    const link = yield* relayClient
      .linkEnvironment({
        zeropsToken: input.zeropsToken,
        payload: {
          proof,
          notificationsEnabled: true,
          liveActivitiesEnabled: true,
        },
      })
      .pipe(
        Effect.mapError(
          decodedRelayClientError(`${configuredRelayUrl}/v1/client/environment-links failed`),
        ),
      );
    yield* ensureLinkedEnvironmentMatches({
      expectedEnvironmentId: input.target.environmentId,
      environmentId: link.environmentId,
    });

    yield* environmentClient.connect
      .relayConfig({
        headers: {},
        payload: {
          relayUrl: configuredRelayUrl,
          relayIssuer: link.relayIssuer,
          cloudUserId: link.cloudUserId,
          environmentCredential: link.environmentCredential,
          cloudMintPublicKey: link.cloudMintPublicKey,
          // The relay no longer provisions managed tunnels, so a link
          // response no longer carries an endpoint runtime to apply.
          endpointRuntime: null,
        },
      })
      .pipe(Effect.mapError(environmentApiError("Could not configure environment relay access.")));
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}
