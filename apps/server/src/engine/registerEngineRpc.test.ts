/**
 * The engine's wire over the socket: every call runs as the connecting session with the Mate's own
 * revision source.
 */
import {
  CommandId,
  ConversationId,
  ENGINE_WIRE_BUDGETS,
  EngineConversationFrame,
  EngineSubscribeInput,
  EngineWireError,
  ItemId,
  MATE_ENGINE_PROTOCOLS,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";

import { withStreamWindows } from "../RpcStreamWindow.ts";
import { engineStreamWindows, registerEngineRpc } from "./registerEngineRpc.ts";
import { makeEngineWire, type EngineWireShape, type WireCaller } from "./wire/EngineWire.ts";
import { unservedWire } from "./testing/inertEngine.ts";
import { makeEngineWorld, mate } from "./testing/pump/engineWorld.ts";

const passThrough = {
  admit: <A, E, R>(_method: string, effect: Effect.Effect<A, E, R>) => effect,
};
const source = Effect.succeed({ environmentId: "env-1", epoch: 7 });
const conversationId = ConversationId.make("mate");

describe("registerEngineRpc", () => {
  it.effect("runs a send as the connecting session, at the Mate's start epoch", () =>
    Effect.gen(function* () {
      const callers: Array<WireCaller> = [];
      const wire: EngineWireShape = {
        ...unservedWire,
        send: (_input, caller) =>
          Effect.sync(() => {
            callers.push(caller);
            return { _tag: "Accepted", seq: 1 } as const;
          }),
      };
      const handlers = registerEngineRpc({
        engine: { wire },
        source,
        subject: "ana",
        ...passThrough,
      });
      yield* handlers[WS_METHODS.engineSend]({
        protocol: 1,
        conversationId,
        commandId: CommandId.make("c1"),
        text: "Hi",
      });
      expect(callers).toEqual([{ subject: "ana", environmentId: "env-1", epoch: 7 }]);
    }),
  );
});

const subscribe = WS_METHODS.subscribeEngineConversation;

/**
 * The socket's server over a wire, with the conversation's window: what it sent a client that
 * subscribed (each message's frames by type), and that client's acknowledgement of one message.
 */
const socketOver = (wire: Pick<EngineWireShape, "subscribe">, payload: unknown) =>
  Effect.gen(function* () {
    const group = RpcGroup.make(
      Rpc.make(subscribe, {
        payload: EngineSubscribeInput,
        success: EngineConversationFrame,
        error: EngineWireError,
        stream: true,
      }),
    );
    const sent: Array<ReadonlyArray<unknown>> = [];
    const receive = yield* Deferred.make<Parameters<RpcServer.Protocol["Service"]["run"]>[0]>();
    const protocol = yield* RpcServer.Protocol.make((write) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(receive, write);
        const serialization = yield* RpcSerialization.RpcSerialization;
        return {
          disconnects: yield* Queue.unbounded<number>(),
          send: (_clientId, response) =>
            Effect.sync(() => {
              if (response._tag === "Chunk") sent.push(response.values);
            }),
          end: () => Effect.void,
          clientIds: Effect.succeed(new Set([0])),
          initialMessage: Effect.succeedNone,
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: false,
          supportsNotifications: true,
          codecFor: serialization.codecFor,
        };
      }),
    );
    const handlers = registerEngineRpc({
      engine: { wire: { ...unservedWire, ...wire } },
      source,
      subject: "ana",
      ...passThrough,
    });
    yield* RpcServer.make(group).pipe(
      Effect.provide(group.toLayerHandler(subscribe, (input) => handlers[subscribe](input))),
      Effect.provideService(RpcServer.Protocol, withStreamWindows(protocol, engineStreamWindows)),
      Effect.forkScoped,
    );
    const write = yield* Deferred.await(receive);
    yield* write(0, { _tag: "Request", id: "1", tag: subscribe, payload, headers: [] });
    return {
      /** Each message sent so far: its frames' types. */
      messages: () =>
        sent.map((values) =>
          values.map((value) =>
            typeof value === "object" && value !== null && "type" in value ? value.type : value,
          ),
        ),
      acknowledge: Effect.suspend(() => write(0, { _tag: "Ack", requestId: "1" })),
    };
  }).pipe(Effect.provide(RpcSerialization.layerJson));

/** A Mate that deployed twice, each a run of its own, and a client that draws deploys' results. */
const deployedTwice = Effect.gen(function* () {
  const w = yield* makeEngineWorld({ driver: "claudeAgent" });
  yield* w.boot;
  yield* w.tell({
    _tag: "AssignAgent",
    agent: {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "m1",
      profile: { kind: "mate" },
    },
  });
  for (const service of ["api", "worker"]) {
    yield* w.tell({ _tag: "Send", text: `Deploy the ${service}` });
    yield* w.agent((agent, thread) =>
      agent.zerops(thread, "zerops_deploy", { targetService: service }, service, '{"ok":true}'),
    );
    yield* w.agent((agent, thread) => agent.say(thread, "Deployed."));
    yield* w.agent((agent, thread) => agent.finish(thread));
  }
  const wire = yield* w.within(makeEngineWire({ coalesce: 0 }));
  const socket = yield* socketOver(wire, {
    protocol: MATE_ENGINE_PROTOCOLS[0],
    conversationId: mate,
    outcomes: { tools: ["zerops_deploy"] },
  });
  yield* w.settle;
  return { w, socket };
});

const OPENING = [["outcome"], ["outcome"], ["snapshot", "synchronized"]];

describe("a conversation opening over the socket", () => {
  // What is live keeps the pace it had: a client that is behind gets what happened meanwhile as
  // one message when it has caught up, never a message every 50 ms queued on a slow link.
  // witness: apps/server/src/engine/registerEngineRpc.ts | frame.type === "synchronized", → frame.type === "synchronised",
  it.effect(
    "what happens after a conversation's opening waits until the client has acknowledged all of it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { w, socket } = yield* deployedTwice;
          yield* w.tell({ _tag: "Send", text: "And the database" });
          expect(socket.messages()).toEqual(OPENING);
          yield* socket.acknowledge;
          yield* socket.acknowledge;
          yield* w.settle;
          expect(socket.messages()).toEqual(OPENING);
          yield* socket.acknowledge;
          yield* w.settle;
          expect(socket.messages()).toEqual([...OPENING, ["changes"]]);
          yield* w.shutdown;
        }),
      ),
  );

  // A client that reads nothing is owed a bounded part of an opening, whatever the opening holds.
  // witness: apps/server/src/engine/registerEngineRpc.ts | bytes: ENGINE_WIRE_BUDGETS.runPageBytes, → bytes: Number.MAX_SAFE_INTEGER,
  it.effect(
    "an opening larger than its window waits for the client's acknowledgements, message by message",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const frames = Array.from({ length: 12 }, () => [
            {
              type: "progress" as const,
              itemId: ItemId.make("item"),
              value: "x".repeat(ENGINE_WIRE_BUDGETS.outcomeFrameBytes),
            },
          ]);
          const socket = yield* socketOver(
            { subscribe: () => Stream.fromArrays(...frames) },
            { protocol: MATE_ENGINE_PROTOCOLS[0], conversationId },
          );
          const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, {
            discard: true,
          });
          yield* settle;
          // Two frames of 192 KB are under the window's 512 KB, the third is over it.
          expect(socket.messages()).toHaveLength(3);
          yield* socket.acknowledge;
          yield* settle;
          expect(socket.messages()).toHaveLength(4);
          yield* socket.acknowledge;
          yield* settle;
          expect(socket.messages()).toHaveLength(5);
        }),
      ),
  );
});
