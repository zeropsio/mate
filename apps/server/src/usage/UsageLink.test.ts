import { assert, describe, it } from "@effect/vitest";
import { ProviderRuntimeEvent, type SpiEvent } from "@t3tools/contracts";
import { MateLinkDown, type MateLinkUp } from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import { ProviderRuntimeEventBusTest } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsOrgRead } from "../zerops/ZeropsOrgRead.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import { makeUsageLink } from "./UsageLink.ts";
import { makeUsageOutbox } from "./UsageOutbox.ts";

const decodeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);
const event = decodeEvent({
  eventId: "completion",
  provider: "codex",
  threadId: "mate-thread",
  createdAt: "2026-10-08T10:00:00.000Z",
  type: "turn.usage.completed",
  payload: {
    nativeThreadId: "native-thread",
    nativeTurnId: "turn",
    models: [
      {
        model: "gpt-5.6-sol",
        components: {
          uncachedInput: "20",
          cachedInput: "0",
          cacheCreation: "0",
          output: "10",
          reasoning: null,
          inclusiveTotal: "30",
        },
        nativeCost: null,
      },
    ],
    nativeCost: null,
    parentId: null,
  },
});
const state = Schema.decodeUnknownSync(MateLinkDown)({
  type: "state",
  mate: {
    projectId: "project",
    name: "Mate",
    face: "face",
    standupRequestedBy: null,
    closedOff: false,
    appId: null,
    appName: null,
    changes: [],
  },
  usage: { capture: 2, report: 1, mateId: "mate" },
});
const config = ServerConfig.of({
  zerops: resolveZeropsEnvironment({
    projectId: "project",
    apiHost: undefined,
    apiToken: undefined,
  }),
} as ServerConfig["Service"]);
const org = ZeropsOrgRead.of({
  project: () => Effect.succeed({ kind: "answered", status: 200, body: { clientId: "org" } }),
  members: () => Effect.succeed({ kind: "no-key" }),
});

describe("Mate usage on the existing HQ link", () => {
  for (const failures of [1, 3])
    it.effect(
      `after ${failures} SQLite rejection(s), the 100-token completion is captured before the later 130-token turn`,
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const rejected = yield* Queue.unbounded<void>();
          const withTransaction: typeof sql.withTransaction = (effect) =>
            sql
              .withTransaction(effect)
              .pipe(Effect.tapError(() => Queue.offer(rejected, undefined)));
          const faultObserved = new Proxy(sql, {
            get: (target, property, receiver) =>
              property === "withTransaction"
                ? withTransaction
                : Reflect.get(target, property, receiver),
          });
          const hub = yield* PubSub.unbounded<SpiEvent>();
          const bus = yield* Layer.build(ProviderRuntimeEventBusTest.make(Stream.fromPubSub(hub)));
          const link = yield* makeUsageLink.pipe(
            Effect.provide(bus),
            Effect.provideService(SqlClient.SqlClient, faultObserved),
          );
          yield* sql`CREATE TRIGGER reject_capture BEFORE INSERT ON usage_outbox BEGIN SELECT RAISE(ABORT, 'injected_capture_failure'); END`;
          if (event.type !== "turn.usage.completed") throw new Error("Expected usage fixture");
          const usage = event.payload;
          const completion = (id: string, tokens: string) =>
            decodeEvent({
              ...event,
              eventId: id,
              payload: {
                ...usage,
                nativeTurnId: id,
                models: [
                  {
                    ...usage.models[0],
                    components: {
                      ...usage.models[0]!.components,
                      uncachedInput: tokens,
                      output: "0",
                      inclusiveTotal: tokens,
                    },
                  },
                ],
              },
            });
          yield* PubSub.publish(hub, completion("rejected-100", "100"));
          yield* Queue.take(rejected);
          yield* PubSub.publish(hub, completion("later-130", "130"));
          for (let attempt = 1; attempt < failures; attempt++) {
            yield* TestClock.adjust(`${2 ** (attempt - 1)} seconds`);
            yield* Queue.take(rejected);
          }
          assert.deepEqual(yield* sql`SELECT identity FROM usage_outbox`, []);
          yield* sql`DROP TRIGGER reject_capture`;
          yield* TestClock.adjust(`${2 ** (failures - 1)} seconds`);
          const sent = yield* Queue.unbounded<MateLinkUp>();
          const lane = yield* link.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
          yield* Effect.forkScoped(lane.run);
          if (state.type !== "state") throw new Error("Expected state fixture");
          yield* lane.state(state);
          const first = yield* Queue.take(sent);
          if (first.type !== "usage-facts") throw new Error("Expected immutable usage facts");
          assert.equal(first.facts[0]!.nativeId, "rejected-100");
          const facts = [...first.facts];
          yield* lane.receive({
            type: "usage-ack",
            batchId: first.batchId,
            accepted: first.facts.map(({ originId, factId }) => ({ originId, factId })),
          });
          if (facts.length < 2) {
            const next = yield* Queue.take(sent);
            if (next.type !== "usage-facts") throw new Error("Expected later turn");
            facts.push(...next.facts);
          }
          assert.deepEqual(
            facts.map((fact) => fact.nativeId),
            ["rejected-100", "later-130"],
          );
          assert.equal(
            facts.reduce(
              (sum, fact) => sum + BigInt(fact.models[0]!.components.inclusiveTotal!),
              0n,
            ),
            230n,
          );
        }).pipe(
          Effect.provide(Sqlite.layer({ filename: ":memory:" })),
          Effect.provideService(ServerConfig, config),
          Effect.provideService(ZeropsOrgRead, org),
        ),
    );
  it.effect("a rejected conflicting fact does not stop the later 130-token turn", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hub = yield* PubSub.unbounded<SpiEvent>();
      const bus = yield* Layer.build(ProviderRuntimeEventBusTest.make(Stream.fromPubSub(hub)));
      const link = yield* makeUsageLink.pipe(Effect.provide(bus));
      if (event.type !== "turn.usage.completed" || state.type !== "state")
        throw new Error("Expected fixtures");
      const completion = (id: string, tokens: string) =>
        decodeEvent({
          ...event,
          eventId: `${id}-${tokens}`,
          payload: {
            ...event.payload,
            nativeTurnId: id,
            models: [
              {
                ...event.payload.models[0],
                components: {
                  ...event.payload.models[0]!.components,
                  uncachedInput: tokens,
                  output: "0",
                  inclusiveTotal: tokens,
                },
              },
            ],
          },
        });
      yield* PubSub.publish(hub, completion("first", "100"));
      yield* PubSub.publish(hub, completion("first", "150"));
      yield* PubSub.publish(hub, completion("later", "130"));
      yield* TestClock.adjust("0 seconds");
      assert.equal((yield* sql`SELECT identity FROM usage_outbox`).length, 2);
      const sent = yield* Queue.unbounded<MateLinkUp>();
      const lane = yield* link.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
      yield* Effect.forkScoped(lane.run);
      yield* lane.state(state);
      const frame = yield* Queue.take(sent);
      if (frame.type !== "usage-facts") throw new Error("Expected known usage");
      assert.deepEqual(
        frame.facts.map((fact) => fact.models[0]!.components.inclusiveTotal),
        ["100", "130"],
      );
    }).pipe(
      Effect.provide(Sqlite.layer({ filename: ":memory:" })),
      Effect.provideService(ServerConfig, config),
      Effect.provideService(ZeropsOrgRead, org),
    ),
  );
  it.effect("an ACK delete failure retains both turns and recovers on the same lane", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rejected = yield* Queue.unbounded<void>();
      const withTransaction: typeof sql.withTransaction = (effect) =>
        sql.withTransaction(effect).pipe(Effect.tapError(() => Queue.offer(rejected, undefined)));
      const observed = new Proxy(sql, {
        get: (target, property, receiver) =>
          property === "withTransaction"
            ? withTransaction
            : Reflect.get(target, property, receiver),
      });
      const bus = yield* Layer.build(ProviderRuntimeEventBusTest.make(Stream.empty));
      const link = yield* makeUsageLink.pipe(
        Effect.provide(bus),
        Effect.provideService(SqlClient.SqlClient, observed),
      );
      const box = yield* makeUsageOutbox;
      if (event.type !== "turn.usage.completed" || state.type !== "state")
        throw new Error("Expected fixtures");
      const completion = (id: string, tokens: string) => ({
        ...event.payload,
        provider: "codex" as const,
        at: event.createdAt,
        nativeTurnId: id,
        models: [
          {
            ...event.payload.models[0]!,
            components: {
              ...event.payload.models[0]!.components,
              uncachedInput: tokens,
              output: "0",
              inclusiveTotal: tokens,
            },
          },
        ],
      });
      yield* box.record(completion("first-100", "100"));
      const sent = yield* Queue.unbounded<MateLinkUp>();
      const lane = yield* link.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
      yield* Effect.forkScoped(lane.run);
      yield* lane.state(state);
      const first = yield* Queue.take(sent);
      if (first.type !== "usage-facts") throw new Error("Expected first turn");
      yield* box.record(completion("later-130", "130"));
      yield* sql`CREATE TRIGGER reject_ack BEFORE DELETE ON usage_outbox BEGIN SELECT RAISE(ABORT, 'injected_ack_failure'); END`;
      const ack = {
        type: "usage-ack" as const,
        batchId: first.batchId,
        accepted: first.facts.map(({ originId, factId }) => ({ originId, factId })),
      };
      yield* lane.receive(ack);
      yield* Queue.take(rejected);
      assert.equal((yield* sql`SELECT identity FROM usage_outbox`).length, 2);
      yield* sql`DROP TRIGGER reject_ack`;
      yield* lane.ping;
      yield* lane.receive(ack);
      yield* TestClock.adjust("1 second");
      assert.equal((yield* sql`SELECT identity FROM usage_outbox`).length, 1);
      const next = yield* Queue.take(sent);
      if (next.type !== "usage-facts") throw new Error("Expected later turn");
      assert.equal(next.facts[0]!.nativeId, "later-130");
      assert.equal(next.facts[0]!.models[0]!.components.inclusiveTotal, "130");
      yield* lane.receive({
        type: "usage-ack",
        batchId: next.batchId,
        accepted: next.facts.map(({ originId, factId }) => ({ originId, factId })),
      });
      yield* TestClock.adjust("0 seconds");
      assert.isUndefined(yield* box.batch);
    }).pipe(
      Effect.provide(Sqlite.layer({ filename: ":memory:" })),
      Effect.provideService(ServerConfig, config),
      Effect.provideService(ZeropsOrgRead, org),
    ),
  );
  it.effect(
    "completion capture is subscribed before the first turn and survives loss of its HQ acknowledgement",
    () =>
      Effect.gen(function* () {
        const hub = yield* PubSub.unbounded<SpiEvent>();
        const bus = yield* Layer.build(ProviderRuntimeEventBusTest.make(Stream.fromPubSub(hub)));
        const link = yield* makeUsageLink.pipe(Effect.provide(bus));
        // There is no connection or report consumer when the provider completes.
        yield* PubSub.publish(hub, event);
        const sent = yield* Queue.unbounded<MateLinkUp>();
        const lane = yield* link.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
        const running = yield* Effect.forkScoped(lane.run);
        if (state.type !== "state") throw new Error("Expected state fixture");
        yield* lane.state(state);
        const first = yield* Queue.take(sent);
        if (first.type !== "usage-facts") throw new Error("Expected immutable usage facts");
        assert.equal(first.facts.length, 1);
        assert.equal(first.facts[0]!.models[0]!.components.inclusiveTotal, "30");
        const reconnect = yield* link.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
        yield* Effect.forkScoped(reconnect.run);
        yield* reconnect.state(state);
        const repeated = yield* Queue.take(sent);
        assert.deepEqual(repeated, first);
        yield* lane.receive({
          type: "usage-ack",
          batchId: first.batchId,
          accepted: first.facts.map(({ originId, factId }) => ({ originId, factId })),
        });
        const box = yield* makeUsageOutbox;
        assert.isDefined(yield* box.batch);
        yield* reconnect.receive({
          type: "usage-ack",
          batchId: first.batchId,
          accepted: first.facts.map(({ originId, factId }) => ({ originId, factId })),
        });
        yield* TestClock.adjust("0 seconds");
        assert.isUndefined(yield* box.batch);
        yield* Fiber.interrupt(running);
      }).pipe(
        Effect.provide(Sqlite.layer({ filename: ":memory:" })),
        Effect.provideService(ServerConfig, config),
        Effect.provideService(ZeropsOrgRead, org),
      ),
  );
});
