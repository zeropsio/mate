import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { runId } from "@t3tools/contracts";

import { conversationRowOf } from "./conversationRow.ts";
import { makeEngineWorld, mate } from "../testing/pump/engineWorld.ts";

const world = Effect.gen(function* () {
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
  return w;
});

const viewOf = (w: Effect.Success<typeof world>) =>
  Effect.flatMap(w.engine, (engine) => engine.conversation(mate));

describe("a conversation's view", () => {
  it.effect("holds its agent, the person's last message and the agent's last words", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Deploy the api\nand tell me" });
        yield* w.agent((agent, thread) => agent.say(thread, "Deployed."));
        yield* w.agent((agent, thread) => agent.finish(thread));
        const view = yield* viewOf(w);
        assert.strictEqual(view?.agent?.instanceId, "claudeAgent");
        assert.strictEqual(view?.lastPerson?.text, "Deploy the api\nand tell me");
        assert.strictEqual(view?.lastAgent?.text, "Deployed.");
        assert.strictEqual(view?.activeRun, null);
        assert.strictEqual(view?.lastEnded?.id, runId(mate, 1));
        assert.deepStrictEqual(view?.lastEnded?.end, { kind: "completed" });
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("names the run on, the call it is on and the request it waits on", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Check the logs" });
        yield* w.agent((agent, thread) => agent.call(thread));
        const working = yield* viewOf(w);
        assert.strictEqual(working?.activeRun?.state, "running");
        assert.strictEqual(working?.liveCall?.words, "Command run");
        yield* w.agent((agent, thread) => agent.ask(thread, "approval"));
        const waiting = yield* viewOf(w);
        assert.strictEqual(waiting?.activeRun?.state, "waiting");
        assert.deepStrictEqual(
          waiting?.openRequests.map((request) => request.ask.kind),
          ["approval"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("is none for a conversation the engine holds no record of", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* makeEngineWorld({ driver: "codex" });
        yield* w.boot;
        assert.strictEqual(yield* viewOf(w), undefined);
        assert.deepStrictEqual(
          yield* Effect.flatMap(w.engine, (engine) => engine.conversations),
          [],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("changes with every commit of its conversation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const engine = yield* w.engine;
        const seen = yield* Effect.forkScoped(Stream.runCollect(Stream.take(engine.changes, 1)));
        yield* w.tell({ _tag: "Send", text: "hello" });
        assert.deepStrictEqual([...(yield* Fiber.join(seen))], [mate]);
        yield* w.shutdown;
      }),
    ),
  );
});

describe("a run a restart cut, as a person reads it", () => {
  const revision = { environmentId: "env", epoch: 1 };

  it.effect("says why the run was cut and that it carries on, while it does", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Deploy the api" });
        yield* w.agent((agent, thread) => agent.call(thread));
        yield* w.crash;
        yield* w.boot;
        const view = yield* viewOf(w);
        assert.deepStrictEqual(view?.lastEnded?.end, {
          kind: "cut-by-restart",
          continuedBy: runId(mate, 2),
          words: "Mate restarted.",
        });
        assert.strictEqual(view?.activeRun?.id, runId(mate, 2));
        assert.strictEqual(conversationRowOf(view!, revision).state.kind, "working");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("says why the run was cut and why it was not continued", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "/compact", maintenance: true });
        yield* w.crash;
        yield* w.boot;
        const view = yield* viewOf(w);
        assert.deepStrictEqual(conversationRowOf(view!, revision).state, {
          kind: "failed",
          errorLine:
            "Mate restarted. The run was cut and not continued (a maintenance turn): send a message to go on.",
        });
        yield* w.shutdown;
      }),
    ),
  );
});

describe("a conversation's agent", () => {
  it.effect("opens its sessions on the model options it was given (the first turn's effort)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* makeEngineWorld({ driver: "claudeAgent" });
        yield* w.boot;
        yield* w.tell({
          _tag: "AssignAgent",
          agent: {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            model: "m1",
            options: [{ id: "effort", value: "xhigh" }],
            profile: { kind: "mate" },
          },
        });
        yield* w.tell({ _tag: "Send", text: "Stand up" });
        assert.deepStrictEqual(
          (w.provider.starts[0] as { readonly modelSelection?: unknown }).modelSelection,
          { instanceId: "claudeAgent", model: "m1", options: [{ id: "effort", value: "xhigh" }] },
        );
        yield* w.shutdown;
      }),
    ),
  );
});

describe("the engine's doors for the grafts", () => {
  it.effect(
    "a stand-up wake runs for the principal it names, and its run is found by the wake",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* makeEngineWorld({ driver: "codex" });
          yield* w.boot;
          const engine = yield* w.engine;
          const given = yield* engine.assignAgent(mate, {
            instanceId: "codex",
            driver: "codex",
            model: "m1",
            profile: { kind: "mate" },
          });
          assert.isTrue(given);
          const now = yield* Clock.currentTimeMillis;
          const { wakeId } = yield* engine.wake({
            conversationId: mate,
            kind: "standup",
            key: "standup-1",
            principal: { kind: "standup", startedBy: "ana" },
            text: "Stand up the project.",
            dueAt: now,
          });
          yield* w.advance(1_000);
          const run = yield* engine.runOf({ wakeId });
          assert.strictEqual(run?.runId, runId(mate, 1));
          assert.strictEqual(run?.end, null);
          const started = yield* w.run(runId(mate, 1));
          assert.deepStrictEqual(
            [started?.trigger.kind, started?.trigger.cause],
            ["wake", "standup"],
          );
          yield* w.agent((agent, thread) => agent.finish(thread));
          assert.deepStrictEqual((yield* engine.runOf({ wakeId }))?.end, { kind: "completed" });
          yield* w.shutdown;
        }),
      ),
  );
});

describe("a call's progress", () => {
  it.effect("reaches the conversation's live plane under the call's item, never the record", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Stand up" });
        yield* w.agent((agent, thread) => agent.call(thread));
        const live = yield* w.live;
        const frames = yield* live.subscribe(mate);
        const engine = yield* w.engine;
        yield* engine.callProgress(w.thread, "Command run", { phase: "deploy" });
        yield* engine.callProgress("someone-else/s/1", "Command run", { phase: "x" });
        const [, progress] = yield* Stream.runCollect(Stream.take(frames, 2));
        const frame = progress as {
          readonly _tag: string;
          readonly key: string;
          readonly value: unknown;
        };
        assert.deepStrictEqual([frame._tag, frame.value], ["Progress", { phase: "deploy" }]);
        // Keyed by the call's item in the record: the run's item, not the person's message.
        assert.match(frame.key, new RegExp(`^${runId(mate, 1)}/i/[2-9]$`, "u"));
        yield* w.shutdown;
      }),
    ),
  );
});
