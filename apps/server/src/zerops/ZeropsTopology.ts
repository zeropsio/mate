/**
 * The topology feed: what exists in this Zerops project, kept current.
 *
 * A mate environment is one Zerops project (one server, one `workspaceRoot`), so
 * there is exactly one topology per server and no key to scope it by.
 *
 * Three things move it, because no single one is enough:
 *
 * 1. **The doorbell.** `zcp studio watch` rings on service add/delete — but only
 *    on those, never on a status transition, and it carries no data. Every ring
 *    means "re-read".
 * 2. **A short active poll.** A service settling (`CREATING` → `ACTIVE`) changes
 *    nothing the doorbell can see, so while anything is transient the feed
 *    re-reads on a timer. The poll is idle-quiet: a project where nothing moves
 *    costs no API calls at all.
 * 3. **A nudge after every `zerops_*` tool call.** A build is invisible to this
 *    feed — `zcp studio topology` carries no process state and a building
 *    service reads `READY_TO_DEPLOY` throughout — so the end of a deploy would
 *    otherwise go unnoticed. The nudge subscribes to the provider bus directly
 *    rather than going through the lifecycle feed, so the two feeds stay
 *    independent.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type { SpiEvent, ZeropsTopologySnapshot } from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsCli } from "./ZeropsCli.ts";
import { readZeropsToolCall } from "./zeropsToolResult.ts";

/**
 * How often the feed re-reads while something is moving. Short on purpose: a
 * service settles in seconds (CREATING → ACTIVE in ~16 s live), so a slower
 * cadence would render one frame of a transition the user is watching. Nothing
 * is polled while the project is idle.
 */
const ACTIVE_POLL_INTERVAL = Duration.seconds(3);

/**
 * How long a completed `zerops_*` tool keeps the feed polling. Long enough to
 * cover a subdomain and a status settling after the tool returns; a fresh tool
 * call extends it.
 */
const NUDGE_WINDOW = Duration.seconds(90);

/** Doorbell restart backoff, matching the sidecar supervisor's shape. */
const INITIAL_RESTART_DELAY = Duration.millis(500);
const MAX_RESTART_DELAY = Duration.seconds(10);

const restartDelay = (attempt: number): Duration.Duration =>
  Duration.min(Duration.times(INITIAL_RESTART_DELAY, 2 ** attempt), MAX_RESTART_DELAY);

export class ZeropsTopology extends Context.Service<
  ZeropsTopology,
  {
    readonly latest: Effect.Effect<ZeropsTopologySnapshot>;
    readonly changes: Stream.Stream<ZeropsTopologySnapshot>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: ZeropsTopologySnapshot;
        readonly changes: Stream.Stream<ZeropsTopologySnapshot>;
      },
      never,
      Scope.Scope
    >;
    /** Re-reads now. A no-op once the feed is off (no zcp on this machine). */
    readonly refresh: Effect.Effect<ZeropsTopologySnapshot>;
  }
>()("t3/zerops/ZeropsTopology") {}

interface FeedState {
  readonly snapshot: ZeropsTopologySnapshot;
  /** Set once `zcp` is known to be absent: this is not a Zerops environment. */
  readonly off: boolean;
  readonly nudgeUntilMs: number;
  readonly doorbellConnected: boolean;
}

/**
 * Everything a client would render, with the read timestamp left out — an
 * identical topology read a second later must not wake a subscriber, or an idle
 * project would repaint the map on every poll.
 */
const contentSignature = (snapshot: ZeropsTopologySnapshot): string =>
  JSON.stringify([
    snapshot.available,
    snapshot.degraded,
    snapshot.reason ?? null,
    snapshot.project ?? null,
    snapshot.services,
    snapshot.warnings,
    // Included so a doorbell that drops or recovers reaches subscribers. It
    // changes nothing about the services, so leaving it out would let the map
    // keep claiming to be live while the feed had quietly fallen back to polling.
    snapshot.doorbellConnected ?? null,
  ]);

export interface ZeropsTopologyOptions {
  readonly cli: ZeropsCli["Service"];
  /** The provider runtime bus, for the post-tool nudge. */
  readonly toolEvents: Stream.Stream<SpiEvent>;
  /**
   * Whether this server runs inside a Zerops project. False switches the feed
   * off before it touches anything: on a laptop running T3 there is no project
   * to read, so probing for a binary there is work with no possible answer.
   */
  readonly isZeropsEnvironment: boolean;
}

export const make = (options: ZeropsTopologyOptions) =>
  Effect.gen(function* () {
    const { cli, toolEvents, isZeropsEnvironment } = options;
    const changes = yield* PubSub.sliding<ZeropsTopologySnapshot>(8);
    const readMutex = yield* Semaphore.make(1);
    const subscribeMutex = yield* Semaphore.make(1);

    const startedAt = yield* DateTime.now;
    const state = yield* Ref.make<FeedState>({
      snapshot: {
        available: true,
        degraded: false,
        services: [],
        warnings: [],
        readAt: startedAt,
      },
      off: !isZeropsEnvironment,
      nudgeUntilMs: 0,
      doorbellConnected: false,
    });

    /**
     * Stamps the live doorbell state onto every snapshot before publishing, so
     * no construction site has to remember to carry it, and publishes only when
     * the content actually moved.
     */
    const publishIfChanged = (next: ZeropsTopologySnapshot) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const stamped: ZeropsTopologySnapshot = next.available
          ? { ...next, doorbellConnected: current.doorbellConnected }
          : next;
        const changed = contentSignature(current.snapshot) !== contentSignature(stamped);
        yield* Ref.update(state, (previous) => ({ ...previous, snapshot: stamped }));
        if (changed) {
          yield* PubSub.publish(changes, stamped);
        }
        return stamped;
      });

    /** Re-publishes the snapshot already held, picking up a changed doorbell state. */
    const republish = Ref.get(state).pipe(
      Effect.flatMap((current) => publishIfChanged(current.snapshot)),
      Effect.asVoid,
    );

    const setDoorbellConnected = (connected: boolean) =>
      Ref.update(state, (current) => ({ ...current, doorbellConnected: connected })).pipe(
        Effect.andThen(republish),
      );

    const refresh: Effect.Effect<ZeropsTopologySnapshot> = readMutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (current.off) {
          return current.snapshot;
        }
        const result = yield* Effect.result(cli.readTopology);
        const readAt = yield* DateTime.now;

        if (result._tag === "Success") {
          return yield* publishIfChanged({
            available: true,
            degraded: false,
            project: result.success.project,
            services: result.success.services,
            warnings: result.success.warnings,
            readAt,
          });
        }

        const error = result.failure;
        if (error._tag === "ZeropsCliNotFound") {
          // Not a Zerops environment. The feed reports itself unavailable and
          // stops: an absent binary is a fact about the machine, not a failure
          // to retry, and retrying would burn a spawn every few seconds forever.
          yield* Ref.update(state, (previous) => ({ ...previous, off: true }));
          return yield* publishIfChanged({
            available: false,
            degraded: false,
            reason: error.message,
            services: [],
            warnings: [],
            readAt,
          });
        }

        // zcp is here and answered badly. Keep the last good services — blanking
        // the map over a transient auth or network blip is worse than showing
        // state a few seconds old — and say so, so the client can mark it stale.
        return yield* publishIfChanged({
          ...current.snapshot,
          available: true,
          degraded: true,
          reason: error.reason,
          readAt,
        });
      }),
    );

    const nudge = Effect.gen(function* () {
      const now = yield* DateTime.now;
      const until = DateTime.toEpochMillis(now) + Duration.toMillis(NUDGE_WINDOW);
      yield* Ref.update(state, (current) => ({
        ...current,
        nudgeUntilMs: Math.max(current.nudgeUntilMs, until),
      }));
      yield* refresh;
    });

    if (isZeropsEnvironment) {
      // First read before anything is served, so a client that connects
      // immediately gets real state rather than an empty placeholder.
      yield* refresh;
    } else {
      yield* publishIfChanged({
        available: false,
        degraded: false,
        reason: "Not a Zerops environment",
        services: [],
        warnings: [],
        readAt: startedAt,
      });
    }

    const doorbellLoop = Effect.gen(function* () {
      let attempt = 0;
      for (;;) {
        if ((yield* Ref.get(state)).off) {
          return;
        }
        const outcome = yield* Effect.result(
          cli.watchDoorbell((event) =>
            Effect.gen(function* () {
              const connected = event.type !== "disconnected";
              // Set before refreshing so the refresh's own publish carries the
              // new doorbell state — one frame for the two facts, not two.
              yield* Ref.update(state, (current) => ({
                ...current,
                doorbellConnected: connected,
              }));
              // Every ring means "re-read": the event carries no data, and
              // `connected` after a reconnect means we may have missed changes.
              yield* connected ? refresh : republish;
            }),
          ),
        );
        yield* setDoorbellConnected(false);
        if (outcome._tag === "Failure" && outcome.failure._tag === "ZeropsCliNotFound") {
          yield* Ref.update(state, (current) => ({ ...current, off: true }));
          return;
        }
        attempt = outcome._tag === "Failure" ? attempt + 1 : 0;
        yield* Effect.sleep(restartDelay(attempt));
      }
    });

    const pollLoop = Effect.gen(function* () {
      for (;;) {
        yield* Effect.sleep(ACTIVE_POLL_INTERVAL);
        const current = yield* Ref.get(state);
        if (current.off) {
          return;
        }
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const somethingMoving = current.snapshot.services.some((service) => service.transient);
        // Poll while the picture can change under us: a service settling, a
        // recent tool call, a failing read to retry, or a doorbell that is down
        // (the watcher self-heals, and polling covers the gap meanwhile).
        if (
          somethingMoving ||
          current.nudgeUntilMs > now ||
          current.snapshot.degraded ||
          !current.doorbellConnected
        ) {
          yield* refresh;
        }
      }
    });

    const nudgeLoop = toolEvents.pipe(
      Stream.filter(
        (event) => event.type === "item.completed" && readZeropsToolCall(event) !== undefined,
      ),
      Stream.runForEach(() => nudge),
      Effect.catchCause(() => Effect.void),
    );

    if (!(yield* Ref.get(state)).off) {
      yield* Effect.forkScoped(doorbellLoop);
      yield* Effect.forkScoped(pollLoop);
      yield* Effect.forkScoped(nudgeLoop);
    }

    const latest = Ref.get(state).pipe(Effect.map((current) => current.snapshot));

    return {
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
      refresh,
    } satisfies ZeropsTopology["Service"];
  });

export const layer = Layer.effect(
  ZeropsTopology,
  Effect.gen(function* () {
    const cli = yield* ZeropsCli;
    const bus = yield* ProviderRuntimeEventBus;
    const config = yield* ServerConfig;
    return yield* make({
      cli,
      toolEvents: bus.events,
      // The one rule, owned by ZeropsEnvironment: `T3CODE_ZEROPS_PROJECT_ID`
      // set and non-empty. Nothing here re-derives it.
      isZeropsEnvironment: isZeropsEnvironment(config),
    });
  }),
).pipe(Layer.provide(ZeropsCliModule.layer));
