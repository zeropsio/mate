/** Live Mate turns are captured independently of HQ connectivity and browser demand. */
import { AGENT_USAGE_CAPTURE_PROTOCOL, UsageProviderKind } from "@t3tools/contracts";
import { type MateLinkDown, type MateLinkUp } from "@t3tools/shared/mateLink";
import { type UsageLinkUp, type UsageLinkDown } from "@t3tools/shared/agentUsage";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsOrgRead } from "../zerops/ZeropsOrgRead.ts";
import { makeUsageOutbox } from "./UsageOutbox.ts";

export interface UsageLane {
  readonly ping: Effect.Effect<void>;
  readonly state: (message: Extract<MateLinkDown, { type: "state" }>) => Effect.Effect<void>;
  readonly receive: (message: MateLinkDown) => Effect.Effect<void>;
  readonly run: Effect.Effect<never>;
}
export interface UsageLink {
  readonly open: (
    send: (frame: MateLinkUp) => Effect.Effect<void>,
  ) => Effect.Effect<UsageLane, never, Scope.Scope>;
}
const orgBody = Schema.Struct({ clientId: Schema.NonEmptyString });
const decodeOrg = Schema.decodeUnknownEffect(orgBody);
const decodeProvider = Schema.decodeUnknownEffect(UsageProviderKind);

export const makeUsageLink = Effect.gen(function* () {
  const outbox = yield* makeUsageOutbox;
  const bus = yield* ProviderRuntimeEventBus;
  const config = yield* ServerConfig;
  const orgRead = yield* ZeropsOrgRead;
  let wake: (() => void) | undefined;
  // Acquire the SPI subscription before this layer returns and command admission can open.
  yield* Effect.forkScoped(
    bus.events.pipe(
      Stream.runForEach((event) =>
        event.type === "turn.usage.completed"
          ? Effect.gen(function* () {
              const provider = yield* decodeProvider(
                event.provider === "claudeAgent" ? "claude" : event.provider,
              );
              yield* outbox.record({ provider, at: event.createdAt, ...event.payload });
              wake?.();
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logError("Usage fact rejected; later turns remain independent", cause),
              ),
            )
          : Effect.void,
      ),
    ),
    { startImmediately: true },
  );
  let active: object | undefined;
  return {
    open: (send) =>
      Effect.gen(function* () {
        const lane = {};
        type Work =
          | { readonly type: "state"; readonly message: Extract<MateLinkDown, { type: "state" }> }
          | { readonly type: "receipt"; readonly message: MateLinkDown }
          | { readonly type: "ping" }
          | { readonly type: "changed" };
        const changed = yield* Queue.unbounded<Work>();
        let negotiated = false;
        let flight: UsageLinkUp | undefined;
        let lastState: Extract<MateLinkDown, { type: "state" }> | undefined;
        const safe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Usage delivery failed; outbox retained", cause),
            ),
            Effect.asVoid,
          );
        const next = (resend = false) =>
          Effect.gen(function* () {
            if (!negotiated || active !== lane) return;
            if (flight) {
              if (resend) yield* send(flight);
              return;
            }
            flight = yield* outbox.batch;
            if (flight) yield* send(flight);
          });
        const negotiate = Effect.fnUntraced(function* (
          message: Extract<MateLinkDown, { type: "state" }>,
        ) {
          lastState = message;
          if (
            negotiated ||
            !config.zerops ||
            message.usage?.capture !== AGENT_USAGE_CAPTURE_PROTOCOL
          )
            return;
          if (message.mate.projectId !== config.zerops.projectId) return;
          const read = yield* orgRead.project(config.zerops);
          if (read.kind !== "answered" || read.status !== 200) return;
          const body = yield* decodeOrg(read.body);
          yield* outbox.bind({
            orgId: body.clientId,
            projectId: config.zerops.projectId,
            mateId: message.usage.mateId,
          });
          active = lane;
          negotiated = true;
          wake = () => Queue.offerUnsafe(changed, { type: "changed" });
          yield* next();
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (active === lane) {
              active = undefined;
              wake = undefined;
            }
          }),
        );
        const receive = Effect.fnUntraced(function* (message: MateLinkDown) {
          if (!negotiated || active !== lane || !flight || !message.type.startsWith("usage-"))
            return;
          const receipt = message as UsageLinkDown;
          if (receipt.batchId !== flight.batchId) return;
          if (receipt.type === "usage-error") {
            yield* Effect.logWarning("HQ did not acknowledge usage; outbox retained", receipt);
            return;
          }
          yield* outbox.acknowledge(flight, receipt.accepted);
          flight = undefined;
          yield* next();
        });
        // Storage recovery must not hold the connection's reader or delay its pongs.
        return {
          state: (message) => Queue.offer(changed, { type: "state", message }).pipe(Effect.asVoid),
          ping: Queue.offer(changed, { type: "ping" }).pipe(Effect.asVoid),
          receive: (message) =>
            Queue.offer(changed, { type: "receipt", message }).pipe(Effect.asVoid),
          run: Effect.forever(
            Queue.take(changed).pipe(
              Effect.flatMap((work) =>
                safe(
                  work.type === "state"
                    ? negotiate(work.message)
                    : work.type === "receipt"
                      ? receive(work.message)
                      : work.type === "ping"
                        ? Effect.suspend(() =>
                            !negotiated && lastState ? negotiate(lastState) : next(true),
                          )
                        : next(),
                ),
              ),
            ),
          ),
        } satisfies UsageLane;
      }),
  } satisfies UsageLink;
});
