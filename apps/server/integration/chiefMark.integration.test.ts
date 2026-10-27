// @effect-diagnostics nodeBuiltinImport:off -- a loopback HQ the Mate links to.
import { describe, expect, it } from "@effect/vitest";
import { NodeWS } from "@effect/platform-node/NodeSocket";
import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import type { LinkedMate } from "@t3tools/shared/mateLink";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { makeScriptedProvider } from "./scriptedProviderDriver.ts";
import { startScenarioMate } from "./scenarioMate.ts";

const protocol = MATE_ENGINE_PROTOCOLS[0]!;
const conversationId = ConversationId.make("chief-mark");
const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };

const mateState = (chief: LinkedMate["chief"]): LinkedMate => ({
  projectId: "P_MATE",
  name: "Ada",
  face: "face-1",
  standupRequestedBy: "owner",
  closedOff: true,
  signers: {},
  appId: null,
  appName: null,
  changes: [],
  chief,
});

/** An HQ on a loopback port: it answers a Mate's key with the first state, and sends more on demand. */
const fakeHq = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = new NodeWS.WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("HQ has no port");
    return { server, origin: `http://127.0.0.1:${address.port}` };
  }),
  ({ server }) => Effect.sync(() => server.close()),
);

describe("a Mate linked to HQ", () => {
  it.live(
    "opens a fresh provider session when HQ's Chief mark moves, back to an earlier Chief too",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const hq = yield* fakeHq;
          const answered = Promise.withResolvers<(chief: LinkedMate["chief"]) => void>();
          hq.server.on("connection", (socket) => {
            socket.on("message", (raw) => {
              if ((JSON.parse(String(raw)) as { type: string }).type !== "hello") return;
              const state = (chief: LinkedMate["chief"]) =>
                socket.send(JSON.stringify({ type: "state", mate: mateState(chief) }));
              state(null);
              answered.resolve(state);
            });
          });
          const provider = yield* makeScriptedProvider();
          const mate = yield* Effect.acquireRelease(
            Effect.promise(() =>
              startScenarioMate({
                projectId: "P_MATE",
                serviceId: "service-chief",
                hostname: "zcp",
                zeropsApiBaseUrl: "http://127.0.0.1:9/api/rest/public",
                zeropsApiToken: "mate-key",
                publicOrigin: "https://scenario.invalid",
                hq: { origin: hq.origin, credential: "unused" },
                now: Date.now,
                drivers: [provider.driver],
              }),
            ),
            (mate) => Effect.promise(() => mate.stop().then(mate.remove)),
          );
          yield* mate.engine.assignAgent(conversationId, {
            instanceId: "opencode",
            driver: "opencode",
            model: "gpt-5.4",
            profile: { kind: "mate" },
          });
          const frames = yield* Queue.unbounded<EngineConversationFrame>();
          yield* mate.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
            Stream.runForEach((frame) => Queue.offer(frames, frame)),
            Effect.forkScoped,
          );
          while ((yield* Queue.take(frames)).type !== "synchronized") {}

          let ordinal = 0;
          const say = (text: string) =>
            Effect.gen(function* () {
              ordinal += 1;
              yield* provider.turn([{ kind: "say", text: "Done." }]);
              const sent = yield* mate.engine.wire.send(
                { protocol, conversationId, commandId: CommandId.make(`say-${ordinal}`), text },
                caller,
              );
              expect(sent._tag).toBe("Accepted");
              while (true) {
                const frame = yield* Queue.take(frames);
                if (
                  frame.type === "changes" &&
                  frame.runs.some((run) => run.ordinal === ordinal && run.state === "ended")
                )
                  return;
              }
            });
          /** HQ names `chief`; returns once the Mate's engine recorded something in answer. */
          const hqNames = (
            state: (chief: LinkedMate["chief"]) => void,
            chief: LinkedMate["chief"],
          ) =>
            Effect.gen(function* () {
              const recorded = yield* Deferred.make<void>();
              yield* mate.engine.changes.pipe(
                Stream.take(1),
                Stream.runDrain,
                Effect.andThen(Deferred.succeed(recorded, undefined)),
                Effect.forkScoped,
              );
              yield* Effect.sync(() => state(chief));
              yield* Deferred.await(recorded);
            });

          const state = yield* Effect.promise(() => answered.promise);
          yield* say("first");
          expect(provider.sessionsStarted()).toBe(1);
          yield* hqNames(state, { projectId: "P_OTHER" });
          yield* say("second");
          expect(provider.sessionsStarted()).toBe(2);
          yield* hqNames(state, null);
          yield* say("third");
          expect(provider.sessionsStarted()).toBe(3);
        }),
      ),
  );
});
