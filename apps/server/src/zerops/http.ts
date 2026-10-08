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
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

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
import { ZeropsSetup } from "./ZeropsSetup.ts";

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
        Effect.catchTags({
          ZeropsInvalidTokenError: () => failEnvironmentAuthInvalid("invalid_credential"),
        }),
        // One reason for all six shape rules: which rule failed is a hint
        // towards a token that would pass, and the caller never needs it —
        // the app's answer to every one of them is to mint a fresh
        // throwaway.
        Effect.catchTags({
          ZeropsThrowawayRefusedError: () =>
            failEnvironmentOperationForbidden("zerops_throwaway_required"),
        }),
        Effect.catchTags({
          ZeropsReadOnlyError: () => failEnvironmentOperationForbidden("zerops_read_only"),
        }),
        Effect.catchTags({
          ZeropsNotAMemberError: () =>
            failEnvironmentOperationForbidden("zerops_project_membership_required"),
        }),
        Effect.catchTags({
          ZeropsProjectNotFoundError: () => failEnvironmentNotFound("zerops_project_not_found"),
        }),
        Effect.catchTags({
          ZeropsApiUnavailableError: (error) =>
            failEnvironmentInternal("zerops_membership_check_failed", error),
        }),
        Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
          failEnvironmentInternal("pairing_credential_issuance_failed", error),
        ),
      ),
    );
  }),
);

/**
 * `GET /setup.json` (`/mate/setup.json` behind the container's nginx): a new
 * Mate's setup, step by step (`ZeropsSetup`). Public and readable from any
 * origin — it carries no names, no error text and no secrets — so any
 * browser, signed in or not, can show how far the Mate has come. A server
 * outside a Zerops project answers 404, as an older Mate does.
 */
export const zeropsSetupRouteLayer = HttpRouter.add(
  "GET",
  "/setup.json",
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const setup = yield* Effect.serviceOption(ZeropsSetup);
    if (Option.isNone(setup) || !isZeropsEnvironment(config)) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    return HttpServerResponse.jsonUnsafe(yield* setup.value.document, {
      headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
    });
  }),
);
