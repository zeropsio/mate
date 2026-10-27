import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { PreparedConnection } from "../../connection/model.ts";
import { environmentEndpointUrl } from "../../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
} from "../../rpc/http.ts";
import {
  buildEnvironmentAuthHeaders,
  withEnvironmentCredentials,
} from "../../state/environmentHttpAuth.ts";
// Bounded so a wedged environment cannot pin the permissions check (and with it
// the settings UI) in a loading state for long.
const DEFAULT_SESSION_STATE_TIMEOUT_MS = 6_000;

/**
 * Read the granted scopes of this client's session on one environment via its
 * `/api/auth/session` endpoint, authenticated with whatever credential the
 * connection was prepared with (cookie, bearer, or DPoP).
 */
export const fetchEnvironmentSessionState = Effect.fn(
  "clientRuntime.state.fetchEnvironmentSessionState",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly timeoutMs?: number;
}) {
  const requestUrl = environmentEndpointUrl(input.prepared.httpBaseUrl, "/api/auth/session");
  const client = yield* makeEnvironmentHttpApiGroupClient(input.prepared.httpBaseUrl, "auth");
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "GET",
    requestUrl,
    input.signer,
  );
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    input.timeoutMs ?? DEFAULT_SESSION_STATE_TIMEOUT_MS,
    withEnvironmentCredentials(input.prepared.httpAuthorization, client.session({ headers })),
  );
});
