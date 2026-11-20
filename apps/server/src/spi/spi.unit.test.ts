import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { SpiEvent } from "@t3tools/contracts";

import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProviderRuntimeEventBus, ProviderRuntimeEventBusLive } from "./ProviderRuntimeEventBus.ts";

// witness: apps/server/src/spi/ProviderRuntimeEventBus.ts | if (result.kind === "toolCall") { → if (result.kind === "notATool") {
it.effect(
  "SP1: A tool item the bus recognizes reaches its subscribers with the tool call's name and result text added, and every other event reaches them unaltered, in the order the provider published them",
  () =>
    Effect.gen(function* () {
      // A Claude `item.completed` for one MCP tool call.
      const toolItem = {
        eventId: "evt-1",
        provider: "claudeAgent",
        threadId: "thread-1",
        createdAt: "2026-08-29T00:00:00Z",
        type: "item.completed",
        itemId: "item-1",
        payload: {
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_workflow",
            input: { action: "status" },
            result: {
              type: "tool_result",
              content: [{ type: "text", text: "## Status\nPhase: idle\n" }],
            },
          },
        },
      } as unknown as SpiEvent;
      const providerLayer = Layer.mock(ProviderService)({
        eventBarrier: undefined,
        streamEvents: Stream.make({ id: "evt-1" } as unknown as SpiEvent, toolItem, {
          id: "evt-2",
        } as unknown as SpiEvent),
      });

      const received = yield* Effect.gen(function* () {
        const bus = yield* ProviderRuntimeEventBus;
        return yield* Stream.runCollect(bus.events);
      }).pipe(Effect.provide(ProviderRuntimeEventBusLive.pipe(Layer.provide(providerLayer))));

      const [first, tool, last, ...rest] = Array.from(received);
      expect(rest).toEqual([]);
      expect(first).toStrictEqual({ id: "evt-1" });
      expect(tool?.eventId).toBe("evt-1");
      expect(tool?.toolCall?.name).toBe("zerops_workflow");
      expect(tool?.toolCall?.result?.text).toBe("## Status\nPhase: idle\n");
      expect(last).toStrictEqual({ id: "evt-2" });
    }),
);

// witness: apps/server/src/spi/ProviderRuntimeEventBus.ts | yield* PubSub.publish(failuresHub, failure); → if (!alreadyWarned) yield* PubSub.publish(failuresHub, failure);
it.effect(
  "SP2: A tool item whose data the bus cannot read still reaches its subscribers, without a tool call, and every occurrence is reported on the enrichment-failure stream with its event id, provider and item type",
  () =>
    Effect.gen(function* () {
      // A `command_execution` item without the `toolName` the Claude reader expects.
      const unreadableItem = (eventId: string) =>
        ({
          eventId,
          provider: "claudeAgent",
          threadId: "thread-1",
          createdAt: "2026-08-29T00:00:00Z",
          type: "item.completed",
          itemId: eventId,
          payload: {
            itemType: "command_execution",
            status: "completed",
            data: { command: "ls" },
          },
        }) as unknown as SpiEvent;
      const providerLayer = Layer.mock(ProviderService)({
        eventBarrier: undefined,
        streamEvents: Stream.make(
          unreadableItem("evt-bad-1"),
          unreadableItem("evt-bad-2"),
          unreadableItem("evt-bad-3"),
        ),
      });

      const { events, failures } = yield* Effect.gen(function* () {
        const bus = yield* ProviderRuntimeEventBus;
        const failuresRef = yield* Ref.make<
          ReadonlyArray<{
            readonly eventId: string;
            readonly provider: string;
            readonly itemType: string;
          }>
        >([]);
        // The failures consumer starts before the events run: the bus replays nothing.
        const failuresConsumer = yield* Stream.runForEach(bus.enrichmentFailures, (failure) =>
          Ref.update(failuresRef, (current) => [...current, failure]),
        ).pipe(Effect.forkChild);
        yield* TestClock.adjust("50 millis").pipe(Effect.andThen(Effect.yieldNow));

        const events = yield* Stream.runCollect(bus.events);
        yield* TestClock.adjust("50 millis").pipe(Effect.andThen(Effect.yieldNow));

        yield* Fiber.interrupt(failuresConsumer);
        const failures = yield* Ref.get(failuresRef);
        return { events, failures };
      }).pipe(Effect.provide(ProviderRuntimeEventBusLive.pipe(Layer.provide(providerLayer))));

      expect(
        Array.from(events).map((event) => ({ eventId: event.eventId, toolCall: event.toolCall })),
      ).toEqual([
        { eventId: "evt-bad-1", toolCall: undefined },
        { eventId: "evt-bad-2", toolCall: undefined },
        { eventId: "evt-bad-3", toolCall: undefined },
      ]);
      expect(failures).toHaveLength(3);
      expect(
        failures.map(({ eventId, provider, itemType }) => ({ eventId, provider, itemType })),
      ).toEqual([
        { eventId: "evt-bad-1", provider: "claudeAgent", itemType: "command_execution" },
        { eventId: "evt-bad-2", provider: "claudeAgent", itemType: "command_execution" },
        { eventId: "evt-bad-3", provider: "claudeAgent", itemType: "command_execution" },
      ]);
    }),
);
