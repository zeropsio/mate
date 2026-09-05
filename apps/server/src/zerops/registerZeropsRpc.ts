/**
 * Registers the five Zerops feed RPCs (`zerops.lifecycle.get`,
 * `zerops.agentLogin.start`/`cancel`, `subscribeZeropsLifecycle`,
 * `subscribeZeropsAgentAuth`) — pulled out of the giant `WsRpcGroup.of({...})`
 * literal in `ws.ts` so the zone owns its own RPC wiring (audit C4). Same
 * handlers, same instrumentation, same scopes — `auth/RpcAuthorization.ts`
 * still owns the scope table, unchanged. S8b adds its stream and input RPC
 * here when it lands.
 */
import {
  WS_METHODS,
  type EnvironmentAuthorizationError,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";

type ZeropsRpcTag =
  | typeof WS_METHODS.zeropsLifecycleGet
  | typeof WS_METHODS.zeropsAgentLoginStart
  | typeof WS_METHODS.zeropsAgentLoginCancel
  | typeof WS_METHODS.subscribeZeropsLifecycle
  | typeof WS_METHODS.subscribeZeropsAgentAuth
  | typeof WS_METHODS.subscribeZeropsBrowserStream
  | typeof WS_METHODS.zeropsBrowserInput;

type ZeropsRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: ZeropsRpcTag }>;

/**
 * The handler function types `WsRpcGroup.of({...})` expects for exactly
 * these five tags. `Rpc.ToHandlerFn`'s own `Services` parameter defaults to
 * `any`; every collaborator here is already a resolved service (no `R` left
 * to satisfy), so it is pinned to `never` instead — an `any` requirements
 * channel is a type error in this codebase (`effect(anyInRequirementsChannel)`).
 */
export type ZeropsRpcHandlers = {
  readonly [Current in ZeropsRpc as Current["_tag"]]: Rpc.ToHandlerFn<Current, never>;
};

export interface RegisterZeropsRpcDeps {
  readonly zeropsLifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"];
  readonly zeropsAgentAuth: ZeropsAgentAuth.ZeropsAgentAuth["Service"];
  readonly zeropsAgentLogin: ZeropsAgentLoginModule.ZeropsAgentLogin["Service"];
  readonly zeropsBrowserStream: ZeropsBrowserStreamModule.ZeropsBrowserStream["Service"];
  /**
   * The connecting session's subject — the Zerops user id the door put on the
   * grant. Taken from the authenticated session in `ws.ts`, never from RPC
   * input: a client that could name its own subject could claim to be anyone.
   */
  readonly subject: string;
  /** `ws.ts`'s own scope-checked, metrics/trace-instrumented wrapper — same one every other RPC in the router goes through. */
  readonly observeRpcEffect: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly observeRpcStream: <A, E, R>(
    method: string,
    stream: Stream.Stream<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Stream.Stream<A, E | EnvironmentAuthorizationError, R>;
}

/** Registers the five Zerops feed RPCs. Called once from `ws.ts`. */
export const registerZeropsRpc = (deps: RegisterZeropsRpcDeps): ZeropsRpcHandlers => {
  const {
    zeropsLifecycle,
    zeropsAgentAuth,
    zeropsAgentLogin,
    zeropsBrowserStream,
    subject,
    observeRpcEffect,
    observeRpcStream,
  } = deps;

  return {
    [WS_METHODS.zeropsLifecycleGet]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsLifecycleGet, zeropsLifecycle.get(input.threadId), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsAgentLoginStart]: (input) =>
      observeRpcEffect(
        WS_METHODS.zeropsAgentLoginStart,
        zeropsAgentLogin.start(input.agentId, input.threadId, subject),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.zeropsAgentLoginCancel]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsAgentLoginCancel, zeropsAgentLogin.cancel(input.agentId), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.subscribeZeropsLifecycle]: (input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsLifecycle,
        Stream.unwrap(
          Effect.map(zeropsLifecycle.subscribe(input.threadId), ({ latest, changes }) =>
            Stream.concat(Stream.make(latest), changes),
          ),
        ),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.subscribeZeropsAgentAuth]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsAgentAuth,
        // Merges `ZeropsAgentAuth`'s snapshot with `ZeropsAgentLogin`'s
        // per-agent login state (S7 follow-up F8) into the ONE stream the
        // client reads. Subscribing to both FIRST (each returning its own
        // value-at-subscribe-time bundled with a live change stream — the
        // same subscribe-before-snapshot race the two feeds' own `subscribe`
        // already guards against) avoids a gap between reading an initial
        // value and starting to listen; a later change from EITHER source
        // re-reads both feeds' `latest` fresh rather than trusting a stale
        // captured value, since a `Stream.merge`'d change only tells us
        // SOMETHING moved, not which side.
        Stream.unwrap(
          Effect.gen(function* () {
            const authSub = yield* zeropsAgentAuth.subscribe;
            const loginSub = yield* zeropsAgentLogin.subscribe;
            const recombine = Effect.zip(zeropsAgentAuth.latest, zeropsAgentLogin.latest).pipe(
              Effect.map(([snapshot, logins]) =>
                ZeropsAgentLoginModule.mergeAgentAuthLogin(snapshot, logins),
              ),
            );
            const initial = ZeropsAgentLoginModule.mergeAgentAuthLogin(
              authSub.latest,
              loginSub.latest,
            );
            const changes = Stream.merge(
              Stream.map(authSub.changes, () => undefined),
              Stream.map(loginSub.changes, () => undefined),
            ).pipe(Stream.mapEffect(() => recombine));
            return Stream.concat(Stream.make(initial), changes);
          }),
        ),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.subscribeZeropsBrowserStream]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsBrowserStream,
        Stream.unwrap(zeropsBrowserStream.subscribe),
        {
          "rpc.aggregate": "zerops",
        },
      ),
    [WS_METHODS.zeropsBrowserInput]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsBrowserInput, zeropsBrowserStream.sendInput(input), {
        "rpc.aggregate": "zerops",
      }),
  } satisfies ZeropsRpcHandlers;
};
