/**
 * The client half of the Zerops door.
 *
 * The client hands the environment a throwaway minted for that one Mate — no
 * rights, seconds old, deleted as soon as this answers (`zeropsThrowaway.ts`)
 * — and the environment reads who minted it and hands back an ordinary pairing
 * credential. From there the flow is the upstream one: the credential goes
 * into the token exchange in `remote.ts`, unchanged, so this module is one
 * request wide.
 *
 * The person's own Zerops token never comes here. It reaches the Zerops API
 * and nothing else — which is the whole of guide 3.5.
 *
 * @module authorization/zerops
 */
import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "../rpc/http.ts";

const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Presents a throwaway at the Mate's door.
 *
 * The token in the body has no rights at all and is deleted seconds later
 * (`zeropsThrowaway.ts`); what the door reads out of it is who minted it. It
 * travels in the body as the subject being proven, never as this request's
 * Authorization header, and nothing here keeps it.
 */
export const presentZeropsThrowaway = Effect.fn(
  "clientRuntime.authorization.presentZeropsThrowaway",
)(function* (input: {
  readonly httpBaseUrl: string;
  readonly doorToken: string;
  readonly dpopProof?: string;
  readonly timeoutMs?: number;
}) {
  const client = yield* makeEnvironmentHttpApiClient(input.httpBaseUrl);
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/api/auth/zerops-throwaway"),
    input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.zerops.throwawayIdentity({
      headers: input.dpopProof ? { dpop: input.dpopProof } : {},
      payload: { token: input.doorToken },
    }),
  );
});
