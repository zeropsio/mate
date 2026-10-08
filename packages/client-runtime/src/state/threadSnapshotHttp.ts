import type { OrchestrationThreadDetailSnapshot, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { mateDiagnostics } from "../zerops/diagnostics.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

// Long enough for a slow but alive server to finish. On a cold open a timeout
// makes the socket ask the same server for the same snapshot again, and older
// turn pages have no fallback, so a short deadline only drops work. The socket
// fallback is for setups where /api fails but /ws works, such as a proxy that
// blocks /api. A dead server drops the socket session, which interrupts a
// cold-open load. Older turn pages wait for this deadline.
const DEFAULT_THREAD_SNAPSHOT_TIMEOUT_MS = 20_000;

/**
 * Load a thread's detail snapshot over HTTP instead of embedding it in the
 * WebSocket subscription's first frame. The response is gzip-compressible by
 * the transport and keeps the (potentially multi-KB) snapshot off the socket.
 */
/**
 * Optional turn window for a snapshot fetch. Only send a window to servers
 * that advertise `threadSnapshotPagination`; older servers reject unknown
 * query parameters.
 */
export interface ThreadSnapshotWindow {
  readonly turnLimit: number;
  readonly beforeCursor?: string;
}

export const fetchEnvironmentThreadSnapshot = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadSnapshot",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly timeoutMs?: number;
  readonly window?: ThreadSnapshotWindow;
  readonly reasoningMessages?: boolean;
}) {
  const requestUrl = environmentEndpointUrl(
    input.prepared.httpBaseUrl,
    `/api/orchestration/threads/${input.threadId}`,
  );
  const started = performance.now();
  const fields = {
    kind: "history-stage" as const,
    environmentId: input.prepared.environmentId,
    threadId: input.threadId,
    source: "http" as const,
  };
  let decodeStarted = started;
  const httpClient = yield* HttpClient.HttpClient;
  const measuredClient = mateDiagnostics.enabled
    ? HttpClient.transformResponse(httpClient, (responseEffect) =>
        Effect.gen(function* () {
          const requested = performance.now();
          mateDiagnostics.record({ ...fields, stage: "prepare", durationMs: requested - started });
          mateDiagnostics.record({ ...fields, stage: "request" });
          const response = yield* responseEffect;
          const received = performance.now();
          mateDiagnostics.record({
            ...fields,
            stage: "headers",
            durationMs: received - requested,
            ...(response.headers["server-timing"] === undefined
              ? {}
              : { serverTiming: response.headers["server-timing"] }),
          });
          const text = yield* response.text;
          // Keep the generated client's status/error/schema decoder. Its JSON reader uses
          // this already-read text, so measuring transfer does not decode the body twice.
          Object.defineProperty(response, "text", { value: Effect.succeed(text) });
          mateDiagnostics.record({
            ...fields,
            stage: "body",
            durationMs: performance.now() - received,
            decodedChars: text.length,
          });
          decodeStarted = performance.now();
          return response;
        }),
      )
    : httpClient;
  const client = yield* makeEnvironmentHttpApiGroupClient(
    input.prepared.httpBaseUrl,
    "orchestration",
  ).pipe(Effect.provideService(HttpClient.HttpClient, measuredClient));
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "GET",
    requestUrl,
    input.signer,
  );
  const snapshot = yield* executeEnvironmentHttpRequest(
    requestUrl,
    input.timeoutMs ?? DEFAULT_THREAD_SNAPSHOT_TIMEOUT_MS,
    withEnvironmentCredentials(
      input.prepared.httpAuthorization,
      client.threadSnapshot({
        params: { threadId: input.threadId },
        payload: {
          ...(input.reasoningMessages === true ? { reasoningMessages: "true" as const } : {}),
          ...(input.window !== undefined ? { turnLimit: input.window.turnLimit } : {}),
          ...(input.window?.beforeCursor !== undefined
            ? { beforeCursor: input.window.beforeCursor }
            : {}),
        },
        headers,
      }),
    ),
  );
  mateDiagnostics.record({
    ...fields,
    stage: "decode",
    durationMs: performance.now() - decodeStarted,
  });
  return snapshot;
});

export type FetchEnvironmentThreadSnapshotError = RemoteEnvironmentRequestError;

/**
 * Loads a thread's detail snapshot over HTTP, returning `Option.none()` when it
 * cannot be loaded (so the caller falls back to the socket-embedded snapshot).
 * Decouples the thread state machine from the underlying HTTP + DPoP details and
 * keeps them out of test contexts.
 */
export class ThreadSnapshotLoader extends Context.Service<
  ThreadSnapshotLoader,
  {
    readonly load: (
      prepared: PreparedConnection,
      threadId: ThreadId,
      window?: ThreadSnapshotWindow,
      reasoningMessages?: boolean,
    ) => Effect.Effect<Option.Option<OrchestrationThreadDetailSnapshot>>;
  }
>()("@t3tools/client-runtime/state/threadSnapshotHttp/ThreadSnapshotLoader") {}

export const threadSnapshotLoaderLayer: Layer.Layer<
  ThreadSnapshotLoader,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  ThreadSnapshotLoader,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    // Resolve the DPoP signer optionally: it is only needed for relay/DPoP
    // connections, so the loader must not hard-require it (bearer/primary
    // connections work without one).
    const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
    return ThreadSnapshotLoader.of({
      load: (
        prepared: PreparedConnection,
        threadId: ThreadId,
        window?: ThreadSnapshotWindow,
        reasoningMessages?: boolean,
      ) =>
        fetchEnvironmentThreadSnapshot({
          prepared,
          threadId,
          signer,
          ...(reasoningMessages === true ? { reasoningMessages: true } : {}),
          ...(window !== undefined ? { window } : {}),
        }).pipe(
          Effect.map(Option.some<OrchestrationThreadDetailSnapshot>),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          // A genuinely missing thread (404) is expected — the socket
          // subscription is the source of truth for thread existence and will
          // surface the deletion — so don't treat it as an error worth warning
          // about; just defer to the socket path.
          Effect.catchTags({
            EnvironmentResourceNotFoundError: () =>
              Effect.logDebug(
                "Thread snapshot not found over HTTP; deferring to the socket subscription.",
              ).pipe(
                Effect.annotateLogs({ threadId }),
                Effect.as(Option.none<OrchestrationThreadDetailSnapshot>()),
              ),
          }),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Could not load the thread snapshot over HTTP; using the socket snapshot instead.",
            ).pipe(
              Effect.annotateLogs({ threadId, cause: Cause.pretty(cause) }),
              Effect.as(Option.none<OrchestrationThreadDetailSnapshot>()),
            ),
          ),
        ),
    });
  }),
);
