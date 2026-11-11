import {
  type ServerConfig,
  type ServerConfigStreamEvent,
  WsSubscribeServerConfigRpc,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcClientError from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

import { makeWsRpcProtocolClient, type WsRpcProtocolClient } from "./protocol.ts";
import type {
  ConnectionAttemptError,
  ConnectionTransientError,
  PreparedConnection,
} from "../connection/model.ts";
import {
  ConnectionBlockedError,
  ConnectionTransientError as ConnectionTransientErrorClass,
} from "../connection/model.ts";
import {
  applyServerConfigProjection,
  type ServerConfigProjection,
  withoutUsageLimitSources,
} from "../state/serverConfigProjection.ts";

const SOCKET_OPEN_TIMEOUT = "15 seconds";
// Pings go out every 5 seconds and the silence is judged on those ticks. Between the third and
// the fourth tick, so timer drift never makes it two: three unanswered pings drop the socket.
const PING_TIMEOUT = "17500 millis";
// A ping tick this long after the last one means this client's timers stood still (a hidden tab's
// run once a minute, a suspended machine's not at all), not that the Mate was silent meanwhile.
const LATE_PING_TICK_MILLIS = 10_000;
// A frame of ours this large or larger left the socket since the last ping tick: the link carries
// our own send (a picture as data to a Mate before uploads, a file written whole), with the pings
// and their pongs queued behind it. That is the link's life, not the Mate's silence. A dead link
// lets nothing leave, so its silence is judged as before.
const SENT_BYTES_A_TICK = 64 * 1024;
/** A Mate closed a ticket's socket: it took the ticket's access back, or refused it (`ws.ts`). */
const MATE_ACCESS_ENDED_CLOSE = 4401;

export interface RpcSession {
  readonly client: WsRpcProtocolClient;
  readonly initialConfig: Effect.Effect<ServerConfig, ConnectionAttemptError>;
  readonly subscribeServerConfig: (
    input: ServerConfigSubscriptionInput,
  ) => ServerConfigSubscription;
  readonly ready: Effect.Effect<void, ConnectionAttemptError>;
  /** The socket itself opened; `ready` follows once the server's config arrived. */
  readonly opened?: Effect.Effect<void, ConnectionAttemptError>;
  readonly probe: Effect.Effect<void, ConnectionAttemptError>;
  readonly closed: Effect.Effect<never, ConnectionAttemptError>;
}

/**
 * The connection's one config subscription asks with every capability flag given here, so a feed
 * asking with the same flags (`MATE_SERVER_CONFIG_SUBSCRIPTION`) shares it instead of opening a
 * second.
 */
export interface RpcSessionOptions extends ServerConfigSubscriptionInput {
  /**
   * True while this client's own throttling may hold pongs back (a hidden browser tab runs its
   * timers once a minute), so missed pongs then never close the socket. The person's return is
   * checked by the next pings and the connection's visible-wake probe.
   */
  readonly pingTimeoutPaused?: () => boolean;
}

export class RpcSessionFactory extends Context.Service<
  RpcSessionFactory,
  {
    readonly connect: (
      connection: PreparedConnection,
    ) => Effect.Effect<RpcSession, ConnectionAttemptError, Scope.Scope>;
  }
>()("@t3tools/client-runtime/rpc/session/RpcSessionFactory") {}

type InitialConfigError = Effect.Error<
  ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverGetConfig]>
>;
type ProbeError = Effect.Error<ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverProbe]>>;
type ServerConfigSubscriptionError =
  | Rpc.ErrorExit<typeof WsSubscribeServerConfigRpc>
  | RpcClientError.RpcClientError;
type ServerConfigSubscription = Stream.Stream<
  ServerConfigStreamEvent,
  ServerConfigSubscriptionError
>;
type ServerConfigSubscriptionInput = Parameters<
  WsRpcProtocolClient[typeof WS_METHODS.subscribeServerConfig]
>[0];
type UsageLimitSourcesUpdatedEvent = Extract<
  ServerConfigStreamEvent,
  { readonly type: "usageLimitSourcesUpdated" }
>;

interface ServerConfigReplayState {
  readonly projection: ServerConfigProjection;
  readonly revision: number;
  readonly sourcesEvent: UsageLimitSourcesUpdatedEvent | undefined;
}

interface BufferedServerConfigEvent {
  readonly event: ServerConfigStreamEvent;
  readonly replay: ServerConfigReplayState;
  readonly revision: number;
}

function serverConfigReplayEvents(
  state: ServerConfigReplayState,
): ReadonlyArray<ServerConfigStreamEvent> {
  const snapshot = {
    version: 1 as const,
    type: "snapshot" as const,
    config: withoutUsageLimitSources(state.projection.config),
  };
  return state.sourcesEvent === undefined ? [snapshot] : [snapshot, state.sourcesEvent];
}

function mapSessionRpcError(
  error: InitialConfigError | ProbeError | ServerConfigSubscriptionError,
): ConnectionAttemptError {
  switch (error._tag) {
    case "EnvironmentAuthorizationError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: error.message,
      });
    case "KeybindingsConfigParseError":
    case "ServerSettingsError":
      return new ConnectionTransientErrorClass({
        reason: "remote-unavailable",
        detail: error.message,
      });
    case "RpcClientError":
      return new ConnectionTransientErrorClass({
        reason: "transport",
        detail: error.message,
      });
  }
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("RpcSessionFactory.make")(function* (
  options: RpcSessionOptions = {},
) {
  const webSocketConstructor = yield* Socket.WebSocketConstructor;
  const { pingTimeoutPaused: _pingTimeoutPaused, ...serverConfigInput } = options;

  const connect = Effect.fnUntraced(function* (connection: PreparedConnection) {
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": connection.environmentId,
    });

    const connected = yield* Deferred.make<void>();
    const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
    // Set when the socket closes because pongs stopped, so the failure says so
    // instead of looking like the server closed the connection.
    const pingTimedOut = yield* Ref.make(false);
    // Set by the socket's own close, which runs before the protocol's disconnect hook.
    let mateAccessEnded = false;
    const hooks = RpcClient.ConnectionHooks.of({
      onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
      onDisconnect: Effect.all([Deferred.isDone(connected), Ref.get(pingTimedOut)]).pipe(
        Effect.flatMap(([wasConnected, timedOut]) =>
          Deferred.fail(
            disconnected,
            new ConnectionTransientErrorClass({
              reason: mateAccessEnded ? "mate-access-ended" : "transport",
              detail: mateAccessEnded
                ? `${connection.label} ended this connection's access.`
                : !wasConnected
                  ? `${connection.label} could not establish a WebSocket connection.`
                  : timedOut
                    ? `${connection.label} stopped responding.`
                    : `${connection.label} disconnected.`,
            }),
          ),
        ),
        Effect.asVoid,
      ),
    });
    const firstFrame = connection.firstFrame;
    /** The connection's socket, and what it still had to send at the last ping tick. */
    let sending: {
      readonly socket: ReturnType<typeof webSocketConstructor>;
      waiting: number;
    } | null = null;
    const constructor: typeof webSocketConstructor = (url, protocols) => {
      const socket = webSocketConstructor(url, protocols);
      sending = { socket, waiting: 0 };
      if (firstFrame === undefined) return socket;
      // Registered before the protocol's own listeners: the ticket is the connection's first frame.
      socket.addEventListener("open", () => socket.send(firstFrame), { once: true });
      socket.addEventListener(
        "close",
        (event) => {
          mateAccessEnded = event.code === MATE_ACCESS_ENDED_CLOSE;
        },
        { once: true },
      );
      return socket;
    };
    /** Whether a large frame of ours left the socket since the last ping tick. */
    const sentSinceLastTick = () => {
      if (sending === null) return false;
      // A socket that does not say what waits (a test's, a runtime's own) never counts as sending.
      const waiting =
        "bufferedAmount" in sending.socket && typeof sending.socket.bufferedAmount === "number"
          ? sending.socket.bufferedAmount
          : 0;
      const left = sending.waiting - waiting;
      sending.waiting = waiting;
      return left >= SENT_BYTES_A_TICK;
    };
    const socketLayer = Socket.layerWebSocket(connection.socketUrl, {
      openTimeout: SOCKET_OPEN_TIMEOUT,
    }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, constructor)));
    const protocolLayer = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        pingTimeout: PING_TIMEOUT,
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
        onPingTimeout: Ref.set(pingTimedOut, true),
        // Either way the Mate gets three pings again before its silence drops the socket.
        pingTimeoutPaused: (sinceLastTickMillis) => {
          // Read on every tick: the next one compares with what waits now.
          const sent = sentSinceLastTick();
          return (
            sent ||
            sinceLastTickMillis > LATE_PING_TICK_MILLIS ||
            options.pingTimeoutPaused?.() === true
          );
        },
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          socketLayer,
          RpcSerialization.layerJson,
          Layer.succeed(RpcClient.ConnectionHooks, hooks),
        ),
      ),
    );
    const protocolContext = yield* Layer.build(protocolLayer).pipe(
      Effect.withSpan("environment.websocket.connect"),
    );
    const protocolClient = yield* makeWsRpcProtocolClient.pipe(Effect.provide(protocolContext));
    const initialConfigDeferred = yield* Deferred.make<ServerConfig>();
    const serverConfigExit = yield* Deferred.make<void, ServerConfigSubscriptionError>();
    const configSubscriptionClosed = yield* Deferred.make<never, ConnectionAttemptError>();
    const serverConfigState = yield* Ref.make(Option.none<ServerConfigReplayState>());
    const serverConfigUpdates = yield* PubSub.sliding<BufferedServerConfigEvent>(64);
    const configSubscriptionEndedError = new ConnectionTransientErrorClass({
      reason: "remote-unavailable",
      detail: `${connection.label} config subscription ended.`,
    });
    const serverConfigSource = protocolClient[WS_METHODS.subscribeServerConfig](
      serverConfigInput,
    ).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const buffered = yield* Ref.modify(serverConfigState, (current) => {
            const projection = applyServerConfigProjection(
              Option.map(current, (state) => state.projection),
              event,
            );
            if (Option.isNone(projection)) {
              return [Option.none<BufferedServerConfigEvent>(), current] as const;
            }
            const next = {
              projection: projection.value,
              revision: Option.match(current, {
                onNone: () => 1,
                onSome: (state) => state.revision + 1,
              }),
              sourcesEvent:
                event.type === "usageLimitSourcesUpdated"
                  ? event
                  : event.type === "snapshot" &&
                      event.config.environment.capabilities.usageLimitSources !== true
                    ? undefined
                    : Option.getOrUndefined(current)?.sourcesEvent,
            } satisfies ServerConfigReplayState;
            return [
              Option.some({ event, replay: next, revision: next.revision }),
              Option.some(next),
            ] as const;
          });
          if (Option.isSome(buffered)) {
            yield* PubSub.publish(serverConfigUpdates, buffered.value);
          }
          if (event.type === "snapshot") {
            yield* Deferred.succeed(initialConfigDeferred, event.config);
          }
        }),
      ),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          return Effect.all([
            Deferred.succeed(serverConfigExit, undefined),
            Deferred.fail(configSubscriptionClosed, configSubscriptionEndedError),
          ]).pipe(Effect.asVoid);
        }
        if (Cause.hasInterruptsOnly(exit.cause)) {
          return Effect.void;
        }
        return Effect.all([
          Deferred.failCause(serverConfigExit, exit.cause),
          Deferred.failCause(configSubscriptionClosed, Cause.map(exit.cause, mapSessionRpcError)),
        ]).pipe(Effect.asVoid);
      }),
    );
    yield* serverConfigSource.pipe(Effect.forkScoped);
    const initialConfig = Effect.raceFirst(
      Deferred.await(initialConfigDeferred),
      Deferred.await(serverConfigExit).pipe(
        Effect.mapError(mapSessionRpcError),
        Effect.flatMap(() => Effect.fail(configSubscriptionEndedError)),
      ),
    ).pipe(Effect.withSpan("environment.initialSync"));
    const serverConfigEvents = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(serverConfigUpdates);
        yield* Effect.raceFirst(
          Deferred.await(initialConfigDeferred).pipe(Effect.asVoid),
          Deferred.await(serverConfigExit),
        );
        const snapshot = yield* Ref.get(serverConfigState);
        if (Option.isNone(snapshot)) {
          return Stream.empty;
        }
        const updates = Stream.fromSubscription(subscription).pipe(
          Stream.filter((buffered) => buffered.revision > snapshot.value.revision),
          Stream.mapAccum(
            () => snapshot.value.revision,
            (revision, buffered) => [
              buffered.revision,
              buffered.revision === revision + 1
                ? [buffered.event]
                : serverConfigReplayEvents(buffered.replay),
            ],
          ),
        );
        const terminal = Stream.fromEffect(Deferred.await(serverConfigExit)).pipe(Stream.drain);
        return Stream.concat(
          Stream.fromIterable(serverConfigReplayEvents(snapshot.value)),
          Stream.merge(updates, terminal, { haltStrategy: "either" }),
        );
      }),
    ).pipe(
      Stream.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Stream.failCause(cause);
        }
        // The supervisor keeps the original cause. Shared durable consumers
        // need a transport-shaped failure so they wait for its replacement.
        return Stream.fail(
          new RpcClientError.RpcClientError({
            reason: new RpcClientError.RpcClientDefect({
              message: `${connection.label} config subscription failed.`,
              cause,
            }),
          }),
        );
      }),
    );
    const subscribeServerConfig = (input: ServerConfigSubscriptionInput) =>
      Equal.equals(input, serverConfigInput)
        ? serverConfigEvents
        : protocolClient[WS_METHODS.subscribeServerConfig](input);
    const probe = initialConfig.pipe(
      Effect.flatMap((config) =>
        (config.environment.capabilities.connectionProbe === true
          ? protocolClient[WS_METHODS.serverProbe]({})
          : protocolClient[WS_METHODS.serverGetConfig]({})
        ).pipe(Effect.mapError(mapSessionRpcError)),
      ),
      Effect.asVoid,
      Effect.withSpan("clientRuntime.connection.rpcSession.probe"),
    );

    return {
      client: protocolClient,
      initialConfig,
      subscribeServerConfig,
      ready: Deferred.await(connected).pipe(
        Effect.andThen(initialConfig),
        Effect.asVoid,
        Effect.raceFirst(Deferred.await(disconnected)),
      ),
      opened: Deferred.await(connected).pipe(Effect.raceFirst(Deferred.await(disconnected))),
      probe,
      closed: Effect.raceFirst(
        Deferred.await(disconnected),
        Deferred.await(configSubscriptionClosed),
      ),
    } satisfies RpcSession;
  });

  return RpcSessionFactory.of({ connect });
});

export const layerWithOptions = (options: RpcSessionOptions) =>
  Layer.effect(RpcSessionFactory, make(options));
