import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  PROVIDER_RUNTIME_SPI_VERSION,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type SpiEvent,
} from "@t3tools/contracts";
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
import { parseZcpStatus, type ZcpStatus } from "./zeropsSetupSteps.ts";

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

const standUpEvent = (type: "item.started" | "item.completed", createdAt: string): SpiEvent =>
  ({
    eventId: EventId.make(`event-${type}`),
    provider: ProviderDriverKind.make("claudeAgent"),
    threadId: ThreadId.make("thread-main"),
    turnId: TurnId.make("turn-1"),
    itemId: "call-1",
    createdAt,
    type,
    payload: { itemType: "mcp_tool_call" },
    toolCall: { name: "zerops_standup", rawName: "mcp__zerops__zerops_standup" },
  }) as unknown as SpiEvent;

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
