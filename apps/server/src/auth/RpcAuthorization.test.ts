import {
  AuthExecOperateScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import {
  ownerOnlyRpcMethod,
  RPC_REQUIRED_SCOPES,
  requiredScopeForRpcMethod,
  rpcScopeAuthorizationLayer,
} from "./RpcAuthorization.ts";
import { rpcInstrumentationLayer } from "../observability/RpcInstrumentation.ts";

describe("RPC authorization scopes", () => {
  it("declares exactly one scope for every RPC in the server group", () => {
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it("authorizes background policy reporting and observation deliberately", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportClientActivity)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportHostPowerState)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverGetBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.subscribeBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
  });

  it("allows relay status reads without granting relay installation access", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudGetRelayClientStatus)).toBe(
      AuthRelayReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudInstallRelayClient)).toBe(AuthRelayWriteScope);
  });

  it("requires permission to operate on a thread before uploading feedback", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.providerUploadFeedback)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("rejects unknown RPC method names", () => {
    for (const method of ["server.notRegistered", "toString", "constructor"]) {
      expect(() => requiredScopeForRpcMethod(method)).toThrow(
        `RPC method ${method} has no declared authorization scope.`,
      );
    }
  });
});

describe("RPC scope middleware", () => {
  const tested = [WS_METHODS.serverProbe, WS_METHODS.serverRetryResourceTelemetry] as const;
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, (typeof tested)[number]> =>
        !(tested as ReadonlyArray<string>).includes(tag),
    ),
  );

  it.effect("checks each RPC's declared scope before its handler runs", () =>
    Effect.gen(function* () {
      const handled: Array<string> = [];
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
            group.toLayerHandler(WS_METHODS.serverRetryResourceTelemetry, () =>
              Effect.sync(() => handled.push("retry")).pipe(Effect.andThen(Effect.never)),
            ),
            rpcScopeAuthorizationLayer([AuthOrchestrationReadScope], Effect.succeed(false)),
            rpcInstrumentationLayer,
          ),
        ),
      );

      expect(yield* client[WS_METHODS.serverProbe]({})).toEqual({});
      expect(
        yield* client[WS_METHODS.serverRetryResourceTelemetry]({}).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationOperateScope,
      });
      expect(handled).toEqual([]);
    }).pipe(Effect.scoped),
  );
});

describe("someone else's Mate", () => {
  it.each([
    ["sending a message", WS_METHODS.engineSend],
    ["stopping a turn", WS_METHODS.engineStop],
    ["answering an approval or a question", WS_METHODS.engineAnswer],
    ["archiving a conversation", WS_METHODS.engineSetArchived],
    ["opening a terminal", WS_METHODS.terminalOpen],
    ["typing into a terminal", WS_METHODS.terminalWrite],
    ["running a command", WS_METHODS.execRun],
    ["pulling or switching git refs", WS_METHODS.vcsPull],
    ["signing an agent in", WS_METHODS.zeropsAgentLoginStart],
    ["signing an agent out", WS_METHODS.zeropsAgentLoginSignOut],
    ["changing settings", WS_METHODS.serverUpdateSettings],
    ["adding an MCP server", WS_METHODS.mcpServersAdd],
    ["pressing on a crew surface", WS_METHODS.zeropsCrewCommand],
    ["updating the Mate", WS_METHODS.zeropsMateUpdate],
  ] as const)("a colleague cannot act in it: %s is its owner's alone", (_, method) => {
    expect(ownerOnlyRpcMethod(method)).toBe(true);
  });

  it.each([
    ["reading the conversation", WS_METHODS.subscribeEngineConversation],
    ["watching a sign-in's progress", WS_METHODS.providerAuthSubscribe],
    ["watching a terminal's output", WS_METHODS.subscribeTerminalEvents],
    ["reviewing changes", WS_METHODS.reviewGetDiffPreview],
    ["reading the Data Console", WS_METHODS.zeropsDataConsoleCall],
  ] as const)("a colleague still reads along: %s stays open", (_, method) => {
    expect(ownerOnlyRpcMethod(method)).toBe(false);
  });

  const tested = [WS_METHODS.serverProbe, WS_METHODS.serverRetryResourceTelemetry] as const;
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, (typeof tested)[number]> =>
        !(tested as ReadonlyArray<string>).includes(tag),
    ),
  );
  const clientFor = (readsAlong: boolean, ran: Deferred.Deferred<void>, administers = false) =>
    RpcTest.makeClient(group).pipe(
      Effect.provide(
        Layer.mergeAll(
          group.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
          group.toLayerHandler(WS_METHODS.serverRetryResourceTelemetry, () =>
            Deferred.succeed(ran, undefined).pipe(Effect.andThen(Effect.never)),
          ),
          rpcScopeAuthorizationLayer(
            [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
            Effect.succeed(readsAlong),
            Effect.succeed(administers),
          ),
          rpcInstrumentationLayer,
        ),
      ),
    );

  it.effect("the server refuses a colleague's acting call before it runs and lets them read", () =>
    Effect.gen(function* () {
      const ran = yield* Deferred.make<void>();
      const client = yield* clientFor(true, ran);
      expect(yield* client[WS_METHODS.serverProbe]({})).toEqual({});
      const refused = yield* client[WS_METHODS.serverRetryResourceTelemetry]({}).pipe(
        Effect.result,
      );
      expect(yield* Deferred.isDone(ran)).toBe(false);
      expect(refused).toMatchObject({
        failure: {
          _tag: "EnvironmentAuthorizationError",
          message: "Only this Mate's owner can do this here; you can read along.",
          requiredScope: AuthOrchestrationOperateScope,
        },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("the Mate's owner acts in it", () =>
    Effect.gen(function* () {
      const ran = yield* Deferred.make<void>();
      const client = yield* clientFor(false, ran);
      yield* client[WS_METHODS.serverRetryResourceTelemetry]({}).pipe(Effect.forkScoped);
      yield* Deferred.await(ran);
    }).pipe(Effect.scoped),
  );

  const updateGroup = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof WS_METHODS.zeropsMateUpdate> =>
        tag !== WS_METHODS.zeropsMateUpdate,
    ),
  );

  it.effect.each([
    { who: "its owner", along: false, admin: false, updates: true },
    { who: "an admin of its project", along: true, admin: true, updates: true },
    { who: "a colleague", along: true, admin: false, updates: false },
  ])(
    "a Mate is updated by its owner or an admin of its project: $who",
    ({ along, admin, updates }) =>
      Effect.gen(function* () {
        const ran = yield* Deferred.make<void>();
        const client = yield* RpcTest.makeClient(updateGroup).pipe(
          Effect.provide(
            Layer.mergeAll(
              updateGroup.toLayerHandler(WS_METHODS.zeropsMateUpdate, () =>
                Deferred.succeed(ran, undefined).pipe(
                  Effect.as({ action: "none" as const, restarted: false, serverVersion: "0.0.0" }),
                ),
              ),
              rpcScopeAuthorizationLayer(
                [AuthExecOperateScope],
                Effect.succeed(along),
                Effect.succeed(admin),
              ),
              rpcInstrumentationLayer,
            ),
          ),
        );
        const answer = yield* client[WS_METHODS.zeropsMateUpdate]({}).pipe(Effect.result);
        expect(yield* Deferred.isDone(ran)).toBe(updates);
        if (!updates)
          expect(answer).toMatchObject({
            failure: {
              _tag: "EnvironmentAuthorizationError",
              message: "Only this Mate's owner or an admin of its project can do this.",
              requiredScope: AuthExecOperateScope,
            },
          });
      }).pipe(Effect.scoped),
  );

  it.effect("an admin of its project still only reads along in someone else's Mate", () =>
    Effect.gen(function* () {
      const ran = yield* Deferred.make<void>();
      const client = yield* clientFor(true, ran, true);
      const refused = yield* client[WS_METHODS.serverRetryResourceTelemetry]({}).pipe(
        Effect.result,
      );
      expect(yield* Deferred.isDone(ran)).toBe(false);
      expect(refused).toMatchObject({
        failure: { message: "Only this Mate's owner can do this here; you can read along." },
      });
    }).pipe(Effect.scoped),
  );
});
