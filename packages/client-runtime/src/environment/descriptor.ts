import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "./endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiGroupClient } from "../rpc/http.ts";

const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;

export const fetchRemoteEnvironmentDescriptor = Effect.fn(
  "clientRuntime.environment.fetchRemoteEnvironmentDescriptor",
)(function* (input: { readonly httpBaseUrl: string; readonly timeoutMs?: number }) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "metadata");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/.well-known/t3/environment"),
    input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.descriptor(),
  );
});

/**
 * The tab's one reader of each Mate's descriptor, by base URL: a connect reads through it, so it
 * joins a read in flight, takes one settled moments ago, or starts the one the others then join.
 * Rejects when the Mate did not answer with a descriptor. Null, the default, means no share: the
 * connect reads the descriptor itself.
 */
interface SharedEnvironmentDescriptors {
  readonly descriptor: (
    httpBaseUrl: string,
    signal?: AbortSignal,
  ) => Promise<ExecutionEnvironmentDescriptor>;
}

export class SharedEnvironmentDescriptorsRef extends Context.Reference<SharedEnvironmentDescriptors | null>(
  "@t3tools/client-runtime/environment/descriptor/SharedEnvironmentDescriptors",
  { defaultValue: () => null },
) {}
