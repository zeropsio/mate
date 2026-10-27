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
 * The descriptors this client read moments ago, by base URL: a connect presents the one its door
 * just read instead of reading it again. Holds none unless the application provides a reader.
 */
export interface RecentEnvironmentDescriptors {
  readonly recent: (httpBaseUrl: string) => ExecutionEnvironmentDescriptor | null;
}

export class RecentEnvironmentDescriptorsRef extends Context.Reference<RecentEnvironmentDescriptors>(
  "@t3tools/client-runtime/environment/descriptor/RecentEnvironmentDescriptors",
  { defaultValue: () => ({ recent: () => null }) },
) {}
