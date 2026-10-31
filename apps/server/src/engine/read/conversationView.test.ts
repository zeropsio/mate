import * as NodeSqlite from "node:sqlite";

import { assert, describe, it, vi } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { CommandId, ConversationId, runId, ThreadId } from "@t3tools/contracts";
import { USAGE_LIMIT_RESUME_PROMPT } from "@t3tools/shared/userAsk";

import { conversationRowOf } from "./conversationRow.ts";
import { makeEngineWorld, mate, type EngineWorld } from "../testing/pump/engineWorld.ts";

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

  it.effect("names the conversation by what the person typed, never by a page's request", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Build the tea catalog" });
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.tell({ _tag: "Send", text: "Open crew ports on appdev", fromPanel: true });
        yield* w.agent((agent, thread) => agent.finish(thread));
        const view = yield* viewOf(w);
        assert.strictEqual(view?.lastPerson?.text, "Open crew ports on appdev");
        assert.strictEqual(view?.lastAsked?.text, "Build the tea catalog");
        assert.strictEqual(
          conversationRowOf(view!, { environmentId: "env", epoch: 1 }).subject,
          "Build the tea catalog",
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("names a task's conversation by its brief, never by a follow-up on it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "Send", text: "Add a search box to the tea list" });
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.tell({
          _tag: "Send",
          text: "nova (comment): Keep the green tea first.",
          taskMessage: {
            id: "m-1",
            from: "comment",
            author: "nova",
            text: "Keep the green tea first.",
          },
        });
        yield* w.agent((agent, thread) => agent.finish(thread));
        const view = yield* viewOf(w);
        assert.strictEqual(view?.lastPerson?.text, "nova (comment): Keep the green tea first.");
        assert.strictEqual(view?.lastAsked?.text, "Add a search box to the tea list");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect.each([
    { case: "a compaction", text: "/compact", maintenance: true },
    { case: "a slash command", text: "/mcp", maintenance: false },
    { case: "the usage-limit resume", text: USAGE_LIMIT_RESUME_PROMPT, maintenance: false },
  ])(
    "keeps the person's last ask and its answer when $case follows them",
    ({ text, maintenance }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          yield* w.tell({ _tag: "Send", text: "Build the tea catalog" });
          yield* w.agent((agent, thread) => agent.say(thread, "The catalog is up."));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.tell({ _tag: "Send", text, ...(maintenance ? { maintenance } : {}) });
          yield* w.agent((agent, thread) => agent.finish(thread));
          const view = yield* viewOf(w);
          assert.strictEqual(view?.lastPerson?.text, "Build the tea catalog");
          assert.strictEqual(view?.lastAsked?.text, "Build the tea catalog");
          const row = conversationRowOf(view!, { environmentId: "env", epoch: 1 });
          assert.strictEqual(row.subject, "Build the tea catalog");
          assert.strictEqual(row.snippet, "The catalog is up.");
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

  it.effect(
    "names what still runs, oldest first, its own jobs apart from its helpers', never a monitor",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          yield* w.tell({ _tag: "Send", text: "Check the release" });
          yield* w.agent((agent, thread) =>
            Effect.gen(function* () {
              yield* startsWork(agent, thread, "t1", {
                kind: "shell",
                title: "Final batched browser check",
              });
              yield* startsWork(agent, thread, "t2", { kind: "monitor", title: "Watch the logs" });
              yield* startsWork(agent, thread, "h1", { kind: "helper", title: "Review the diff" });
              yield* startsWork(agent, thread, "t3", {
                kind: "shell",
                title: "Run the helper's tests",
                helper: "h1",
              });
            }),
          );
          yield* w.agent((agent, thread) => agent.finish(thread));
          const view = yield* viewOf(w);
          // The helper's own shell is the helper's work while the helper runs (Eli, 2026-10-14:
          // its helpers' shells read as "2 background jobs" of its own).
          assert.deepStrictEqual(
            view?.work?.map(({ title, of }) => ({ title, of })),
            [
              { title: "Final batched browser check", of: "mate" },
              { title: "Review the diff", of: "helper" },
            ],
          );
          const row = conversationRowOf(view!, { environmentId: "env", epoch: 1 });
          assert.strictEqual(row.state.kind === "working" ? row.state.work?.count : null, 2);
          yield* w.shutdown;
        }),
      ),
  );
});

describe("a helper's own work after its turn", () => {
  it.effect(
    "is its helper's while the helper runs, and named on its own once the helper ended",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          yield* w.tell({ _tag: "Send", text: "Check the release" });
          yield* w.agent((agent, thread) =>
            Effect.gen(function* () {
              yield* startsWork(agent, thread, "h1", { kind: "helper", title: "Review the diff" });
              yield* startsWork(agent, thread, "t1", {
                kind: "shell",
                title: "Run the helper's tests",
                helper: "h1",
              });
            }),
          );
          yield* w.agent((agent, thread) => agent.finish(thread));
          const named = (yield* viewOf(w))?.work?.map(({ title }) => title);
          assert.deepStrictEqual(named, ["Review the diff"]);
          yield* w.agent((agent, thread) =>
            agent.emit("task.completed", thread, {
              payload: { taskId: "h1", status: "completed" },
            }),
          );
          const view = yield* viewOf(w);
          assert.deepStrictEqual(
            view?.work?.map(({ title, of }) => ({ title, of })),
            [{ title: "Run the helper's tests", of: "helper" }],
          );
          assert.strictEqual(view?.background, "working");
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

describe("a conversation bound to the lease its agent acquired", () => {
  const lease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" } as const;
  const engine = { kind: "engine" } as const;

  it.effect("names the lease its agent works in, until the lease ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        assert.strictEqual((yield* viewOf(w))?.lease, null);
        yield* w.tell({ _tag: "BindLease", lease }, engine);
        assert.deepStrictEqual((yield* viewOf(w))?.lease, lease);
        yield* w.tell({ _tag: "UnbindLease", ended: "webpool-3" }, engine);
        assert.strictEqual((yield* viewOf(w))?.lease, null);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("keeps its lease through a kill of the server: the record holds it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({ _tag: "BindLease", lease }, engine);
        yield* w.kill;
        yield* w.boot;
        assert.deepStrictEqual((yield* viewOf(w))?.lease, lease);
        yield* w.shutdown;
      }),
    ),
  );

  // zcp keeps its lease records and work session in the session's working directory: a session
  // moved into the lease would find none of them after a reopen.
  it.effect(
    "opens every session where it always worked, through a kill of the server, and resolves its pictures there",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const cwds = () =>
            w.provider.starts.map((start) => (start as { readonly cwd?: string }).cwd);
          yield* w.tell({ _tag: "Send", text: "Lease a container for the footer" });
          yield* w.tell({ _tag: "BindLease", lease }, engine);
          yield* w.agent((agent, thread) => agent.finish(thread));
          const before = cwds();
          yield* w.kill;
          yield* w.boot;
          yield* w.tell({ _tag: "Send", text: "Fix the footer" });
          assert.deepStrictEqual(before, [w.dir]);
          assert.deepStrictEqual(cwds(), [w.dir]);
          const context = yield* (yield* w.engine).assetContext(ThreadId.make(mate));
          assert.strictEqual(context?.workspaceRoot, w.dir);
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

describe("a task's own run", () => {
  it.effect("is found by its task after a person's later run in the same conversation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const engine = yield* w.engine;
        // This world seats no Zerops user for a task: its run ends failed before it starts.
        yield* w.tell(
          {
            _tag: "Send",
            text: "#42 The cart forgets its teas",
            taskId: "task-1",
            taskAssignment: "1",
          },
          {
            kind: "task",
            taskId: "task-1",
            assignment: "1",
          },
        );
        yield* w.tell(
          { _tag: "AdoptTaskAssignment", taskId: "task-1", assignment: "2", runId: runId(mate, 1) },
          { kind: "task", taskId: "task-1", assignment: "2" },
        );
        assert.strictEqual((yield* viewOf(w))?.lastEnded?.taskAssignment, "2");
        yield* w.tell({ _tag: "Send", text: "Why did it stop?" });
        yield* w.agent((agent, thread) => agent.finish(thread));
        assert.deepStrictEqual((yield* viewOf(w))?.lastEnded?.end, { kind: "completed" });
        const own = yield* engine.runOf({ conversationId: mate, taskId: "task-1" });
        assert.strictEqual(own?.runId, runId(mate, 1));
        assert.strictEqual(own?.end?.kind, "failed");
        assert.deepStrictEqual(own?.principal, { kind: "task", taskId: "task-1", assignment: "1" });
        assert.strictEqual(own?.taskAssignment, "2");
        assert.isUndefined(yield* engine.runOf({ conversationId: mate, taskId: "task-2" }));
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

// Review r3-6: the lifecycle reads who is bound to a lease on its one ingest fiber, at every
// change of zcp's leases; a whole view of every conversation made each one wait on ten queries
// per conversation. The record's lease is all it needs.
describe("the leases of every conversation", () => {
  const lease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" } as const;

  it.effect(
    "are read from each conversation's record alone: one whose view cannot be read still says its lease",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          yield* w.tell({ _tag: "Send", text: "Lease a container for the footer" });
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.tell({ _tag: "BindLease", lease }, { kind: "engine" });
          yield* w.within(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql`UPDATE engine_run SET trigger_json = '{' WHERE conversation_id = ${mate}`;
            }),
          );
          const engine = yield* w.engine;
          assert.deepStrictEqual((yield* engine.conversations).unread, [mate]);
          assert.deepStrictEqual(yield* engine.leases, {
            leases: [{ conversationId: mate, lease }],
            complete: true,
          });
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "name a conversation whose record cannot be read as unread, never as bound to none",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const broken = ConversationId.make("broken");
          yield* w.tell({ _tag: "BindLease", lease }, { kind: "engine" });
          yield* w.within(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql`INSERT INTO engine_conversation (conversation_id, head_seq, updated_at)
            VALUES (${broken}, 1, 0)`;
              yield* sql`INSERT INTO engine_event
            (conversation_id, seq, type, v, at, command_id, run_id, payload_json)
            VALUES (${broken}, 1, 'SessionClosed', 1, 0, 'x', NULL, '{"sessionId":"s"}')`;
            }),
          );
          const engine = yield* w.engine;
          assert.deepStrictEqual(yield* engine.leases, {
            leases: [{ conversationId: mate, lease }],
            complete: false,
          });
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

/** The record's tables a view reads row by row. */
const RECORD_TABLES = ["engine_item", "engine_run", "engine_request"] as const;

/** Rows the counting function saw, on every connection it was given to. */
const visits = { count: 0 };
const counting = new WeakSet<NodeSqlite.DatabaseSync>();

/**
 * What `read` returns, and how many rows of the record's tables SQLite reached for it: each table
 * is read through a view whose every row passes a counting function first, so the count is every
 * row the read's plans visit, whatever index or filter they use.
 */
const rowsVisited = <A, E>(w: EngineWorld, read: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const prepare = NodeSqlite.DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(NodeSqlite.DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: NodeSqlite.DatabaseSync,
      ...args
    ) {
      if (!counting.has(this)) {
        counting.add(this);
        this.function("visited", { deterministic: false }, () => {
          visits.count += 1;
          return 1;
        });
      }
      return prepare.apply(this, args);
    });
    const exec = (statement: string) =>
      w.within(Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement)));
    for (const table of RECORD_TABLES) {
      yield* exec(`ALTER TABLE ${table} RENAME TO ${table}_rows`);
      yield* exec(`CREATE VIEW ${table} AS SELECT * FROM ${table}_rows WHERE visited()`);
    }
    visits.count = 0;
    const value = yield* read;
    const visited = visits.count;
    for (const table of RECORD_TABLES) {
      yield* exec(`DROP VIEW ${table}`);
      yield* exec(`ALTER TABLE ${table}_rows RENAME TO ${table}`);
    }
    spy.mockRestore();
    return { value, visited };
  });

/** Finished turns of a conversation: each the person's ask, the agent's calls and its answer. */
const GROWN_TURNS = 30;
const CALLS_PER_TURN = 32;

describe("a conversation's view as its agent streams", () => {
  // Every batch of streamed output commits, and every commit reads the view again (the menu's rows,
  // the attention, HQ's overview): Vera's view walked all 1,065 items of the conversation per read,
  // 176 GB from disk in 2 h 40 m (2026-10-19).
  it.effect(
    "reads no more of its record per streamed word as its conversation grows",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const engine = yield* w.engine;
          let turn = 0;
          const grow = Effect.gen(function* () {
            for (let i = 0; i < GROWN_TURNS; i++) {
              turn += 1;
              yield* w.tell({ _tag: "Send", text: `Build part ${turn}` });
              yield* w.agent((agent, thread) =>
                Effect.gen(function* () {
                  for (let call = 0; call < CALLS_PER_TURN; call++) {
                    yield* agent.write(thread, `part-${turn}/${call}.ts`, "export {};");
                  }
                  yield* agent.say(thread, `Part ${turn} is built.`);
                  yield* agent.finish(thread);
                }),
              );
            }
          });
          // A turn on now, a command running and the agent's words streaming: what one word costs.
          const streamedWord = Effect.gen(function* () {
            turn += 1;
            yield* w.tell({ _tag: "Send", text: `Check part ${turn}` });
            yield* w.agent((agent, thread) => agent.call(thread));
            yield* w.agent((agent, thread) => agent.stream(thread, `words-${turn}`, "Checking "));
            const items = yield* w.within(
              Effect.flatMap(
                SqlClient.SqlClient,
                (sql) => sql<{ readonly n: number }>`
                  SELECT COUNT(*) AS n FROM engine_item WHERE conversation_id = ${mate}
                `,
              ),
            );
            const read = yield* rowsVisited(w, engine.conversation(mate));
            assert.strictEqual(read.value?.liveCall?.words, "Command run");
            assert.strictEqual(read.value?.lastAsked?.text, `Check part ${turn}`);
            assert.strictEqual(read.value?.lastAgent?.text, `Part ${turn - 1} is built.`);
            yield* w.agent((agent, thread) => agent.finish(thread));
            return { items: items[0]?.n ?? 0, visited: read.visited };
          });

          yield* grow;
          const shorter = yield* streamedWord;
          yield* grow;
          const longer = yield* streamedWord;
          assert.isAtLeast(shorter.items, 1_000);
          assert.isAtLeast(longer.items, 2 * shorter.items - 10);
          assert.strictEqual(
            longer.visited,
            shorter.visited,
            `rows visited per streamed word: ${shorter.visited} at ${shorter.items} items, ${longer.visited} at ${longer.items}`,
          );
          yield* w.shutdown;
        }),
      ),
    120_000,
  );
});
