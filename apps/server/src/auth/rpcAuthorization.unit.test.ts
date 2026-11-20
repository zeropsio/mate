import { expect, it } from "@effect/vitest";
import {
  AuthExecOperateScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  type AuthEnvironmentScope,
  RpcScopeAuthorization,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcMessage from "effect/rpc/RpcMessage";

import type { MateActing } from "../zerops/ZeropsHqLink.ts";
import { requiredScopeForRpcMethod, rpcScopeAuthorizationLayer } from "./RpcAuthorization.ts";

/**
 * Each call through the server's authorization on one connection: `"ran"` when its handler ran,
 * `"refused"` when the authorization failed the call before it.
 */
const verdicts = (
  methods: ReadonlyArray<string>,
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  acting: MateActing,
  administers: boolean,
) =>
  Effect.gen(function* () {
    const authorize = yield* RpcScopeAuthorization;
    const ran = new Set<string>();
    const verdict: Record<string, string> = {};
    for (const method of methods) {
      const rpc = WsRpcGroup.requests.get(method);
      // A method outside the group gets no verdict, which the expected record shows.
      if (rpc === undefined) continue;
      const handler = Effect.suspend(() => {
        ran.add(method);
        return Effect.die("handled");
      });
      yield* Effect.exit(
        Effect.scoped(
          authorize(handler, {
            client: new Rpc.ServerClient(0),
            requestId: RpcMessage.RequestId(0),
            // The middleware reads only the call's tag; a group's typed RPC is not assignable to
            // `AnyWithProps` under `exactOptionalPropertyTypes`, which the RPC server casts too.
            rpc: rpc as unknown as Rpc.AnyWithProps,
            payload: {},
            headers: Headers.empty,
          }),
        ),
      );
      verdict[method] = ran.has(method) ? "ran" : "refused";
    }
    return verdict;
  }).pipe(
    Effect.provide(
      rpcScopeAuthorizationLayer(scopes, Effect.succeed(acting), Effect.succeed(administers)),
    ),
  );

const everyScope = [
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthExecOperateScope,
  AuthReviewWriteScope,
];
const each = (methods: ReadonlyArray<string>, verdict: string) =>
  Object.fromEntries(methods.map((method) => [method, verdict]));

// witness: apps/server/src/auth/RpcAuthorization.ts | if (!ADMINISTERED_UNDER_OPERATE.has(rpc._tag)) → if (ADMINISTERED_UNDER_OPERATE.has(rpc._tag))
it.effect(
  "AU14: In someone else's Mate a colleague, a project admin included, only reads along: every acting call (message, stop, answer, terminal, command, Git, agent sign-in, settings, MCP, crew press) is refused before its handler runs, reading calls stay open, and only its owner or an admin of its project updates the Mate",
  () =>
    Effect.gen(function* () {
      const acting = [
        WS_METHODS.engineSend,
        WS_METHODS.engineStop,
        WS_METHODS.engineAnswer,
        WS_METHODS.terminalOpen,
        WS_METHODS.terminalWrite,
        WS_METHODS.execRun,
        WS_METHODS.vcsPull,
        WS_METHODS.gitRunStackedAction,
        WS_METHODS.zeropsAgentLoginStart,
        WS_METHODS.serverUpdateSettings,
        WS_METHODS.mcpServersAdd,
        WS_METHODS.zeropsCrewCommand,
      ];
      const reading = [
        WS_METHODS.subscribeEngineConversation,
        WS_METHODS.subscribeTerminalEvents,
        WS_METHODS.subscribeTerminalMetadata,
        WS_METHODS.reviewGetDiffPreview,
        WS_METHODS.zeropsDataConsoleCall,
      ];
      const update = WS_METHODS.zeropsMateUpdate;
      const methods = [...acting, ...reading, update];

      expect(yield* verdicts(methods, everyScope, "acts", false)).toEqual(each(methods, "ran"));
      expect(yield* verdicts(methods, everyScope, "reads-along", true)).toEqual({
        ...each(acting, "refused"),
        ...each(reading, "ran"),
        [update]: "ran",
      });
      expect(yield* verdicts(methods, everyScope, "reads-along", false)).toEqual({
        ...each(acting, "refused"),
        ...each(reading, "ran"),
        [update]: "refused",
      });
    }),
);

// witness: apps/server/src/auth/RpcAuthorization.ts | if (!Object.hasOwn(RPC_REQUIRED_SCOPES, method)) { → if (!(method in RPC_REQUIRED_SCOPES)) {
it.effect(
  "AU15: Every RPC of the server's group declares exactly one scope, checked before its handler runs, and an RPC name without one is refused",
  () =>
    Effect.gen(function* () {
      const unscoped = (methods: Iterable<string>) =>
        [...methods].filter((method) => {
          try {
            requiredScopeForRpcMethod(method);
            return false;
          } catch {
            return true;
          }
        });
      expect(unscoped(WsRpcGroup.requests.keys())).toEqual([]);
      const strangers = ["server.notRegistered", "toString", "constructor", "hasOwnProperty"];
      expect(unscoped(strangers)).toEqual(strangers);

      const reads = [WS_METHODS.serverProbe, WS_METHODS.subscribeEngineConversation];
      const operates = [WS_METHODS.engineSend, WS_METHODS.terminalWrite, WS_METHODS.execRun];
      expect(
        yield* verdicts([...reads, ...operates], [AuthOrchestrationReadScope], "acts", true),
      ).toEqual({ ...each(reads, "ran"), ...each(operates, "refused") });
    }),
);
