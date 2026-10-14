import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { CommandId, ConversationId, runId } from "@t3tools/contracts";

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
        assert.deepStrictEqual(yield* Effect.flatMap(w.engine, (engine) => engine.conversations), {
          views: [],
          unread: [],
          complete: true,
        });
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

type Agent = Parameters<Parameters<Effect.Success<typeof world>["agent"]>[0]>[0];
/** A piece of background work the agent starts: a helper, a helper's own shell, its own shell. */
const startsWork = (
  agent: Agent,
  thread: string,
  id: string,
  work: {
    readonly kind: "helper" | "shell" | "monitor";
    readonly title: string;
    readonly helper?: string;
  },
) =>
  agent.emit("task.started", thread, {
    payload: {
      taskId: id,
      taskType:
        work.kind === "helper" ? "local_agent" : work.kind === "monitor" ? "monitor" : "local_bash",
      description: work.title,
      ...(work.helper === undefined ? {} : { agentId: work.helper }),
    },
  });

describe("a conversation's background work after its turn", () => {
  // Codex's helper that finished its turn rests idle, resumable: the server read it as working
  // while every client read it at rest, and the conversation said it still worked with nothing
  // under it to name (Eli, 2026-10-14).
  it.effect.each([
    { status: "running", working: true },
    { status: "waiting", working: true },
    { status: "idle", working: false },
  ])(
    "keeps its conversation working only while it runs or waits on the person: $status",
    ({ status, working }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          yield* w.tell({ _tag: "Send", text: "Review the api" });
          yield* w.agent((agent, thread) =>
            startsWork(agent, thread, "h1", { kind: "helper", title: "Review the diff" }),
          );
          yield* w.agent((agent, thread) =>
            agent.emit("task.updated", thread, { payload: { taskId: "h1", status } }),
          );
          yield* w.agent((agent, thread) => agent.finish(thread));
          const view = yield* viewOf(w);
          const row = conversationRowOf(view!, { environmentId: "env", epoch: 1 });
          assert.strictEqual(view?.background, working ? "working" : null);
          assert.strictEqual(row.state.kind, working ? "working" : "idle");
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
        const bootAt = yield* Clock.currentTimeMillis;
        yield* w.boot;
        const view = yield* viewOf(w);
        assert.deepStrictEqual(view?.lastEnded?.end, {
          kind: "cut-by-restart",
          continuedBy: runId(mate, 2),
          restart: { cause: "restarted", at: DateTime.formatIso(DateTime.makeUnsafe(bootAt)) },
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
            "The Mate restarted. The run was cut and not continued (a maintenance turn): send a message to go on.",
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

describe("a call's progress, once the call ended", () => {
  it.effect("is cleared from the live plane: a later subscriber is not handed it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Stand up" });
        yield* w.agent((agent, thread) => agent.call(thread));
        const engine = yield* w.engine;
        yield* engine.callProgress(w.thread, "Command run", { phase: "deploy" });
        // The record closes the call before the relay's last word reaches the engine.
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* engine.callProgress(w.thread, "Command run", null);
        const live = yield* w.live;
        const [open] = yield* Stream.runCollect(Stream.take(yield* live.subscribe(mate), 1));
        assert.isUndefined((open as { readonly progress?: unknown }).progress);
        yield* w.shutdown;
      }),
    ),
  );
});

describe("a completed call's own record", () => {
  it.effect("is kept beside its item, for what a file write wrote", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Write the readme" });
        yield* w.agent((agent, thread) => agent.write(thread, "/var/www/README.md", "# Hi\n"));
        const engine = yield* w.engine;
        const call = (yield* w.items(runId(mate, 1))).find((item) => item.kind === "call");
        assert.strictEqual(call?.state, "closed");
        const written = yield* engine.callData(mate, { naming: "/var/www/README.md" });
        assert.deepStrictEqual(
          written.map((row) => [row.state, row.data]),
          [
            [
              "done",
              { toolName: "Write", input: { file_path: "/var/www/README.md", content: "# Hi\n" } },
            ],
          ],
        );
        const byId = yield* engine.callData(mate, { itemIds: [written[0]!.itemId] });
        assert.strictEqual(byId.length, 1);
        assert.deepStrictEqual(yield* engine.callData(mate, { naming: "/etc/passwd" }), []);
        yield* w.shutdown;
      }),
    ),
  );
});

describe("whether a woken run's words reached the agent", () => {
  const stoodUp = (w: Effect.Success<typeof world>) =>
    Effect.gen(function* () {
      const engine = yield* w.engine;
      const { wakeId } = yield* engine.wake({
        conversationId: mate,
        kind: "standup",
        key: "standup-1",
        principal: { kind: "standup", startedBy: "ana" },
        text: "Stand up the project.",
        dueAt: yield* Clock.currentTimeMillis,
      });
      yield* w.advance(1_000);
      return { engine, wakeId };
    });

  it.effect("a run whose session closed while its message was being sent may have reached it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        w.provider.options.holdNextSend = true;
        const { engine, wakeId } = yield* stoodUp(w);
        yield* w.agent((agent, thread) => agent.crash(thread));
        const run = yield* engine.runOf({ wakeId });
        assert.isNotNull(run?.end);
        assert.strictEqual(run?.reachedAgent, "unknown");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a run its admission refused never reached it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* makeEngineWorld({ driver: "claudeAgent", refuse: "Ana is gone." });
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
        const { engine, wakeId } = yield* stoodUp(w);
        const run = yield* engine.runOf({ wakeId });
        assert.deepStrictEqual([run?.end?.kind, run?.reachedAgent], ["failed", false]);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a run that started reached it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const { engine, wakeId } = yield* stoodUp(w);
        assert.strictEqual((yield* engine.runOf({ wakeId }))?.reachedAgent, true);
        yield* w.shutdown;
      }),
    ),
  );
});

describe("the views of every conversation", () => {
  it.effect(
    "a conversation that cannot be read is named as unread, and every other one is listed",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const broken = ConversationId.make("broken");
          yield* w.tell({ _tag: "Send", text: "hello" });
          yield* w.within(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql`INSERT INTO engine_conversation (conversation_id, head_seq, updated_at)
              VALUES (${broken}, 1, 0)`;
              // A known event with its body damaged: the conversation cannot be loaded.
              yield* sql`INSERT INTO engine_event
              (conversation_id, seq, type, v, at, command_id, run_id, payload_json)
              VALUES (${broken}, 1, 'SessionClosed', 1, 0, 'x', NULL, '{"sessionId":"s"}')`;
            }),
          );
          const engine = yield* w.engine;
          const list = yield* engine.conversations;
          assert.deepStrictEqual(
            list.views.map((view) => view.conversationId),
            [mate],
          );
          assert.deepStrictEqual(list.unread, [broken]);
          assert.isFalse(list.complete);
          yield* w.shutdown;
        }),
      ),
  );
});

describe("the crew's door into a conversation", () => {
  const crew = { kind: "crew", startedBy: "ana" } as const;

  it.effect("a delivery told twice under one command id acts once, answered by its receipt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const engine = yield* w.engine;
        const card = { _tag: "Send", text: "Task #3: remember the email." } as const;
        const id = CommandId.make("crew-deliver:crew/main/e/crew.deliver/1");
        const first = yield* engine.deliver(mate, card, id, crew);
        const again = yield* engine.deliver(mate, card, id, crew);
        assert.deepStrictEqual(again, first);
        assert.strictEqual(first._tag === "Accepted" ? first.runId : null, runId(mate, 1));
        const queued = (yield* engine.eventsAfter(mate, 0)).filter(
          (event) => event._tag === "RunQueued",
        );
        assert.strictEqual(queued.length, 1);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("reads a conversation's record past a cursor, in order, with no gap", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const engine = yield* w.engine;
        yield* w.tell({ _tag: "Send", text: "Deploy the api" });
        yield* w.agent((agent, thread) => agent.finish(thread));
        const all = yield* engine.eventsAfter(mate, 0);
        const tail = yield* engine.eventsAfter(mate, 3);
        assert.deepStrictEqual(
          all.map((event) => event.seq),
          all.map((_, i) => i + 1),
        );
        assert.deepStrictEqual(tail, all.slice(3));
        assert.deepStrictEqual(
          (yield* engine.eventsAfter(mate, 0, 2)).map((event) => event.seq),
          [1, 2],
        );
        yield* w.shutdown;
      }),
    ),
  );
});

// Milo's run 9 (0.15.38): the value it asked for, end to end on the engine; the row of each commit
// between the answer and the wake is the menu row's to pin (`conversationRow.test.ts`).
describe("a conversation's row as a request is answered", () => {
  const revision = { environmentId: "env", epoch: 1 };
  const rowState = (w: Effect.Success<typeof world>) =>
    Effect.map(viewOf(w), (view) => conversationRowOf(view!, revision).state.kind);
  const askValue = (w: Effect.Success<typeof world>) =>
    w.agent((agent, thread) =>
      agent.zerops(
        thread,
        "zerops_env",
        { action: "request" },
        "request STRIPE_SECRET_KEY",
        JSON.stringify({
          requested: { key: "STRIPE_SECRET_KEY", scope: "shared", sensitive: true },
          nextActions: "Now waiting on the person.",
        }),
      ),
    );
  it.effect.each([
    { request: "a value saved", outcome: "saved" },
    { request: "a value declined", outcome: "declined" },
  ] as const)(
    "a value the person answers wakes the agent, its row waiting until then and working after: $request",
    ({ outcome }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          yield* w.tell({ _tag: "Send", text: "Wire up Stripe" });
          yield* askValue(w);
          yield* w.agent((agent, thread) => agent.finish(thread));
          const asked = (yield* w.requests).find((request) => request.state === "open");
          const before = yield* rowState(w);
          yield* w.tell({
            _tag: "Answer",
            requestId: asked!.request_id as never,
            answer: { outcome },
            summary: outcome,
          });
          const answered = yield* rowState(w);
          yield* w.settle;
          const woken = yield* rowState(w);
          assert.deepStrictEqual([before, answered, woken], ["waiting", "working", "working"]);
          yield* w.shutdown;
        }),
      ),
  );
});

// Milo's final engine run, 2026-10-11: at a turn end the faces flashed "done" for 37–245 ms. A turn
// the engine knows is next keeps the row on the work from one commit to the next, as the wire reads
// it: never at rest between the two.
describe("a conversation's row from a turn's end to the next turn the engine knows is due", () => {
  const revision = { environmentId: "env", epoch: 1 };
  type World = Effect.Success<typeof world>;
  /** What happens before the turn ends (it may start a job), and the turn's end up to the next. */
  type Before = (w: World) => Effect.Effect<string | undefined>;
  type End = (w: World, job: string | undefined) => Effect.Effect<void>;
  const before =
    <E>(act: (w: World) => Effect.Effect<string | undefined, E>): Before =>
    (w) =>
      Effect.orDie(act(w));
  const end =
    <E>(act: (w: World, job: string | undefined) => Effect.Effect<unknown, E>): End =>
    (w, job) =>
      Effect.asVoid(Effect.orDie(act(w, job)));
  const ends: ReadonlyArray<readonly [string, Before, End]> = [
    [
      "a queued message",
      before((w) => Effect.as(w.tell({ _tag: "Send", text: "and then the docs" }), undefined)),
      end((w) => w.agent((agent, thread) => agent.finish(thread))),
    ],
    [
      "the agent's own turn on its finished job",
      before((w) =>
        Effect.gen(function* () {
          const job = yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
          return job;
        }),
      ),
      end((w, job) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.endWork(thread, job!));
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
        }),
      ),
    ],
    [
      "the agent's word on a value the person answered",
      before((w) =>
        Effect.as(
          w.agent((agent, thread) =>
            agent.zerops(
              thread,
              "zerops_env",
              { action: "request" },
              "request STRIPE_SECRET_KEY",
              JSON.stringify({
                requested: { key: "STRIPE_SECRET_KEY", scope: "shared", sensitive: true },
                nextActions: "Now waiting on the person.",
              }),
            ),
          ),
          undefined,
        ),
      ),
      end((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.finish(thread));
          const asked = (yield* w.requests).find((request) => request.state === "open");
          yield* w.tell({
            _tag: "Answer",
            requestId: asked!.request_id as never,
            answer: { outcome: "saved" },
            summary: "saved",
          });
          yield* w.settle;
        }),
      ),
    ],
    [
      "a wake its crash armed",
      before((w) => w.agent((agent, thread) => agent.startWork(thread))),
      end((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.agent((agent, thread) => agent.crash(thread));
          yield* w.advance(0);
        }),
      ),
    ],
  ];
  it.effect.each(ends.map(([next, first, ending]) => ({ next, first, ending })))(
    "never reads at rest between them: $next",
    ({ first, ending }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const engine = yield* w.engine;
          yield* w.tell({ _tag: "Send", text: "Deploy the api" });
          const job = yield* first(w);
          const kinds: Array<string> = [];
          const reading = yield* Effect.forkScoped(
            Stream.runForEach(engine.changes, () =>
              Effect.map(viewOf(w), (view) => {
                if (view == null) return;
                const row = conversationRowOf(view, revision);
                // The client reads a working row with no run on and nothing it waits on as at rest
                // (Milo's recheck: the crash wake and the answered value's wake flashed idle).
                kinds.push(
                  row.state.kind === "working" &&
                    !row.state.waitsOnHelpers &&
                    row.activeRunId === null
                    ? "working, at rest"
                    : row.state.kind,
                );
              }),
            ),
          );
          yield* ending(w, job);
          yield* Fiber.interrupt(reading);
          assert.isAbove(kinds.length, 0);
          assert.deepStrictEqual(
            kinds.filter((kind) => ["idle", "failed", "working, at rest"].includes(kind)),
            [],
          );
          assert.strictEqual((yield* w.run(runId(mate, 2)))?.state, "running");
          yield* w.shutdown;
        }),
      ),
  );
});
