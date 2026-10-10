import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { ConversationId } from "@t3tools/contracts";

import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ConversationsModule from "./Conversations.ts";
import { Conversations } from "./Conversations.ts";
import * as EngineSignalsModule from "./EngineSignals.ts";
import { TurnPump } from "./pump/TurnPump.ts";
import * as EngineStoreModule from "./store/EngineStore.ts";
import { envelope, sqliteWithEngineTables } from "./testing/fixtures.ts";
import { makeEngineWorld, type EngineWorld } from "./testing/pump/engineWorld.ts";
import ProviderSessionRuntimeTable from "../persistence/Migrations/004_ProviderSessionRuntime.ts";
import ProviderSessionRuntimeInstanceId from "../persistence/Migrations/027_ProviderSessionRuntimeInstanceId.ts";

import { makeEngineUpdateDrain, nativeResumeBlocker } from "./updateDrain.ts";
import { drainMateUpdate, MATE_UPDATE_DRAIN_DEADLINE } from "../zerops/mateUpdateDrain.ts";

const MATE_UPDATE_DRAIN_MS = Duration.toMillis(MATE_UPDATE_DRAIN_DEADLINE);

describe("native session safety during updates", () => {
  it.effect.each([
    {
      name: "Claude's own session id",
      driver: "claudeAgent",
      provider: "claudeAgent",
      json: '{"resume":"11111111-1111-4111-8111-111111111111"}',
      safe: true,
    },
    {
      name: "Codex's own thread id",
      driver: "codex",
      provider: "codex",
      json: '{"threadId":"native"}',
      safe: true,
    },
    {
      name: "a Claude cursor without a session id",
      driver: "claudeAgent",
      provider: "claudeAgent",
      json: "{}",
      safe: false,
    },
    {
      name: "a Codex cursor without a thread id",
      driver: "codex",
      provider: "codex",
      json: "{}",
      safe: false,
    },
    {
      name: "another native session",
      driver: "claudeAgent",
      provider: "claudeAgent",
      json: '{"resume":"other"}',
      safe: false,
    },
    {
      name: "an empty native thread id",
      driver: "codex",
      provider: "codex",
      json: '{"threadId":""}',
      safe: false,
    },
    { name: "an invalid cursor", driver: "codex", provider: "codex", json: "broken", safe: false },
    {
      name: "a different provider",
      driver: "codex",
      provider: "claudeAgent",
      json: '{"threadId":"native"}',
      safe: false,
    },
    {
      name: "a provider without native resume proof",
      driver: "cursor",
      provider: "cursor",
      json: '{"threadId":"native"}',
      safe: false,
    },
  ])("$name decides whether switching is safe", ({ driver, provider, json, safe }) =>
    Effect.gen(function* () {
      const reason = yield* nativeResumeBlocker({
        driver,
        nativeRef: "native",
        instanceId: "instance",
        binding: {
          provider_name: provider,
          provider_instance_id: "instance",
          resume_cursor_json: json,
        },
      });
      expect(reason === undefined).toBe(safe);
    }),
  );

  it.effect.each([undefined, null, "another-instance"])(
    "a missing or different instance %s blocks switching",
    (instanceId) =>
      Effect.gen(function* () {
        const reason = yield* nativeResumeBlocker({
          driver: "codex",
          nativeRef: "native",
          instanceId,
          binding: {
            provider_name: "codex",
            provider_instance_id: "instance",
            resume_cursor_json: '{"threadId":"native"}',
          },
        });
        expect(reason).toBeDefined();
      }),
  );
});

const idlePump = Layer.succeed(
  TurnPump,
  TurnPump.of({
    hostFor: () => Effect.die("This test has no native session"),
    existing: () => Effect.succeed(undefined),
    start: Effect.void,
    foreign: Effect.succeed(new Map()),
    updatePosition: Effect.succeed(0),
    updateHosts: Effect.succeed([]),
    updateBlockers: Effect.succeed([]),
    updateChanges: Stream.empty,
  }),
);
const drainEngine = ConversationsModule.layer().pipe(
  Layer.provideMerge(Layer.mergeAll(EngineStoreModule.layer, EngineSignalsModule.layer)),
  Layer.provideMerge(sqliteWithEngineTables),
  Layer.provideMerge(
    Layer.mergeAll(idlePump, Layer.mock(ProviderService)({ eventBarrier: undefined })),
  ),
);

describe("engine update drain", () => {
  it.layer(drainEngine)("worker receipts", (it) => {
    it.effect.each(
      Array.from(["pending", "running", "settling"], (state) => ({
        title: `${state} work postpones switching even when no run is active`,
        state,
      })),
    )("$title", ({ state }) =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const id = ConversationId.make(`receipt-${state}`);
        yield* conversations.ask(envelope({ _tag: "Archive" }, { conversation: id }));
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO engine_effect (effect_id, conversation_id, lane, kind, class, payload_json, state, available_at, cause_id, created_seq)
          VALUES (${`receipt-${state}`}, ${id}, 'side', 'workspace.finish', 'replay-safe', '{}', ${state}, 0, 'test', 1)`;
        const drain = yield* makeEngineUpdateDrain;
        expect(drain).toBeDefined();
        const facts = yield* drain!.facts;
        expect(facts.idle).toBe(false);
        expect(facts.blockers).toContain("unsettled worker receipt");
        yield* sql`UPDATE engine_effect SET state = 'done' WHERE effect_id = ${`receipt-${state}`}`;
      }),
    );

    it.effect("quiescence requires a fence and keeps new work refused until cancellation", () =>
      Effect.gen(function* () {
        const drain = yield* makeEngineUpdateDrain;
        expect(drain).toBeDefined();
        expect((yield* drain!.quiesce).blockers).toContain("admission is open");
        yield* drain!.begin;
        expect((yield* drain!.quiesce).idle).toBe(true);
        const conversations = yield* Conversations;
        expect(
          (yield* Effect.flip(conversations.ask(envelope({ _tag: "Send", text: "draft" }))))._tag,
        ).toBe("CommandRejected");
        yield* drain!.cancel;
        expect(
          (yield* conversations.ask(envelope({ _tag: "Send", text: "draft" }))).runId,
        ).toBeDefined();
      }),
    );
  });
});

/** The provider's own bindings, as the server's migrations make them and ProviderService writes them. */
const bindLiveSessions = (w: EngineWorld, instanceId: string) =>
  w.within(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* ProviderSessionRuntimeTable;
      yield* ProviderSessionRuntimeInstanceId;
      for (const session of yield* w.provider.service.listSessions()) {
        yield* sql`
          INSERT INTO provider_session_runtime (thread_id, provider_name, provider_instance_id, adapter_key, status, last_seen_at, resume_cursor_json)
          VALUES (${session.threadId}, ${session.provider}, ${instanceId}, ${session.provider}, 'running', 'now', ${JSON.stringify(session.resumeCursor)})
          ON CONFLICT (thread_id) DO UPDATE SET resume_cursor_json = excluded.resume_cursor_json
        `;
      }
    }),
  );

/** The update's drain, as the local drain endpoint runs it over the engine's own facts. */
const drains = (w: EngineWorld) =>
  Effect.gen(function* () {
    const engine = yield* w.engine;
    const drain = engine.updateDrain;
    if (drain?.subscribeChanges === undefined) throw new Error("The engine has no update drain");
    const changed = yield* Queue.unbounded<void>();
    const drained = yield* w
      .within(
        Effect.scoped(
          Effect.gen(function* () {
            const { changes } = yield* drain.subscribeChanges!;
            yield* changes.pipe(
              Stream.runForEach(() => Queue.offer(changed, undefined)),
              Effect.forkScoped,
            );
            return yield* drainMateUpdate({
              allowed: Effect.succeed(true),
              begin: drain.begin,
              cancel: drain.cancel,
              facts: drain.facts,
              quiesce: drain.quiesce,
              changed: Queue.take(changed),
            });
          }),
        ),
      )
      .pipe(Effect.forkChild);
    yield* w.settle;
    yield* w.advance(MATE_UPDATE_DRAIN_MS);
    const result = yield* Fiber.join(drained);
    yield* w.within(drain.cancel);
    return result;
  });

describe("an idle engine Mate", () => {
  it.effect.each(["claudeAgent", "codex"] as const)(
    "an idle %s conversation proves idle and its update goes ahead, after a restart too",
    (driver) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* makeEngineWorld({ driver });
          yield* w.boot;
          yield* w.tell({
            _tag: "AssignAgent",
            agent: { instanceId: driver, driver, model: "m1", profile: { kind: "mate" } },
          });
          yield* w.tell({ _tag: "Send", text: "hello" });
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* bindLiveSessions(w, driver);
          expect(yield* drains(w)).toBe(true);

          yield* w.crash;
          yield* w.boot;
          expect(yield* drains(w)).toBe(true);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect.each(["claudeAgent", "codex"] as const)(
    "a %s conversation whose agent changed proves idle before its next session opens",
    (driver) =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* makeEngineWorld({ driver });
          yield* w.boot;
          yield* w.tell({
            _tag: "AssignAgent",
            agent: { instanceId: driver, driver, model: "m1", profile: { kind: "mate" } },
          });
          yield* w.tell({ _tag: "Send", text: "hello" });
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* bindLiveSessions(w, driver);
          yield* w.tell({
            _tag: "AssignAgent",
            agent: {
              instanceId: `${driver}:other`,
              driver,
              model: "m1",
              profile: { kind: "mate" },
            },
          });
          expect(yield* drains(w)).toBe(true);
          yield* w.crash;
          yield* w.boot;
          expect(yield* drains(w)).toBe(true);
          yield* w.shutdown;
        }),
      ),
  );
});

/** What the update's idle proof finds now, read as the drain reads it. */
const blockersNow = (w: EngineWorld) =>
  Effect.gen(function* () {
    const drain = (yield* w.engine).updateDrain;
    if (drain === undefined) throw new Error("The engine has no update drain");
    yield* bindLiveSessions(w, "claudeAgent");
    return (yield* w.within(drain.facts)).blockers;
  });

type Agent = Parameters<Parameters<EngineWorld["agent"]>[0]>[0];
const helper = (agent: Agent, thread: string, id: string, owner?: string) =>
  agent.emit("task.started", thread, {
    payload: {
      taskId: id,
      toolUseId: `call-${id}`,
      taskType: owner === undefined ? "local_agent" : "local_bash",
      description: owner === undefined ? `Helper ${id}` : `Shell ${id}`,
      ...(owner === undefined ? {} : { agentId: owner }),
    },
  });
const reportsBack = (agent: Agent, thread: string, id: string, owner?: string) =>
  agent.emit("task.completed", thread, {
    payload: {
      taskId: id,
      status: "completed",
      toolUseId: `call-${id}`,
      ...(owner === undefined ? {} : { agentId: owner }),
    },
  });

// Milo, 2026-10-10: the update restarted the Mate between its turns while a helper it had sent
// off in the background was still working, and the person saw "Milo is reconnecting" mid-run.
describe("an update over a Mate's background work", () => {
  it.effect.each([
    {
      title:
        "an update waits while a helper the agent sent off in the background is still working, even between the agent's turns",
      waitsOn: "live background work",
      script: (w: EngineWorld) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => helper(agent, thread, "h1"));
          yield* w.agent((agent, thread) => helper(agent, thread, "h2"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.agent((agent, thread) => reportsBack(agent, thread, "h1"));
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.agent((agent, thread) => agent.say(thread, "Helper one is back."));
          yield* w.agent((agent, thread) => agent.finish(thread));
        }),
      finish: (w: EngineWorld) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => reportsBack(agent, thread, "h2"));
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
        }),
    },
    {
      title: "an update waits while a background job a helper started is still running",
      waitsOn: "live background work",
      script: (w: EngineWorld) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => helper(agent, thread, "h1"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.agent((agent, thread) => helper(agent, thread, "s1", "h1"));
          yield* w.agent((agent, thread) => reportsBack(agent, thread, "h1"));
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
        }),
      finish: (w: EngineWorld) =>
        w.agent((agent, thread) => reportsBack(agent, thread, "s1", "h1")),
    },
    {
      title: "an update waits while a wake for finished background work is still due",
      waitsOn: "finished background work its agent has not taken up",
      script: (w: EngineWorld) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => helper(agent, thread, "h1"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.agent((agent, thread) => reportsBack(agent, thread, "h1"));
        }),
      finish: (w: EngineWorld) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
        }),
    },
    {
      // Milo, 2026-10-10: helper three finished, Claude's next turn reported helper two, and the
      // update restarted the Mate before helper three's report reached it.
      title:
        "an update waits while a finished helper's report has not reached the agent yet, even after a turn that reported another",
      waitsOn: "finished background work its agent has not taken up",
      script: (w: EngineWorld) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => helper(agent, thread, "h2"));
          yield* w.agent((agent, thread) => helper(agent, thread, "h3"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.agent((agent, thread) => reportsBack(agent, thread, "h2"));
          yield* w.agent((agent, thread) => reportsBack(agent, thread, "h3"));
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.agent((agent, thread) =>
            agent.say(thread, "Helper two is back. One more to go."),
          );
          yield* w.agent((agent, thread) => agent.finish(thread));
        }),
      finish: (w: EngineWorld) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
        }),
    },
  ])("$title", ({ waitsOn, script, finish }) =>
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
            profile: { kind: "mate" },
          },
        });
        yield* w.tell({ _tag: "Send", text: "send helpers off" });
        yield* script(w);
        // The drain reads the pump before and after the engine's state: each reason comes twice.
        expect(
          new Set((yield* blockersNow(w)).map((reason) => reason.slice(reason.indexOf(": ") + 2))),
        ).toEqual(new Set([waitsOn]));
        yield* finish(w);
        expect(yield* blockersNow(w)).toEqual([]);
        yield* w.shutdown;
      }),
    ),
  );
});

describe("an update over finished background work", () => {
  it.effect("an update goes ahead when the agent never takes up its finished background work", () =>
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
            profile: { kind: "mate" },
          },
        });
        yield* w.tell({ _tag: "Send", text: "send a helper off" });
        yield* w.agent((agent, thread) => helper(agent, thread, "h1"));
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.agent((agent, thread) => reportsBack(agent, thread, "h1"));
        yield* bindLiveSessions(w, "claudeAgent");
        expect(yield* drains(w)).toBe(true);
        yield* w.shutdown;
      }),
    ),
  );
});
