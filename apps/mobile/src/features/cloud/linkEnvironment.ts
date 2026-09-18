import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import {
  EnvironmentCloudEndpointUnavailableError,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
  EnvironmentHttpUnauthorizedError,
} from "@t3tools/contracts";
import {
  type RelayEnvironmentLinkResponse as RelayEnvironmentLinkResponseType,
  type RelayProtectedError as RelayProtectedErrorType,
  type RelayManagedEndpointProviderKind,
} from "@t3tools/contracts/relay";
import { findErrorTraceId } from "@t3tools/client-runtime/errors";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";

import type { SavedRemoteConnection } from "../../lib/connection";
import * as MobilePreferences from "../../persistence/mobile-preferences";
import * as MobileStorage from "../../persistence/mobile-storage";
import { resolveCloudPublicConfig } from "./publicConfig";

function readRelayUrl(): string | null {
  return resolveCloudPublicConfig().relay.url;
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

const MANAGED_ENDPOINT_PROVIDER_KIND =
  "cloudflare_tunnel" satisfies RelayManagedEndpointProviderKind;

function cloudEnvironmentLinkError(message: string) {
  return (cause: unknown) => {
    const environmentError = findEnvironmentCloudApiError(cause);
    const traceId = findErrorTraceId(cause);
    return new CloudEnvironmentLinkError({
      message: environmentError
        ? `${message.replace(/[.:]$/, "")}: ${environmentError.message}`
        : withDevCause(message, cause),
      cause,
      ...(traceId === null ? {} : { traceId }),
    });
  };
}

function isDevRuntime(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function causeMessage(cause: unknown): string | null {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (typeof cause === "object" && cause !== null) {
    const record = cause as { readonly message?: unknown; readonly cause?: unknown };
    if (typeof record.message === "string" && record.message.length > 0) {
      const nested = causeMessage(record.cause);
      return nested ? `${record.message}: ${nested}` : record.message;
    }
  }
  return null;
}

function withDevCause(message: string, cause: unknown): string {
  if (!isDevRuntime()) {
    return message;
  }
  const detail = causeMessage(cause);
  return detail ? `${message} (${detail})` : message;
}

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
      return `Relay cannot provision the managed endpoint (${error.reason}).`;
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

function requireRelayUrl(): Effect.Effect<string, CloudEnvironmentLinkError> {
  const relayUrl = readRelayUrl();
  return relayUrl
    ? Effect.succeed(relayUrl)
    : Effect.fail(new CloudEnvironmentLinkError({ message: "Relay URL is not configured." }));
}

function endpointOrigin(httpBaseUrl: string) {
  const url = new URL(httpBaseUrl);
  return {
    localHttpHost: "127.0.0.1",
    localHttpPort: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

function ensureLinkedEnvironmentMatches(input: {
  readonly expectedEnvironmentId: string;
  readonly expectedProviderKind: RelayManagedEndpointProviderKind;
  readonly link: RelayEnvironmentLinkResponseType;
}): Effect.Effect<void, CloudEnvironmentLinkError> {
  if (input.link.environmentId !== input.expectedEnvironmentId) {
    return new CloudEnvironmentLinkError({
      message: "Relay returned credentials for a different environment.",
    });
  }
  if (input.link.endpoint.providerKind !== input.expectedProviderKind) {
    return new CloudEnvironmentLinkError({
      message: "Relay returned credentials for a different endpoint provider.",
    });
  }
  return Effect.void;
}

interface LinkEnvironmentToCloudInput {
  readonly connection: SavedRemoteConnection;
  readonly clerkToken: string;
}

type LinkEnvironmentToCloudRequirements =
  | HttpClient.HttpClient
  | ManagedRelay.ManagedRelayClient
  | MobileStorage.MobileStorage;

export function linkEnvironmentToCloudWithPreference(
  input: LinkEnvironmentToCloudInput & { readonly liveActivitiesEnabled: boolean },
): Effect.Effect<void, CloudEnvironmentLinkError, LinkEnvironmentToCloudRequirements> {
  return Effect.gen(function* () {
    if (!input.connection.bearerToken) {
      return yield* new CloudEnvironmentLinkError({
        message: "Only a locally paired bearer connection can be linked to the cloud.",
      });
    }
    const localBearerToken = input.connection.bearerToken;
    const relayUrl = yield* requireRelayUrl();
    const relayClient = yield* ManagedRelay.ManagedRelayClient;
    const storage = yield* MobileStorage.MobileStorage;
    const deviceId = yield* storage.loadOrCreateAgentAwarenessDeviceId.pipe(
      Effect.mapError(cloudEnvironmentLinkError("Could not load the mobile device id.")),
    );
    const liveActivitiesEnabled = input.liveActivitiesEnabled;
    const challenge = yield* relayClient
      .createEnvironmentLinkChallenge({
        // Still the Clerk session token; S5-3 sources zeropsToken from the
        // Zerops session instead.
        zeropsToken: input.clerkToken,
        payload: {
          notificationsEnabled: true,
          liveActivitiesEnabled,
        },
      })
      .pipe(
        Effect.mapError(
          decodedRelayClientError(`${relayUrl}/v1/client/environment-link-challenges failed`),
        ),
      );
    const environmentClient = yield* makeEnvironmentHttpApiClient(input.connection.httpBaseUrl);
    // RelayEnvironmentLinkProofPayload (the JWT the environment signs from this
    // request) now carries required `zeropsProjectId` + `endpointOrigin` fields,
    // verified relay-side against the caller's own Zerops token. The environment
    // itself must supply them when it builds and signs that proof — the request
    // schema below (RelayLinkProofRequest) has no field for mobile to source
    // them from; mobile has nothing that identifies the target's Zerops project
    // or public origin ahead of the S5-3 Zerops session. See handoff note.
    const proof = yield* environmentClient.connect
      .linkProof({
        headers: { authorization: `Bearer ${localBearerToken}` },
        payload: {
          challenge: challenge.challenge,
          relayIssuer: relayUrl,
          endpoint: {
            httpBaseUrl: input.connection.httpBaseUrl,
            wsBaseUrl: input.connection.wsBaseUrl,
            providerKind: MANAGED_ENDPOINT_PROVIDER_KIND,
          },
          origin: endpointOrigin(input.connection.httpBaseUrl),
        },
      })
      .pipe(Effect.mapError(cloudEnvironmentLinkError("Could not obtain environment link proof.")));
    const link = yield* relayClient
      .linkEnvironment({
        // Still the Clerk session token; S5-3 sources zeropsToken from the
        // Zerops session instead.
        zeropsToken: input.clerkToken,
        payload: {
          deviceId,
          proof,
          notificationsEnabled: true,
          liveActivitiesEnabled,
        },
      })
      .pipe(
        Effect.mapError(decodedRelayClientError(`${relayUrl}/v1/client/environment-links failed`)),
      );
    yield* ensureLinkedEnvironmentMatches({
      expectedEnvironmentId: input.connection.environmentId,
      expectedProviderKind: MANAGED_ENDPOINT_PROVIDER_KIND,
      link,
    });

    yield* environmentClient.connect
      .relayConfig({
        headers: { authorization: `Bearer ${localBearerToken}` },
        payload: {
          relayUrl,
          relayIssuer: link.relayIssuer,
          cloudUserId: link.cloudUserId,
          environmentCredential: link.environmentCredential,
          cloudMintPublicKey: link.cloudMintPublicKey,
          // The relay no longer provisions a managed tunnel as part of the link
          // response (RelayEnvironmentLinkResponse dropped `endpointRuntime`);
          // a Zerops-native environment is reached directly, never through one.
          endpointRuntime: null,
        },
      })
      .pipe(
        Effect.mapError(cloudEnvironmentLinkError("Could not configure environment relay access.")),
      );
  });
}

export function linkEnvironmentToCloud(
  input: LinkEnvironmentToCloudInput,
): Effect.Effect<
  void,
  CloudEnvironmentLinkError,
  LinkEnvironmentToCloudRequirements | MobilePreferences.MobilePreferencesStore
> {
  return MobilePreferences.MobilePreferencesStore.pipe(
    Effect.flatMap((preferencesStore) => preferencesStore.load),
    Effect.mapError(cloudEnvironmentLinkError("Could not load mobile notification preferences.")),
    Effect.flatMap((preferences) =>
      linkEnvironmentToCloudWithPreference({
        ...input,
        liveActivitiesEnabled: preferences.liveActivitiesEnabled !== false,
      }),
    ),
  );
}
