/**
 * The HTTP surface of the Zerops door: one route that turns a throwaway into
 * an ordinary pairing credential.
 *
 * It answers the platform's own three-way verdict, so a client can tell the
 * cases apart without guessing: `401` the token is not valid, `403` the token
 * is valid but its owner is not in this project, `404` this environment is not
 * inside a Zerops project (or was handed a project id the platform does not
 * know), `500` the platform could not be reached.
 *
 * @module zerops/http
 */
import { EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentNotFound,
  failEnvironmentOperationForbidden,
} from "../auth/http.ts";
import { verifyRequestDpopProof } from "../auth/dpop.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { mintZeropsThrowawayPairingCredential } from "./ZeropsIdentityGate.ts";

export const zeropsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "zerops",
  Effect.fnUntraced(function* (handlers) {
    const config = yield* ServerConfig.ServerConfig;

    return handlers.handle(
      "throwawayIdentity",
      Effect.fn("environment.zerops.throwawayIdentity")(
        function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const environment = config.zerops;
          if (environment === undefined || !isZeropsEnvironment(config)) {
            return yield* failEnvironmentNotFound("zerops_identity_unavailable");
          }
          const request = yield* HttpServerRequest.HttpServerRequest;
          const proofKeyThumbprint = args.headers.dpop
            ? yield* verifyRequestDpopProof({ request }).pipe(
                Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, () =>
                  failEnvironmentAuthInvalid("invalid_credential"),
                ),
                Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
                  failEnvironmentInternal("pairing_credential_issuance_failed", error),
                ),
              )
            : undefined;

          return yield* mintZeropsThrowawayPairingCredential({
            environment,
            token: args.payload.token,
            ...(proofKeyThumbprint ? { proofKeyThumbprint } : {}),
          });
        },
        Effect.catchTag("ZeropsInvalidTokenError", () =>
          failEnvironmentAuthInvalid("invalid_credential"),
        ),
        // One reason for all six shape rules: which rule failed is a hint
        // towards a token that would pass, and the caller never needs it —
        // the app's answer to every one of them is to mint a fresh
        // throwaway.
        Effect.catchTag("ZeropsThrowawayRefusedError", () =>
          failEnvironmentOperationForbidden("zerops_throwaway_required"),
        ),
        Effect.catchTag("ZeropsReadOnlyError", () =>
          failEnvironmentOperationForbidden("zerops_read_only"),
        ),
        Effect.catchTag("ZeropsNotAMemberError", () =>
          failEnvironmentOperationForbidden("zerops_project_membership_required"),
        ),
        Effect.catchTag("ZeropsProjectNotFoundError", () =>
          failEnvironmentNotFound("zerops_project_not_found"),
        ),
        Effect.catchTag("ZeropsApiUnavailableError", (error) =>
          failEnvironmentInternal("zerops_membership_check_failed", error),
        ),
        Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
          failEnvironmentInternal("pairing_credential_issuance_failed", error),
        ),
      ),
    );
  }),
);
