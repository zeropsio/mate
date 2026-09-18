import {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkProofInvalidReason,
  type RelayEnvironmentLinkRequest,
} from "@t3tools/contracts/relay";
import {
  decodeRelayJwt,
  normalizeRelayIssuer,
  RELAY_LINK_PROOF_TYP,
  verifyRelayJwt,
} from "@t3tools/shared/relayJwt";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as EnvironmentCredentials from "./EnvironmentCredentials.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";
import * as RelayConfiguration from "../Config.ts";
import * as ZeropsAuth from "../zerops/ZeropsAuth.ts";
import * as ZeropsProjectBinding from "../zerops/ZeropsProjectBinding.ts";

export class EnvironmentLinkProofExpired extends Schema.TaggedError<EnvironmentLinkProofExpired>()(
  "EnvironmentLinkProofExpired",
  {
    userId: Schema.String,
    environmentId: Schema.String,
    expiresAt: Schema.String,
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' link proof expired at ${this.expiresAt}`;
  }
}

export class EnvironmentLinkProofInvalid extends Schema.TaggedError<EnvironmentLinkProofInvalid>()(
  "EnvironmentLinkProofInvalid",
  {
    userId: Schema.String,
    environmentId: Schema.String,
    reason: RelayEnvironmentLinkProofInvalidReason,
    stage: Schema.Literals([
      "decode_token",
      "decode_payload",
      "verify_proof",
      "authorize_capabilities",
      "validate_descriptor",
      "verify_challenge",
      "validate_expiration",
      "consume_proof_nonce",
      "consume_challenge_nonce",
      "validate_endpoint",
      "verify_zerops_binding",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' link proof is invalid during ${this.stage}: ${this.reason}`;
  }
}

/** The presented Zerops token is valid but its owner is not a member of the claimed project. */
export class EnvironmentLinkNotAuthorized extends Schema.TaggedError<EnvironmentLinkNotAuthorized>()(
  "EnvironmentLinkNotAuthorized",
  {
    userId: Schema.String,
    environmentId: Schema.String,
  },
) {
  override get message(): string {
    return `User '${this.userId}' is not authorized to link environment '${this.environmentId}': not a member of its claimed Zerops project`;
  }
}

/** The Zerops API could not be reached or answered something unusable while verifying the project claim. */
export class EnvironmentLinkUnavailable extends Schema.TaggedError<EnvironmentLinkUnavailable>()(
  "EnvironmentLinkUnavailable",
  {
    userId: Schema.String,
    environmentId: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' link is unavailable for user '${this.userId}': ${this.reason}`;
  }
}

export type EnvironmentLinkError =
  | EnvironmentLinkProofExpired
  | EnvironmentLinkProofInvalid
  | EnvironmentLinkNotAuthorized
  | EnvironmentLinkUnavailable
  | DpopProofs.DpopProofReplayPersistenceError
  | EnvironmentLinks.EnvironmentLinkUpsertPersistenceError
  | EnvironmentCredentials.EnvironmentCredentialCreatePersistenceError;

export class EnvironmentLinker extends Context.Service<
  EnvironmentLinker,
  {
    readonly link: (input: {
      readonly userId: string;
      /** The caller's own Zerops access token — proves project membership, never a container credential. */
      readonly token: string;
      readonly request: RelayEnvironmentLinkRequest;
    }) => Effect.Effect<
      {
        readonly environmentId: RelayEnvironmentLinkProofPayload["environmentId"];
        readonly endpoint: RelayEnvironmentLinkProofPayload["endpoint"];
        readonly environmentCredential: string;
      },
      EnvironmentLinkError
    >;
  }
>()("t3code-relay/environments/EnvironmentLinker") {}

const decodeProof = Schema.decodeUnknownEffect(RelayEnvironmentLinkProofPayload);

function proofAuthorizesRequestedCapabilities(
  proof: RelayEnvironmentLinkProofPayload,
  request: RelayEnvironmentLinkRequest,
): boolean {
  const scopes = new Set(proof.scopes);
  return !(
    (request.notificationsEnabled || request.liveActivitiesEnabled) &&
    !scopes.has("agent_activity_notifications")
  );
}

// Every environment this relay links now runs on Zerops, reached over its own
// public HTTPS subdomain — there is no more relay-provisioned tunnel to make
// an endpoint secure. This check is what is left of that: the environment
// must present a genuinely secure address, not a loopback stand-in.
function isSecureEndpoint(endpoint: RelayEnvironmentLinkProofPayload["endpoint"]): boolean {
  try {
    const httpUrl = new URL(endpoint.httpBaseUrl);
    const wsUrl = new URL(endpoint.wsBaseUrl);
    return httpUrl.protocol === "https:" && wsUrl.protocol === "wss:";
  } catch {
    return false;
  }
}

const make = Effect.gen(function* () {
  const links = yield* EnvironmentLinks.EnvironmentLinks;
  const credentials = yield* EnvironmentCredentials.EnvironmentCredentials;
  const proofReplay = yield* DpopProofs.DpopProofReplay;
  const relayTokens = yield* RelayTokens.RelayTokens;
  const config = yield* RelayConfiguration.RelayConfiguration;
  const httpClient = yield* HttpClient.HttpClient;
  const zeropsApiBaseUrl = ZeropsAuth.resolveZeropsApiBaseUrl(config.zeropsApiHost);

  return EnvironmentLinker.of({
    link: Effect.fn("relay.environment_linker.link")(function* (input) {
      const now = yield* DateTime.now;
      const nowSeconds = Math.floor(now.epochMilliseconds / 1_000);
      const unverified = yield* Effect.try({
        try: () => decodeRelayJwt(input.request.proof),
        catch: (cause) =>
          new EnvironmentLinkProofInvalid({
            userId: input.userId,
            environmentId: "unknown",
            reason: "invalid_signature_or_scope",
            stage: "decode_token",
            cause,
          }),
      });
      const candidate = yield* decodeProof(unverified).pipe(
        Effect.mapError(
          (cause) =>
            new EnvironmentLinkProofInvalid({
              userId: input.userId,
              environmentId: "unknown",
              reason: "invalid_signature_or_scope",
              stage: "decode_payload",
              cause,
            }),
        ),
      );
      yield* Effect.annotateCurrentSpan({
        "relay.environment_id": candidate.environmentId,
        "relay.link.notifications_enabled": input.request.notificationsEnabled,
        "relay.link.live_activities_enabled": input.request.liveActivitiesEnabled,
      });
      if (candidate.exp <= nowSeconds) {
        return yield* new EnvironmentLinkProofExpired({
          userId: input.userId,
          environmentId: candidate.environmentId,
          expiresAt: DateTime.formatIso(DateTime.makeUnsafe(candidate.exp * 1_000)),
        });
      }
      const issuer = `t3-env:${candidate.environmentId}`;
      const relayIssuer = normalizeRelayIssuer(config.relayIssuer);
      const verified = yield* verifyRelayJwt({
        publicKey: candidate.environmentPublicKey,
        token: input.request.proof,
        typ: RELAY_LINK_PROOF_TYP,
        issuer,
        audience: relayIssuer,
        nowEpochSeconds: nowSeconds,
      }).pipe(
        Effect.flatMap(decodeProof),
        Effect.mapError(
          (cause) =>
            new EnvironmentLinkProofInvalid({
              userId: input.userId,
              environmentId: candidate.environmentId,
              reason: "invalid_signature_or_scope",
              stage: "verify_proof",
              cause,
            }),
        ),
      );
      if (
        verified.sub !== verified.environmentId ||
        !proofAuthorizesRequestedCapabilities(verified, input.request)
      ) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: candidate.environmentId,
          reason: "invalid_signature_or_scope",
          stage: "authorize_capabilities",
        });
      }
      if (verified.descriptor.environmentId !== verified.environmentId) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "descriptor_mismatch",
          stage: "validate_descriptor",
        });
      }
      const challenge = yield* relayTokens.verifyLinkChallenge({
        token: verified.challenge,
        userId: input.userId,
        request: {
          notificationsEnabled: input.request.notificationsEnabled,
          liveActivitiesEnabled: input.request.liveActivitiesEnabled,
        },
        nowEpochSeconds: nowSeconds,
      });
      if (challenge === null) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "challenge_invalid",
          stage: "verify_challenge",
        });
      }
      const expiresAt = DateTime.make(verified.exp * 1_000);
      if (expiresAt._tag === "None") {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "invalid_signature_or_scope",
          stage: "validate_expiration",
        });
      }
      const consumedNonce = yield* proofReplay.consume({
        thumbprint: verified.environmentPublicKey,
        jti: verified.jti,
        iat: verified.iat,
        expiresAt: expiresAt.value,
      });
      if (!consumedNonce) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "replayed_nonce",
          stage: "consume_proof_nonce",
        });
      }
      const consumedChallenge = yield* proofReplay.consume({
        thumbprint: "relay-environment-link-challenge",
        jti: challenge.jti,
        iat: challenge.iat,
        expiresAt: expiresAt.value,
      });
      if (!consumedChallenge) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "challenge_invalid",
          stage: "consume_challenge_nonce",
        });
      }
      if (!isSecureEndpoint(verified.endpoint)) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "endpoint_not_secure",
          stage: "validate_endpoint",
        });
      }
      // The proof so far only proves "an environment holding key K signed
      // this" — never that it sits inside the project it claims. Verify that
      // claim against the Zerops API using the CALLER's own token, never a
      // container credential.
      yield* ZeropsProjectBinding.verify({
        apiBaseUrl: zeropsApiBaseUrl,
        token: input.token,
        zeropsProjectId: verified.zeropsProjectId,
        endpointOrigin: verified.endpointOrigin,
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.catchTags({
          ZeropsNotAMemberError: () =>
            new EnvironmentLinkNotAuthorized({
              userId: input.userId,
              environmentId: verified.environmentId,
            }),
          ZeropsProjectNotFoundError: () =>
            new EnvironmentLinkProofInvalid({
              userId: input.userId,
              environmentId: verified.environmentId,
              reason: "zerops_project_not_bound",
              stage: "verify_zerops_binding",
            }),
          ZeropsEndpointNotBoundError: () =>
            new EnvironmentLinkProofInvalid({
              userId: input.userId,
              environmentId: verified.environmentId,
              reason: "zerops_project_not_bound",
              stage: "verify_zerops_binding",
            }),
          ZeropsApiUnavailableError: (error) =>
            new EnvironmentLinkUnavailable({
              userId: input.userId,
              environmentId: verified.environmentId,
              reason: error.reason,
            }),
        }),
      );
      yield* links.upsert({ ...input, proof: verified, endpoint: verified.endpoint });
      const environmentCredential = yield* credentials.create({
        environmentId: verified.environmentId,
        environmentPublicKey: verified.environmentPublicKey,
      });
      return {
        environmentId: verified.environmentId,
        endpoint: verified.endpoint,
        environmentCredential,
      };
    }),
  });
});

export const layer = Layer.effect(EnvironmentLinker, make);
