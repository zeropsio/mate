import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  PROVIDER_RUNTIME_SPI_VERSION,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type SpiEvent,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsSetup } from "./ZeropsSetup.ts";
import { layer as relayLayer, standUpProgressOf } from "./ZeropsStandUpRelay.ts";
import { isStaleStandUp, parseZcpStatus, type ZcpStatus } from "./zeropsSetupSteps.ts";

const CALL_AT = "2026-10-01T10:00:00.000Z";

const section = (overrides: Record<string, unknown> = {}) =>
  parseZcpStatus({
    version: 1,
    standup: {
      state: "running",
      phase: "development",
      startedAt: "2026-10-01T10:00:01Z",
      services: [
        { hostname: "api", step: "build", state: "running", processId: "proc-1", at: CALL_AT },
        { hostname: "web", step: "build", state: "pending" },
      ],
      ...overrides,
    },
  });

describe("standUpProgressOf", () => {
  it("is the call's services, step by step, with the running process", () => {
    assert.deepStrictEqual(standUpProgressOf(section(), CALL_AT), {
      phase: "development",
      state: "running",
      services: [
        { hostname: "api", step: "build", state: "running", processId: "proc-1", at: CALL_AT },
        { hostname: "web", step: "build", state: "pending", processId: "", at: "" },
      ],
    });
  });

  const none: ReadonlyArray<[string, ZcpStatus | undefined]> = [
    ["no status file", undefined],
    ["an idle stand-up", section({ state: "idle" })],
    ["the previous call's section", section({ startedAt: "2026-10-01T09:40:00Z" })],
  ];
  for (const [name, status] of none) {
    it(`is nothing for ${name}`, () => assert.isUndefined(standUpProgressOf(status, CALL_AT)));
  }

  it("cuts a service's error to a card line", () => {
    const progress = standUpProgressOf(
      section({
        services: [{ hostname: "api", step: "deploy", state: "failed", error: "x".repeat(900) }],
      }),
      CALL_AT,
    );
    assert.strictEqual(progress?.services[0]?.error?.length, 300);
  });
});

const standUpEvent = (
  type: "item.started" | "item.updated" | "item.completed",
  createdAt: string,
  itemId = "call-1",
  provider = "claudeAgent",
): SpiEvent =>
  ({
    eventId: EventId.make(`event-${type}`),
    provider: ProviderDriverKind.make(provider),
    threadId: ThreadId.make("thread-main"),
    turnId: TurnId.make("turn-1"),
    itemId,
    createdAt,
    type,
    payload: { itemType: "mcp_tool_call" },
    toolCall: { name: "zerops_standup", rawName: "mcp__zerops__zerops_standup" },
  }) as unknown as SpiEvent;

describe("isStaleStandUp", () => {
  const at = (updatedAt: string, state = "running") =>
    isStaleStandUp(
      parseZcpStatus({ version: 1, updatedAt, standup: { state } }),
      Date.parse("2026-10-01T10:10:00Z"),
    );
  it("a running stand-up whose file zcp stopped refreshing over 2 minutes ago is stale", () => {
    assert.deepStrictEqual(
      [
        at("2026-10-01T10:07:59Z"),
        at("2026-10-01T10:08:00Z"),
        at("2026-10-01T10:07:59Z", "done"),
        at(""),
      ],
      [true, false, false, false],
    );
  });
});

describe("isStaleStandUp: the section's own heartbeat first", () => {
  const NOW = Date.parse("2026-10-01T10:10:00Z");
  const file = (top: string, own: string | undefined) =>
    parseZcpStatus({
      version: 1,
      updatedAt: top,
      standup: { state: "running", ...(own === undefined ? {} : { updatedAt: own }) },
    });
  it("reads the section's updatedAt, else the file's", () => {
    assert.deepStrictEqual(
      [
        isStaleStandUp(file("2026-10-01T10:00:00Z", "2026-10-01T10:09:50Z"), NOW),
        isStaleStandUp(file("2026-10-01T10:09:50Z", "2026-10-01T10:00:00Z"), NOW),
        isStaleStandUp(file("2026-10-01T10:00:00Z", undefined), NOW),
      ],
      [false, true, true],
    );
  });
});

describe("ZeropsStandUpRelay", () => {
  it.live("relays each change of the call's section into one progress row, then stops", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<SpiEvent>();
      const status = yield* Ref.make<ZcpStatus | undefined>(undefined);
      const appended = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const appends = Effect.map(Ref.get(appended), (all) =>
        all.flatMap((command) => (command.type === "thread.activity.append" ? [command] : [])),
      );
      const layer = relayLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ProviderRuntimeEventBus, {
              version: PROVIDER_RUNTIME_SPI_VERSION,
              events: Stream.fromQueue(events),
              enrichmentFailures: Stream.empty,
            }),
            Layer.mock(ZeropsSetup)({ status: Ref.get(status) }),
            Layer.mock(OrchestrationEngineService)({
              dispatch: (command) =>
                Ref.update(appended, (all) => [...all, command]).pipe(Effect.as({ sequence: 1 })),
              streamDomainEvents: Stream.never,
            }),
            NodeServices.layer,
          ),
        ),
      );
      yield* Effect.gen(function* () {
        yield* Queue.offer(events, standUpEvent("item.started", CALL_AT));
        yield* Effect.sleep(Duration.millis(100));
        assert.deepStrictEqual(yield* appends, [], "nothing to say before zcp writes");
        yield* Ref.set(status, section());
        yield* Effect.sleep(Duration.seconds(3));
        const unchangedTwice = (yield* appends).length;
        yield* Ref.set(
          status,
          section({
            state: "done",
            services: [{ hostname: "api", step: "verify", state: "done", processId: "proc-2" }],
          }),
        );
        yield* Queue.offer(events, standUpEvent("item.completed", "2026-10-01T10:05:00.000Z"));
        yield* Effect.sleep(Duration.millis(200));
        const all = yield* appends;
        assert.strictEqual(unchangedTwice, 1, "an unchanged section is written once");
        assert.strictEqual(all.length, 2);
        assert.deepStrictEqual(
          all.map((command) => [
            command.activity.id,
            command.activity.kind,
            command.activity.turnId,
          ]),
          [
            ["zerops-standup:thread-main:call-1", "tool.progress", "turn-1"],
            ["zerops-standup:thread-main:call-1", "tool.progress", "turn-1"],
          ],
        );
        assert.deepStrictEqual(all[1]!.activity.payload, {
          toolCallId: "call-1",
          zeropsStandUp: {
            phase: "development",
            state: "done",
            services: [
              { hostname: "api", step: "verify", state: "done", processId: "proc-2", at: "" },
            ],
          },
        });
        yield* Ref.set(status, section({ state: "failed" }));
        yield* Effect.sleep(Duration.seconds(2.5));
        assert.strictEqual((yield* appends).length, 2, "a settled call is followed no more");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

// An ACP agent (Cursor, Grok, Antigravity) sends no start: its call's first
// update is where the stand-up began.
describe("ZeropsStandUpRelay: a call first seen running", () => {
  it.live("follows it from its first update, once, and never after its end", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<SpiEvent>();
      const status = yield* Ref.make<ZcpStatus | undefined>(section());
      const appended = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const appends = Effect.map(Ref.get(appended), (all) =>
        all.flatMap((command) => (command.type === "thread.activity.append" ? [command] : [])),
      );
      const layer = relayLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ProviderRuntimeEventBus, {
              version: PROVIDER_RUNTIME_SPI_VERSION,
              events: Stream.fromQueue(events),
              enrichmentFailures: Stream.empty,
            }),
            Layer.mock(ZeropsSetup)({ status: Ref.get(status) }),
            Layer.mock(OrchestrationEngineService)({
              dispatch: (command) =>
                Ref.update(appended, (all) => [...all, command]).pipe(Effect.as({ sequence: 1 })),
              streamDomainEvents: Stream.never,
            }),
            NodeServices.layer,
          ),
        ),
      );
      yield* Effect.gen(function* () {
        yield* Queue.offer(events, standUpEvent("item.updated", CALL_AT, "call-1", "cursor"));
        yield* Queue.offer(
          events,
          standUpEvent("item.updated", "2026-10-01T10:01:00.000Z", "call-1", "cursor"),
        );
        yield* Effect.sleep(Duration.millis(200));
        assert.strictEqual((yield* appends).length, 1, "its first update follows it");
        yield* Ref.set(status, section({ state: "done" }));
        yield* Queue.offer(
          events,
          standUpEvent("item.completed", "2026-10-01T10:05:00.000Z", "call-1", "cursor"),
        );
        yield* Effect.sleep(Duration.millis(200));
        assert.strictEqual((yield* appends).length, 2, "its end writes once more");
        yield* Queue.offer(
          events,
          standUpEvent("item.updated", "2026-10-01T10:06:00.000Z", "call-1", "cursor"),
        );
        yield* Ref.set(status, section({ state: "failed" }));
        yield* Effect.sleep(Duration.seconds(2.5));
        assert.strictEqual((yield* appends).length, 2, "a late update follows it no more");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("ZeropsStandUpRelay: a stand-up whose MCP server died", () => {
  it.live("stops following it and leaves the card's last state", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<SpiEvent>();
      const status = yield* Ref.make<ZcpStatus | undefined>(undefined);
      const appended = yield* Ref.make(0);
      const layer = relayLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ProviderRuntimeEventBus, {
              version: PROVIDER_RUNTIME_SPI_VERSION,
              events: Stream.fromQueue(events),
              enrichmentFailures: Stream.empty,
            }),
            Layer.mock(ZeropsSetup)({ status: Ref.get(status) }),
            Layer.mock(OrchestrationEngineService)({
              dispatch: () =>
                Ref.update(appended, (count) => count + 1).pipe(Effect.as({ sequence: 1 })),
              streamDomainEvents: Stream.never,
            }),
            NodeServices.layer,
          ),
        ),
      );
      const refreshed = (agoMs: number, state: string) =>
        Effect.map(Clock.currentTimeMillis, (nowMs) =>
          parseZcpStatus({
            version: 1,
            updatedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs - agoMs)),
            standup: {
              state: "running",
              startedAt: "2026-10-01T10:00:01Z",
              services: [{ hostname: "api", step: "build", state }],
            },
          }),
        );
      yield* Effect.gen(function* () {
        yield* Ref.set(status, yield* refreshed(0, "running"));
        yield* Queue.offer(events, standUpEvent("item.started", CALL_AT));
        yield* Effect.sleep(Duration.millis(200));
        assert.strictEqual(yield* Ref.get(appended), 1);
        yield* Ref.set(status, yield* refreshed(3 * 60_000, "done"));
        yield* Effect.sleep(Duration.millis(2_500));
        yield* Ref.set(status, yield* refreshed(0, "failed"));
        yield* Effect.sleep(Duration.millis(2_500));
        assert.strictEqual(yield* Ref.get(appended), 1, "a stale section is never written");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("ZeropsStandUpRelay: only the newest call of a live thread", () => {
  const world = Effect.gen(function* () {
    const events = yield* Queue.unbounded<SpiEvent>();
    const domain = yield* Queue.unbounded<OrchestrationEvent>();
    const status = yield* Ref.make<ZcpStatus | undefined>(undefined);
    const appended = yield* Ref.make<ReadonlyArray<string>>([]);
    const layer = relayLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ProviderRuntimeEventBus, {
            version: PROVIDER_RUNTIME_SPI_VERSION,
            events: Stream.fromQueue(events),
            enrichmentFailures: Stream.empty,
          }),
          Layer.mock(ZeropsSetup)({ status: Ref.get(status) }),
          Layer.mock(OrchestrationEngineService)({
            dispatch: (command) =>
              Ref.update(appended, (all) => [
                ...all,
                command.type === "thread.activity.append" ? command.activity.id : command.type,
              ]).pipe(Effect.as({ sequence: 1 })),
            streamDomainEvents: Stream.fromQueue(domain),
          }),
          NodeServices.layer,
        ),
      ),
    );
    return { events, domain, status, appended, layer };
  });
  const running = (startedAt: string, state: string) =>
    section({ startedAt, services: [{ hostname: "api", step: "build", state }] });

  it.live("a newer stand-up call ends the following of the one before", () =>
    Effect.gen(function* () {
      const { events, status, appended, layer } = yield* world;
      yield* Effect.gen(function* () {
        yield* Ref.set(status, running("2026-10-01T10:00:01Z", "running"));
        yield* Queue.offer(events, standUpEvent("item.started", CALL_AT, "call-1"));
        yield* Effect.sleep(Duration.millis(200));
        // The first call died without an end; its retry starts.
        yield* Queue.offer(
          events,
          standUpEvent("item.started", "2026-10-01T10:20:00.000Z", "call-2"),
        );
        yield* Ref.set(status, running("2026-10-01T10:20:01Z", "running"));
        yield* Effect.sleep(Duration.millis(2_500));
        yield* Ref.set(status, running("2026-10-01T10:20:01Z", "done"));
        yield* Effect.sleep(Duration.millis(2_500));
        assert.deepStrictEqual(yield* Ref.get(appended), [
          "zerops-standup:thread-main:call-1",
          "zerops-standup:thread-main:call-2",
          "zerops-standup:thread-main:call-2",
        ]);
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.live("a deleted thread's stand-up is followed no more", () =>
    Effect.gen(function* () {
      const { events, domain, status, appended, layer } = yield* world;
      yield* Effect.gen(function* () {
        yield* Ref.set(status, running("2026-10-01T10:00:01Z", "running"));
        yield* Queue.offer(events, standUpEvent("item.started", CALL_AT));
        yield* Effect.sleep(Duration.millis(200));
        yield* Queue.offer(domain, {
          type: "thread.deleted",
          payload: { threadId: ThreadId.make("thread-main"), deletedAt: CALL_AT },
        } as unknown as OrchestrationEvent);
        yield* Effect.sleep(Duration.millis(200));
        yield* Ref.set(status, running("2026-10-01T10:00:01Z", "done"));
        yield* Effect.sleep(Duration.millis(2_500));
        assert.deepStrictEqual(yield* Ref.get(appended), ["zerops-standup:thread-main:call-1"]);
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});
