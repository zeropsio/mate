import { subscribeUpdateChanges } from "../../update/subscribeChanges.ts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import {
  ProviderDriverKind,
  EventId,
  PROVIDER_RUNTIME_SPI_VERSION,
  ThreadId,
  type SpiEvent,
} from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderRuntimeEventBus } from "../../spi/ProviderRuntimeEventBus.ts";
import { Conversations } from "../Conversations.ts";
import { LiveBus } from "../LiveBus.ts";
import { makeTurnPump } from "./TurnPump.ts";

const dependencies = Layer.mergeAll(
  Layer.mock(ProviderService)({ eventBarrier: undefined }),
  Layer.mock(Conversations)({
    kindOf: () => undefined,
    owner: () => {
      throw new Error("the pump reads no owner");
    },
  }),
  Layer.mock(LiveBus)({}),
);
const event: SpiEvent = {
  eventId: EventId.make("buffered"),
  threadId: ThreadId.make("foreign"),
  type: "thread.state.changed",
  provider: ProviderDriverKind.make("codex"),
  createdAt: "2026-10-08T00:00:00.000Z",
  payload: { state: "idle" },
};

describe("update provider receipt boundary", () => {
  it.effect("a published event blocks switching until its engine receipt reaches the pump", () =>
    Effect.gen(function* () {
      const hub = yield* PubSub.unbounded<{
        readonly sequence: number;
        readonly event: SpiEvent;
      }>();
      let published = 0;
      const pump = yield* makeTurnPump.pipe(
        Effect.provide(dependencies),
        Effect.provideService(ProviderRuntimeEventBus, {
          version: PROVIDER_RUNTIME_SPI_VERSION,
          events: Stream.empty,
          enrichmentFailures: Stream.empty,
          eventBarrier: {
            events: Stream.fromPubSub(hub),
            position: Effect.sync(() => ({ published, processing: 0 })),
            changes: Stream.empty,
            subscribeChanges: subscribeUpdateChanges(hub),
          },
        }),
      );
      assert.ok(pump.updateBlockers && pump.updateChanges);
      published++;
      yield* PubSub.publish(hub, { sequence: published, event });
      expect(yield* pump.updateBlockers).toContain("pending provider publication");
      const receipt = yield* pump.updateChanges.pipe(
        Stream.take(1),
        Stream.runDrain,
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* pump.start;
      yield* Fiber.join(receipt);
      expect(yield* pump.updateBlockers).toEqual([]);
    }),
  );

  it.effect.each([undefined, 1])(
    "missing or unsettled provider evidence (%s) blocks switching",
    (processing) =>
      Effect.gen(function* () {
        const pump = yield* makeTurnPump.pipe(
          Effect.provide(dependencies),
          Effect.provideService(ProviderRuntimeEventBus, {
            version: PROVIDER_RUNTIME_SPI_VERSION,
            events: Stream.empty,
            enrichmentFailures: Stream.empty,
            ...(processing === undefined
              ? {}
              : {
                  eventBarrier: {
                    events: Stream.empty,
                    position: Effect.succeed({ published: 0, processing }),
                    changes: Stream.empty,
                  },
                }),
          }),
        );
        assert.ok(pump.updateBlockers);
        expect((yield* pump.updateBlockers).length).toBeGreaterThan(0);
      }),
  );
});
