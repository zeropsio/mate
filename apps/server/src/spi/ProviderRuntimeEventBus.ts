/**
 * ProviderRuntimeEventBus - the owned SPI seam for provider runtime events.
 *
 * `apps/server/src/zerops/**` (and, in a future slice, the orchestration
 * reactors that read `ProviderService.streamEvents` today) should depend on
 * this tag instead of reaching into `~/provider/**` directly. `spi/**` is the
 * only owned place allowed to import driver internals — see
 * `docs/internals/zerops/` (SPI plan, D3).
 *
 * `events` stays a THIN wrapper over the delivery guarantee measured in
 * `ProviderRuntimeEventBus.test.ts` (D6): `ProviderService.streamEvents` is
 * already an unbounded, per-access fresh subscription that never drops an
 * accepted event for a live subscriber and never blocks the producer or
 * another subscriber. This bus adds exactly ONE stage on top — the SPI-4
 * `toolCall` enrichment below — and no bounded/dropping buffer of its own,
 * so the same lossless-while-subscribed guarantee still holds: an
 * enrichment map is a synchronous per-element transform, not a second
 * broadcast.
 *
 * @module ProviderRuntimeEventBus
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  PROVIDER_RUNTIME_SPI_VERSION,
  type SpiEnrichmentFailure,
  type SpiEvent,
} from "@t3tools/contracts";

import { ProviderService } from "../provider/Services/ProviderService.ts";
import { readToolCall } from "./toolCall.ts";

export interface ProviderRuntimeEventBusShape {
  /**
   * The SPI version this bus was built against (`providerRuntimeSpi.ts`) — a
   * hook for a future adapter-version gate, not yet read by anything.
   */
  readonly version: typeof PROVIDER_RUNTIME_SPI_VERSION;

  /**
   * The canonical provider runtime event stream, decoupled from
   * `~/provider/**` and carrying the owned `toolCall` enrichment
   * (`apps/server/src/spi/toolCall.ts`). Every access is a fresh
   * subscription, exactly as `ProviderService.streamEvents` is today: an
   * event published before a given subscriber starts running is invisible
   * to it, and a subscriber that falls behind is never dropped or blocked
   * against — see the measurement in `ProviderRuntimeEventBus.test.ts`.
   */
  readonly events: Stream.Stream<SpiEvent>;

  /**
   * One entry per tool-lifecycle item whose `data` shape enrichment could
   * not read — the loud side channel for what would otherwise be a silent
   * `event.toolCall === undefined` on a driver shape change. Every
   * occurrence is published here (for a caller that wants a count); the
   * corresponding `Effect.logWarning` fires only once per (provider,
   * itemType, reason) signature over this bus's lifetime. A fresh
   * subscription per access, same as `events` — nothing is buffered for a
   * subscriber that arrives late.
   */
  readonly enrichmentFailures: Stream.Stream<SpiEnrichmentFailure>;
}

export class ProviderRuntimeEventBus extends Context.Service<
  ProviderRuntimeEventBus,
  ProviderRuntimeEventBusShape
>()("t3/spi/ProviderRuntimeEventBus") {}

/**
 * Builds the enriched `events`/`enrichmentFailures` pair over a raw provider
 * event stream. Shared by `ProviderRuntimeEventBusLive` and
 * `ProviderRuntimeEventBusTest.make` so a test double sees exactly the same
 * enrichment a real bus applies.
 */
const enrich = (
  rawEvents: Stream.Stream<SpiEvent>,
): Effect.Effect<Pick<ProviderRuntimeEventBusShape, "events" | "enrichmentFailures">> =>
  Effect.gen(function* () {
    const failuresHub = yield* PubSub.unbounded<SpiEnrichmentFailure>();
    const warnedSignatures = yield* Ref.make(new Set<string>());

    const events = rawEvents.pipe(
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          const result = readToolCall(event);
          if (result.kind === "toolCall") {
            return { ...event, toolCall: result.call } satisfies SpiEvent;
          }
          if (result.kind === "notATool") {
            return event;
          }

          const failure: SpiEnrichmentFailure = {
            eventId: event.eventId,
            provider: event.provider,
            itemType: result.itemType,
            reason: result.reason,
          };
          const signature = `${failure.provider}:${failure.itemType}:${failure.reason}`;
          const alreadyWarned = (yield* Ref.get(warnedSignatures)).has(signature);
          if (!alreadyWarned) {
            yield* Ref.update(warnedSignatures, (signatures) => new Set(signatures).add(signature));
            yield* Effect.logWarning(
              "SPI enrichment could not read a recognized tool item's data shape",
              failure,
            );
          }
          yield* PubSub.publish(failuresHub, failure);
          return event;
        }),
      ),
    );

    return { events, enrichmentFailures: Stream.fromPubSub(failuresHub) };
  });

export const ProviderRuntimeEventBusLive = Layer.effect(
  ProviderRuntimeEventBus,
  Effect.gen(function* () {
    const provider = yield* ProviderService;
    const enriched = yield* enrich(provider.streamEvents);
    return {
      version: PROVIDER_RUNTIME_SPI_VERSION,
      ...enriched,
    } satisfies ProviderRuntimeEventBusShape;
  }),
);

/**
 * A test double that serves a caller-supplied stream instead of subscribing
 * to a real `ProviderService`, run through the same enrichment
 * `ProviderRuntimeEventBusLive` applies. For a test that builds
 * `ZeropsLifecycle.layer` directly (rather than calling its `make` escape
 * hatch) and needs `ProviderRuntimeEventBus` satisfied without standing up
 * the provider layer.
 */
export const ProviderRuntimeEventBusTest = {
  make: (events: Stream.Stream<SpiEvent>): Layer.Layer<ProviderRuntimeEventBus> =>
    Layer.effect(
      ProviderRuntimeEventBus,
      Effect.gen(function* () {
        const enriched = yield* enrich(events);
        return {
          version: PROVIDER_RUNTIME_SPI_VERSION,
          ...enriched,
        } satisfies ProviderRuntimeEventBusShape;
      }),
    ),
};
