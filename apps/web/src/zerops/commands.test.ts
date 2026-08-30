import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import { EnvironmentId, ThreadId, WS_METHODS } from "@t3tools/contracts";
import type {
  ZeropsAgentLoginCancelInput,
  ZeropsAgentLoginStartInput,
  ZeropsAgentLoginStartResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { createZeropsCommandAtoms } from "./commands";

const ENVIRONMENT_ID = EnvironmentId.make("env-zerops-1");
const THREAD_ID = ThreadId.make("thread-a");

const makeHarness = Effect.gen(function* () {
  const startCalls: Array<ZeropsAgentLoginStartInput> = [];
  const cancelCalls: Array<ZeropsAgentLoginCancelInput> = [];
  const startResult: ZeropsAgentLoginStartResult = { terminalId: "terminal-login-1" };
  const client = {
    [WS_METHODS.zeropsAgentLoginStart]: (input: ZeropsAgentLoginStartInput) => {
      startCalls.push(input);
      return Effect.succeed(startResult);
    },
    [WS_METHODS.zeropsAgentLoginCancel]: (input: ZeropsAgentLoginCancelInput) => {
      cancelCalls.push(input);
      return Effect.void;
    },
  } as unknown as RpcSession["client"];
  const session = yield* SubscriptionRef.make(
    Option.some({
      client,
      initialConfig: Effect.never,
      ready: Effect.void,
      probe: Effect.void,
      closed: Effect.never,
    } as unknown as RpcSession),
  );
  const supervisor = {
    target: { environmentId: ENVIRONMENT_ID, label: "Zerops test" },
    session,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } as unknown as EnvironmentSupervisor["Service"];
  const layer = Layer.succeed(EnvironmentRegistry, {
    run: <A, E, R>(_id: EnvironmentId, effect: Effect.Effect<A, E, R>) =>
      Effect.provideService(effect, EnvironmentSupervisor, supervisor),
    runStream: <A, E, R>(_id: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
    followStream: <A, E, R>(_id: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
  } as unknown as EnvironmentRegistry["Service"]);
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));

  return {
    cancelCalls,
    commands: createZeropsCommandAtoms(Atom.runtime(layer)),
    registry,
    startCalls,
    startResult,
  };
});

describe("createZeropsCommandAtoms", () => {
  it.effect("starts a login through the RPC with the thread-scoped payload", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const input: ZeropsAgentLoginStartInput = {
        agentId: "claude-code",
        threadId: THREAD_ID,
      };

      const result = yield* Effect.promise(() =>
        rig.commands.agentLoginStart.run(rig.registry, {
          environmentId: ENVIRONMENT_ID,
          input,
        }),
      );

      expect(rig.startCalls).toEqual([input]);
      expect(result._tag).toBe("Success");
      if (result._tag === "Success") {
        expect(result.value).toEqual(rig.startResult);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("cancels a login through the RPC", () =>
    Effect.gen(function* () {
      const rig = yield* makeHarness;
      const input: ZeropsAgentLoginCancelInput = { agentId: "codex" };

      const result = yield* Effect.promise(() =>
        rig.commands.agentLoginCancel.run(rig.registry, {
          environmentId: ENVIRONMENT_ID,
          input,
        }),
      );

      expect(rig.cancelCalls).toEqual([input]);
      expect(result._tag).toBe("Success");
      if (result._tag === "Success") {
        expect(result.value).toBeUndefined();
      }
    }).pipe(Effect.scoped),
  );
});
