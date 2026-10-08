import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
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

import { makeEngineUpdateDrain, nativeResumeBlocker } from "./updateDrain.ts";

describe("native session safety during updates", () => {
  it.effect.each([
    {
      name: "Claude's own session id",
      driver: "claude",
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
      driver: "claude",
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
      driver: "claude",
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
    for (const state of ["pending", "running", "settling"]) {
      it.effect(`${state} work postpones switching even when no run is active`, () =>
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
    }

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
