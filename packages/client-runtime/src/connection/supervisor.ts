import { withRelayClientTracing } from "@t3tools/shared/relayTracing";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Tracer from "effect/Tracer";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  DPOP_ACCESS_TOKEN_REFRESH_SKEW_MS,
  type ConnectionAttemptError,
  type ConnectionBlockedError,
  type ConnectionTarget,
  ConnectionTransientError,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import * as RpcSession from "../rpc/session.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import * as ConnectionWakeups from "./wakeups.ts";

const RETRY_DELAYS_MS = [3_000, 4_000, 8_000, 16_000] as const;
const CONNECTION_ESTABLISHMENT_TIMEOUT = "15 seconds";
const CONNECTION_PROBE_TIMEOUT = "15 seconds";
const MOBILE_CONNECTION_PROBE_TIMEOUT = "3 seconds";
/** How long a socket kept through an offline spell has to answer once the network is back. */
const NETWORK_RETURN_PROBE_TIMEOUT = "3 seconds";
const BACKOFF_RESET_AFTER_MS = 30_000;

interface SupervisorIntent {
  readonly desired: boolean;
  readonly network: NetworkStatus;
}

type SupervisorSignal =
  | { readonly _tag: "ConnectRequested" }
  | { readonly _tag: "DisconnectRequested" }
  | { readonly _tag: "RetryRequested" }
  | { readonly _tag: "NetworkChanged"; readonly network: NetworkStatus }
  | { readonly _tag: "Wakeup"; readonly reason: ConnectionWakeups.ConnectionWakeup }
  | { readonly _tag: "StreamDefect"; readonly session: RpcSession.RpcSession };

interface PendingRetryTrace {
  readonly previousAttempt: Tracer.Span;
  readonly failureCount: number;
  readonly delayMs: number;
  readonly reason: ConnectionAttemptError["reason"];
}

interface TracedAttemptFailure {
  readonly error: ConnectionAttemptError;
  readonly attemptSpan: Option.Option<Tracer.Span>;
}

interface ScopedConnection {
  readonly attemptSpan: Option.Option<Tracer.Span>;
  readonly lease: ConnectionDriver.EnvironmentConnectionLease;
  readonly scope: Scope.Closeable;
}

type AttemptOutcome =
  | {
      readonly _tag: "Interrupted";
      readonly established: boolean;
      readonly generation: number;
      readonly stable: boolean;
      readonly resetRetry: boolean;
    }
  | {
      readonly _tag: "Failure";
      readonly established: boolean;
      readonly generation: number;
      readonly stable: boolean;
      readonly failure: TracedAttemptFailure;
    };

type EstablishmentEvent =
  | {
      readonly _tag: "Completed";
      readonly exit: Exit.Exit<ScopedConnection, TracedAttemptFailure>;
    }
  | { readonly _tag: "Interrupted"; readonly resetRetry: boolean }
  | { readonly _tag: "TimedOut" };

type ReplacementPreparationEvent =
  | { readonly _tag: "Completed"; readonly exit: Exit.Exit<ScopedConnection, TracedAttemptFailure> }
  | { readonly _tag: "TimedOut" }
  | { readonly _tag: "AuthorizationExpired" };

type ConnectedLeaseEvent =
  | {
      readonly _tag: "ActiveCompleted";
      readonly exit: Exit.Exit<boolean, TracedAttemptFailure>;
    }
  | {
      readonly _tag: "ReplacementCompleted";
      readonly exit: Exit.Exit<Option.Option<ScopedConnection>, TracedAttemptFailure>;
    };

function exitUnlessInterrupted<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Exit.Exit<A, E>, never, R> {
  return Effect.matchCauseEffect(effect, {
    onFailure: (cause) =>
      Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(Exit.failCause(cause)),
    onSuccess: (value) => Effect.succeed(Exit.succeed(value)),
  });
}

export interface EnvironmentSupervisorOptions {
  readonly initiallyDesired?: boolean;
  /**
   * The generation of the credential the store holds, read only once that
   * credential is safe to present: it waits out a replacement still being
   * written. An attempt carries the generation it started under, and a block
   * it reports after the credential was replaced is not published — it
   * answers a credential that is gone. Without it every attempt shares one
   * generation.
   */
  readonly credentialGeneration?: Effect.Effect<number>;
}

function retryDelayMs(failureCount: number): number {
  return RETRY_DELAYS_MS[Math.min(failureCount, RETRY_DELAYS_MS.length - 1)] ?? 16_000;
}

function annotateTarget(target: ConnectionTarget) {
  return Effect.annotateCurrentSpan({
    "environment.id": target.environmentId,
    "environment.label": target.label,
    "environment.target.kind": target._tag,
  });
}

function availableState(intent: SupervisorIntent, generation: number): SupervisorConnectionState {
  return {
    desired: false,
    network: intent.network,
    phase: "available",
    stage: null,
    attempt: 0,
    generation,
    lastFailure: null,
    retryAt: null,
  };
}

function offlineState(
  intent: SupervisorIntent,
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
): SupervisorConnectionState {
  return {
    desired: true,
    network: intent.network,
    phase: "offline",
    stage: null,
    attempt,
    generation,
    lastFailure,
    retryAt: null,
  };
}

function connectingState(
  intent: SupervisorIntent,
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
  stage: SupervisorConnectionState["stage"] = "preparing",
): SupervisorConnectionState {
  return {
    desired: true,
    network: intent.network,
    phase: "connecting",
    stage,
    attempt,
    generation,
    lastFailure,
    retryAt: null,
  };
}

function failureFromExit<A>(
  target: ConnectionTarget,
  exit: Exit.Exit<A, TracedAttemptFailure>,
  established: boolean,
  generation: number,
  stable: boolean,
): AttemptOutcome {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) {
    return { _tag: "Interrupted", established, generation, stable, resetRetry: false };
  }
  const typedFailure = exit.cause.reasons.find(Cause.isFailReason);
  if (typedFailure) {
    return {
      _tag: "Failure",
      established,
      generation,
      stable,
      failure: typedFailure.error,
    };
  }
  return {
    _tag: "Failure",
    established,
    generation,
    stable,
    failure: {
      error: new ConnectionTransientError({
        reason: "transport",
        detail: `${target.label} connection failed unexpectedly.`,
      }),
      attemptSpan: Option.none(),
    },
  };
}

export class EnvironmentSupervisor extends Context.Service<
  EnvironmentSupervisor,
  {
    readonly target: ConnectionTarget;
    readonly state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>;
    readonly session: SubscriptionRef.SubscriptionRef<Option.Option<RpcSession.RpcSession>>;
    readonly prepared: SubscriptionRef.SubscriptionRef<Option.Option<PreparedConnection>>;
    readonly connect: Effect.Effect<void>;
    readonly disconnect: Effect.Effect<void>;
    readonly retryNow: Effect.Effect<void>;
    /** A durable subscription on `session` died of a defect; a session already replaced is ignored. */
    readonly reportStreamDefect: (session: RpcSession.RpcSession) => Effect.Effect<void>;
  }
>()("@t3tools/client-runtime/connection/supervisor/EnvironmentSupervisor") {}

export const make = Effect.fn("EnvironmentSupervisor.make")(function* (
  entry: ConnectionCatalogEntry,
  options?: EnvironmentSupervisorOptions,
): Effect.fn.Return<
  EnvironmentSupervisor["Service"],
  never,
  | Connectivity.Connectivity
  | ConnectionDriver.ConnectionDriver
  | Scope.Scope
  | ConnectionWakeups.ConnectionWakeups
> {
  const target = entry.target;
  yield* annotateTarget(target);

  const connectivity = yield* Connectivity.Connectivity;
  const driver = yield* ConnectionDriver.ConnectionDriver;
  const wakeups = yield* ConnectionWakeups.ConnectionWakeups;
  const initialIntent: SupervisorIntent = {
    desired: options?.initiallyDesired ?? false,
    network: yield* connectivity.status,
  };
  const intent = yield* Ref.make(initialIntent);
  const signals = yield* Queue.unbounded<SupervisorSignal>();
  const resetRetryState = yield* Ref.make(false);
  const credentialGeneration = options?.credentialGeneration ?? Effect.succeed(0);
  // Set when a foreground wake probe fails or times out: the user is actively
  // returning to the app on a dead transport, so the follow-up reconnect skips
  // the first backoff rung instead of sleeping.
  const wakeProbeFailed = yield* Ref.make(false);
  const state = yield* SubscriptionRef.make<SupervisorConnectionState>(
    !initialIntent.desired
      ? availableState(initialIntent, 0)
      : initialIntent.network === "offline"
        ? offlineState(initialIntent, 0, 0, null)
        : connectingState(initialIntent, 0, 1, null),
  );
  const session = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(Option.none());
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none());
  /** The attempt in flight is waiting its turn for a socket. */
  const queued = yield* SubscriptionRef.make(false);

  const clearLease = Effect.all(
    [SubscriptionRef.set(session, Option.none()), SubscriptionRef.set(prepared, Option.none())],
    { discard: true },
  );

  const setState = Effect.fn("EnvironmentSupervisor.setState")(function* (
    next: SupervisorConnectionState,
  ) {
    yield* SubscriptionRef.set(state, next);
  });

  const signal = Effect.fn("EnvironmentSupervisor.signal")(function* (next: SupervisorSignal) {
    yield* Queue.offer(signals, next);
  });

  const logManagedRelayAccountChange = Effect.logInfo(
    "Managed relay account changed; restarting the environment connection.",
  ).pipe(
    Effect.annotateLogs({
      "environment.id": target.environmentId,
      "environment.label": target.label,
    }),
  );

  const reportProgress = Effect.fn("EnvironmentSupervisor.reportProgress")(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    progress: ConnectionDriver.ConnectionDriverProgress,
  ) {
    if ("prepared" in progress) {
      yield* SubscriptionRef.set(prepared, Option.some(progress.prepared));
    }
    yield* setState(
      connectingState(yield* Ref.get(intent), generation, attempt, lastFailure, progress.stage),
    );
  });

  /**
   * The attempt waits in the browser's socket queue (`admission.ts`): time there is another
   * Mate's, so the setup timeout runs only outside it, and afresh after each wait.
   */
  const setupTimeout = Effect.gen(function* () {
    for (;;) {
      yield* SubscriptionRef.changes(queued).pipe(
        Stream.filter((waiting) => !waiting),
        Stream.runHead,
      );
      const expired = yield* Effect.raceFirst(
        Effect.sleep(CONNECTION_ESTABLISHMENT_TIMEOUT).pipe(Effect.as(true)),
        SubscriptionRef.changes(queued).pipe(
          Stream.filter((waiting) => waiting),
          Stream.runHead,
          Effect.as(false),
        ),
      );
      if (expired) return;
    }
  });

  const establishConnection = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    publishProgress: boolean,
  ) {
    return yield* driver.connect(
      entry,
      (progress) =>
        publishProgress ? reportProgress(attempt, generation, lastFailure, progress) : Effect.void,
      (waiting) => SubscriptionRef.set(queued, waiting),
    );
  });

  const traceRelayEstablishment = (
    effect: Effect.Effect<
      ConnectionDriver.EnvironmentConnectionLease,
      ConnectionAttemptError,
      Scope.Scope
    >,
    attempt: number,
    generation: number,
    pendingRetry: Option.Option<PendingRetryTrace>,
  ) => {
    const traced = Effect.gen(function* () {
      const attemptSpan = yield* Effect.currentSpan.pipe(Effect.orDie);
      yield* annotateTarget(target);
      yield* Effect.annotateCurrentSpan({
        "connection.attempt": attempt,
        "connection.generation": generation,
        "connection.retry.failure_count": Option.match(pendingRetry, {
          onNone: () => 0,
          onSome: (retry) => retry.failureCount,
        }),
      });
      const lease = yield* effect.pipe(
        Effect.mapError((error): TracedAttemptFailure => ({
          error,
          attemptSpan: Option.some(attemptSpan),
        })),
      );
      return { attemptSpan: Option.some(attemptSpan), lease };
    }).pipe(Effect.withSpan("relay.connection.attempt", { root: true }));

    return Option.match(pendingRetry, {
      onNone: () => traced,
      onSome: (retry) =>
        traced.pipe(
          Effect.linkSpans(retry.previousAttempt, {
            "connection.retry.delay_ms": retry.delayMs,
            "connection.retry.reason": retry.reason,
          }),
        ),
    }).pipe(withRelayClientTracing);
  };

  const establishTracedConnection = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    pendingRetry: Option.Option<PendingRetryTrace>,
    publishProgress: boolean,
  ) {
    if (target._tag === "RelayConnectionTarget") {
      return yield* traceRelayEstablishment(
        establishConnection(attempt, generation, lastFailure, publishProgress),
        attempt,
        generation,
        pendingRetry,
      );
    }
    return yield* establishConnection(attempt, generation, lastFailure, publishProgress).pipe(
      Effect.map((lease) => ({
        attemptSpan: Option.none<Tracer.Span>(),
        lease,
      })),
      Effect.mapError((error): TracedAttemptFailure => ({
        error,
        attemptSpan: Option.none(),
      })),
    );
  });

  const forkScopedTracedConnection = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    pendingRetry: Option.Option<PendingRetryTrace>,
    publishProgress: boolean,
  ) {
    const parentScope = yield* Scope.Scope;
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const connectionScope = yield* Scope.fork(parentScope, "sequential");
        const fiber = yield* restore(
          establishTracedConnection(
            attempt,
            generation,
            lastFailure,
            pendingRetry,
            publishProgress,
          ).pipe(
            Scope.provide(connectionScope),
            Effect.map(
              (established) =>
                ({ ...established, scope: connectionScope }) satisfies ScopedConnection,
            ),
          ),
        ).pipe(Effect.forkChild);
        return { fiber, scope: connectionScope };
      }),
    );
  });

  const waitForEstablishmentInterrupt = Effect.fnUntraced(function* () {
    for (;;) {
      const next = yield* Queue.take(signals);
      switch (next._tag) {
        case "DisconnectRequested":
        case "RetryRequested":
          return false;
        case "NetworkChanged":
          if (next.network === "offline") {
            return false;
          }
          break;
        case "ConnectRequested":
        case "StreamDefect":
          break;
        case "Wakeup":
          if (next.reason === "application-active-reconnect") {
            return true;
          }
          if (next.reason === "credentials-changed" && target._tag === "RelayConnectionTarget") {
            yield* logManagedRelayAccountChange;
            return false;
          }
          break;
      }
    }
  });

  /**
   * A durable subscription on this lease died of a defect: the lease is no longer trusted, and
   * the supervisor reconnects on its backoff ladder, showing reconnecting meanwhile.
   */
  const streamDefect = () =>
    Effect.fail(
      new ConnectionTransientError({
        reason: "transport",
        detail: `${target.label} sent data this client could not read.`,
      }),
    );

  /**
   * Asks a connected lease whether its socket still answers. `null` keeps the lease; a boolean
   * ends it as {@link monitorConnectedLease} does. A probe that fails or runs out of time is a
   * dead transport: the lease fails, and the reconnect skips the first backoff rung.
   */
  const probeConnectedLease = Effect.fnUntraced(function* (
    lease: ConnectionDriver.EnvironmentConnectionLease,
    timeout: Duration.Input,
  ) {
    const probe = yield* lease.session.probe.pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            new ConnectionTransientError({
              reason: "timeout",
              detail: `${target.label} did not respond to a connection health check.`,
            }),
          ),
      }),
      Effect.forkChild,
    );
    for (;;) {
      const probeEvent = yield* Effect.raceFirst(
        Fiber.await(probe).pipe(Effect.map((exit) => ({ _tag: "ProbeCompleted" as const, exit }))),
        Queue.take(signals).pipe(Effect.map((signal) => ({ _tag: "Signal" as const, signal }))),
      );
      if (probeEvent._tag === "ProbeCompleted") {
        if (Exit.isFailure(probeEvent.exit)) {
          yield* Ref.set(wakeProbeFailed, true);
        }
        yield* probeEvent.exit;
        return null;
      }
      switch (probeEvent.signal._tag) {
        case "DisconnectRequested":
        case "RetryRequested":
          yield* Fiber.interrupt(probe);
          return false;
        case "NetworkChanged":
          // A probe sent into an offline spell says nothing of the socket: the network's return
          // sends another.
          if (probeEvent.signal.network === "offline") {
            yield* Fiber.interrupt(probe);
            return null;
          }
          break;
        case "StreamDefect":
          if (probeEvent.signal.session === lease.session) {
            yield* Fiber.interrupt(probe);
            return yield* streamDefect();
          }
          break;
        case "Wakeup":
          if (probeEvent.signal.reason === "application-active-reconnect") {
            yield* Fiber.interrupt(probe);
            return true;
          }
          if (
            probeEvent.signal.reason === "credentials-changed" &&
            target._tag === "RelayConnectionTarget"
          ) {
            yield* Fiber.interrupt(probe);
            return false;
          }
          break;
        case "ConnectRequested":
          break;
      }
    }
  });

  /**
   * Watches a connected lease until it must end. An offline spell keeps it: a socket a short drop
   * left alive answers the probe the network's return sends, and the Mate is back without a new
   * socket — each of which waits its turn for the browser's one connecting slot. A socket the
   * drop killed closes by itself or fails that probe, and is replaced at once.
   */
  const monitorConnectedLease = Effect.fnUntraced(function* (
    lease: ConnectionDriver.EnvironmentConnectionLease,
  ) {
    /** The live state an offline spell covered: the face shows offline, never a live link. */
    let covered: SupervisorConnectionState | null = null;
    for (;;) {
      const next = yield* Queue.take(signals);
      /** A probe's verdict; null when none ran or the socket answered it. */
      let ended: boolean | null = null;
      let probed = false;
      switch (next._tag) {
        case "DisconnectRequested":
        case "RetryRequested":
          return false;
        case "StreamDefect":
          if (next.session === lease.session) return yield* streamDefect();
          break;
        case "NetworkChanged":
          if (next.network === "offline") {
            const current = yield* SubscriptionRef.get(state);
            covered ??= current;
            yield* setState({
              ...current,
              network: "offline",
              phase: "offline",
              stage: null,
              retryAt: null,
            });
          } else if (covered !== null) {
            probed = true;
            ended = yield* probeConnectedLease(lease, NETWORK_RETURN_PROBE_TIMEOUT);
          }
          break;
        case "Wakeup":
          if (next.reason === "credentials-changed" && target._tag === "RelayConnectionTarget") {
            yield* logManagedRelayAccountChange;
            return false;
          }
          if (next.reason === "application-active-reconnect") {
            // Mobile operating systems commonly suspend sockets without
            // delivering a close event. A long background resume deliberately
            // replaces that lease and starts a fresh attempt without backoff.
            return true;
          }
          if (next.reason === "application-active" || next.reason === "application-active-probe") {
            probed = true;
            ended = yield* probeConnectedLease(
              lease,
              next.reason === "application-active-probe"
                ? MOBILE_CONNECTION_PROBE_TIMEOUT
                : CONNECTION_PROBE_TIMEOUT,
            );
          }
          break;
        case "ConnectRequested":
          break;
      }
      if (ended !== null) return ended;
      // The socket answered a probe with the network back: the face is live again at once.
      const network = (yield* Ref.get(intent)).network;
      if (probed && covered !== null && network !== "offline") {
        yield* setState({ ...covered, network });
        covered = null;
      }
    }
  });

  const waitForAuthorizationDeadline = Effect.fnUntraced(function* (
    preparedConnection: PreparedConnection,
    skewMs: number,
  ) {
    const authorization = preparedConnection.httpAuthorization;
    if (authorization?._tag !== "Dpop") {
      return yield* Effect.never;
    }
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.sleep(Math.max(0, authorization.expiresAtEpochMs - now - skewMs));
  });

  const waitForActiveCompletion = Effect.fnUntraced(function* (active: ScopedConnection) {
    const exit = yield* exitUnlessInterrupted(
      Effect.raceAllFirst([
        active.lease.session.closed.pipe(
          Effect.mapError((error): TracedAttemptFailure => ({
            error,
            attemptSpan: active.attemptSpan,
          })),
        ),
        monitorConnectedLease(active.lease).pipe(
          Effect.mapError((error): TracedAttemptFailure => ({
            error,
            attemptSpan: active.attemptSpan,
          })),
        ),
      ]),
    );
    return { _tag: "ActiveCompleted", exit } satisfies ConnectedLeaseEvent;
  });

  const prepareReplacement = Effect.fnUntraced(function* (
    active: ScopedConnection,
    generation: number,
  ) {
    yield* waitForAuthorizationDeadline(active.lease.prepared, DPOP_ACCESS_TOKEN_REFRESH_SKEW_MS);
    yield* Effect.logDebug(
      "Preparing a replacement environment connection before its DPoP token expires.",
    );

    let failureCount = 0;
    for (;;) {
      yield* SubscriptionRef.set(queued, false);
      const candidate = yield* forkScopedTracedConnection(
        failureCount + 1,
        generation,
        null,
        Option.none(),
        false,
      );
      const replacement = yield* Effect.raceAllFirst([
        Fiber.await(candidate.fiber).pipe(
          Effect.map((exit): ReplacementPreparationEvent => ({ _tag: "Completed", exit })),
        ),
        waitForAuthorizationDeadline(active.lease.prepared, 0).pipe(
          Effect.as<ReplacementPreparationEvent>({ _tag: "AuthorizationExpired" }),
        ),
        setupTimeout.pipe(Effect.as<ReplacementPreparationEvent>({ _tag: "TimedOut" })),
      ]);

      if (replacement._tag !== "Completed") {
        yield* Fiber.interrupt(candidate.fiber);
        yield* Fiber.await(candidate.fiber);
        yield* Scope.close(candidate.scope, Exit.void).pipe(Effect.ignore);
      } else if (Exit.isFailure(replacement.exit)) {
        yield* Scope.close(candidate.scope, Exit.void).pipe(Effect.ignore);
      }
      if (replacement._tag === "AuthorizationExpired") {
        return Option.none<ScopedConnection>();
      }
      if (replacement._tag === "Completed" && Exit.isSuccess(replacement.exit)) {
        return Option.some(replacement.exit.value);
      }

      let replacementError: ConnectionTransientError;
      if (replacement._tag === "Completed") {
        if (Exit.isSuccess(replacement.exit)) {
          return yield* Effect.die("A successful replacement was not installed.");
        }
        const failure = Cause.findErrorOption(replacement.exit.cause);
        if (Option.isNone(failure) || failure.value.error._tag === "ConnectionBlockedError") {
          return yield* Effect.failCause(replacement.exit.cause);
        }
        replacementError = failure.value.error;
      } else {
        replacementError = new ConnectionTransientError({
          reason: "timeout",
          detail: `${target.label} did not respond during connection setup.`,
        });
      }

      const retryDelay = retryDelayMs(failureCount);
      failureCount += 1;
      yield* Effect.logWarning(
        "Could not prepare a replacement environment connection; keeping the active connection.",
      ).pipe(
        Effect.annotateLogs({
          "authorization.refresh.retry_delay_ms": retryDelay,
          ...safeErrorLogAttributes(replacementError),
        }),
      );
      const retryBeforeExpiry = yield* Effect.raceFirst(
        Effect.sleep(retryDelay).pipe(Effect.as(true)),
        waitForAuthorizationDeadline(active.lease.prepared, 0).pipe(Effect.as(false)),
      );
      if (!retryBeforeExpiry) {
        return Option.none<ScopedConnection>();
      }
    }
  });

  // A live session ending is otherwise invisible in the client trace, so record
  // why, and how long it lasted, as its own root span.
  const recordConnectionLost = Effect.fnUntraced(function* (
    outcome: AttemptOutcome,
    connectedAt: number,
  ) {
    if (outcome._tag !== "Failure") return outcome;
    const connectedForMs = (yield* Clock.currentTimeMillis) - connectedAt;
    yield* Effect.void.pipe(
      Effect.withSpan("EnvironmentSupervisor.connectionLost", {
        root: true,
        attributes: {
          "environment.id": target.environmentId,
          "environment.label": target.label,
          "environment.target.kind": target._tag,
          "connection.connected_ms": connectedForMs,
          "connection.failure.reason": outcome.failure.error.reason,
          "connection.failure.detail": outcome.failure.error.detail,
        },
      }),
    );
    return outcome;
  });

  const runAttempt = Effect.fnUntraced(function* (
    attempt: number,
    previousGeneration: number,
    lastFailure: ConnectionAttemptError | null,
    pendingRetry: Option.Option<PendingRetryTrace>,
  ) {
    const initialGeneration = previousGeneration + 1;
    yield* SubscriptionRef.set(prepared, Option.none());
    yield* SubscriptionRef.set(queued, false);
    const initial = yield* forkScopedTracedConnection(
      attempt,
      initialGeneration,
      lastFailure,
      pendingRetry,
      true,
    );
    const establishment = yield* Effect.raceAllFirst([
      Fiber.await(initial.fiber).pipe(
        Effect.map((exit): EstablishmentEvent => ({
          _tag: "Completed",
          exit,
        })),
      ),
      waitForEstablishmentInterrupt().pipe(
        Effect.map((resetRetry): EstablishmentEvent => ({
          _tag: "Interrupted",
          resetRetry,
        })),
      ),
      setupTimeout.pipe(Effect.as<EstablishmentEvent>({ _tag: "TimedOut" })),
    ]);

    if (establishment._tag !== "Completed") {
      yield* Fiber.interrupt(initial.fiber);
      yield* Fiber.await(initial.fiber);
      yield* Scope.close(initial.scope, Exit.void).pipe(Effect.ignore);
    } else if (Exit.isFailure(establishment.exit)) {
      yield* Scope.close(initial.scope, Exit.void).pipe(Effect.ignore);
    }
    if (establishment._tag === "Interrupted") {
      return {
        _tag: "Interrupted",
        established: false,
        generation: previousGeneration,
        stable: false,
        resetRetry: establishment.resetRetry,
      } satisfies AttemptOutcome;
    }
    if (establishment._tag === "TimedOut") {
      return {
        _tag: "Failure",
        established: false,
        generation: previousGeneration,
        stable: false,
        failure: {
          error: new ConnectionTransientError({
            reason: "timeout",
            detail: `${target.label} did not respond during connection setup.`,
          }),
          attemptSpan: Option.none(),
        },
      } satisfies AttemptOutcome;
    }
    if (Exit.isFailure(establishment.exit)) {
      const isUnexpectedDefect =
        !Cause.hasInterruptsOnly(establishment.exit.cause) &&
        !establishment.exit.cause.reasons.some(Cause.isFailReason);
      const outcome = failureFromExit(target, establishment.exit, false, previousGeneration, false);
      if (isUnexpectedDefect) {
        const defect = establishment.exit.cause.reasons.find(Cause.isDieReason)?.defect;
        yield* Effect.logError("Connection attempt failed with an unexpected defect.").pipe(
          Effect.annotateLogs({
            "environment.id": target.environmentId,
            "environment.label": target.label,
            "cause.reason_count": establishment.exit.cause.reasons.length,
            ...safeErrorLogAttributes(defect),
          }),
        );
      }
      return outcome;
    }

    const currentIntent = yield* Ref.get(intent);
    if (!currentIntent.desired || currentIntent.network === "offline") {
      return {
        _tag: "Interrupted",
        established: false,
        generation: previousGeneration,
        stable: false,
        resetRetry: false,
      } satisfies AttemptOutcome;
    }

    const connectedAt = yield* Clock.currentTimeMillis;
    let active = establishment.exit.value;
    let activeGeneration = initialGeneration;
    yield* SubscriptionRef.set(prepared, Option.some(active.lease.prepared));
    yield* SubscriptionRef.set(session, Option.some(active.lease.session));
    yield* setState({
      desired: true,
      network: currentIntent.network,
      phase: "connected",
      stage: null,
      attempt,
      generation: activeGeneration,
      lastFailure: null,
      retryAt: null,
    });

    for (;;) {
      const connectedEvent = yield* Effect.raceAllFirst([
        waitForActiveCompletion(active),
        exitUnlessInterrupted(prepareReplacement(active, activeGeneration + 1)).pipe(
          Effect.map((exit): ConnectedLeaseEvent => ({ _tag: "ReplacementCompleted", exit })),
        ),
      ]);
      const stable = (yield* Clock.currentTimeMillis) - connectedAt >= BACKOFF_RESET_AFTER_MS;
      if (connectedEvent._tag === "ActiveCompleted") {
        if (Exit.isSuccess(connectedEvent.exit)) {
          return {
            _tag: "Interrupted",
            established: true,
            generation: activeGeneration,
            stable,
            resetRetry: connectedEvent.exit.value,
          } satisfies AttemptOutcome;
        }
        return yield* recordConnectionLost(
          failureFromExit(target, connectedEvent.exit, true, activeGeneration, stable),
          connectedAt,
        );
      }
      if (Exit.isFailure(connectedEvent.exit)) {
        return yield* recordConnectionLost(
          failureFromExit(target, connectedEvent.exit, true, activeGeneration, stable),
          connectedAt,
        );
      }
      if (Option.isNone(connectedEvent.exit.value)) {
        return {
          _tag: "Interrupted",
          established: true,
          generation: activeGeneration,
          stable,
          resetRetry: true,
        } satisfies AttemptOutcome;
      }

      const candidate = connectedEvent.exit.value.value;
      const replacementIntent = yield* Ref.get(intent);
      if (!replacementIntent.desired || replacementIntent.network === "offline") {
        yield* Scope.close(candidate.scope, Exit.void).pipe(Effect.ignore);
        return {
          _tag: "Interrupted",
          established: true,
          generation: activeGeneration,
          stable,
          resetRetry: false,
        } satisfies AttemptOutcome;
      }

      const previous = active;
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          active = candidate;
          activeGeneration += 1;
          yield* SubscriptionRef.set(prepared, Option.some(active.lease.prepared));
          yield* SubscriptionRef.set(session, Option.some(active.lease.session));
          yield* setState({
            desired: true,
            network: replacementIntent.network,
            phase: "connected",
            stage: null,
            attempt: 1,
            generation: activeGeneration,
            lastFailure: null,
            retryAt: null,
          });
          yield* Scope.close(previous.scope, Exit.void).pipe(Effect.ignore);
        }),
      );
    }
  }, Effect.ensuring(clearLease));

  const waitForRetrySignal = Effect.fnUntraced(function* (delayMs: number) {
    // @effect-diagnostics-next-line raceFirstWithSleepToTimeout:off - the sleep is the retry delay (false), not a timeout around the signal loop
    return yield* Effect.raceFirst(
      Effect.sleep(delayMs).pipe(Effect.as(false)),
      Effect.gen(function* () {
        for (;;) {
          const next = yield* Queue.take(signals);
          switch (next._tag) {
            case "Wakeup":
              return ConnectionWakeups.isApplicationActiveWakeup(next.reason);
            case "ConnectRequested":
            case "DisconnectRequested":
            case "RetryRequested":
            case "NetworkChanged":
              return false;
            case "StreamDefect":
              // A defect of a lease already gone.
              break;
          }
        }
      }),
    );
  });

  const waitForSignal = Effect.gen(function* () {
    for (;;) {
      const next = yield* Queue.take(signals);
      // A defect of a lease already gone asks for nothing.
      if (next._tag === "StreamDefect") continue;
      return next._tag === "Wakeup" && ConnectionWakeups.isApplicationActiveWakeup(next.reason);
    }
  });

  /**
   * A stored bearer its server refused stays refused — expired, revoked or unknown, the answer
   * is final for that token — and only its owner can replace it: the door's rotation, which
   * retries the link, or a disconnect. A wake or the network coming back changes nothing, so it
   * never sends the dead bearer again (a tab left open past its sessions' day did so on every
   * wake, to every Mate at once).
   */
  const holdsUntilReplaced = (error: ConnectionBlockedError) =>
    target._tag === "BearerConnectionTarget" && error.reason === "authentication";

  const waitForReplacement = Effect.gen(function* () {
    for (;;) {
      const next = yield* Queue.take(signals);
      switch (next._tag) {
        case "ConnectRequested":
        case "DisconnectRequested":
        case "RetryRequested":
          return false;
        case "NetworkChanged":
        case "Wakeup":
        case "StreamDefect":
          break;
      }
    }
  });

  const run = Effect.fnUntraced(function* () {
    let failureCount = 0;
    let generation = 0;
    let latestFailure: ConnectionAttemptError | null = null;
    let pendingRetry = Option.none<PendingRetryTrace>();
    const resetRetryLadder = () => {
      failureCount = 0;
      pendingRetry = Option.none();
    };

    for (;;) {
      if (yield* Ref.getAndSet(resetRetryState, false)) {
        failureCount = 0;
        latestFailure = null;
        pendingRetry = Option.none();
      }
      const currentIntent = yield* Ref.get(intent);
      if (!currentIntent.desired) {
        resetRetryLadder();
        latestFailure = null;
        yield* clearLease;
        yield* setState(availableState(currentIntent, generation));
        yield* waitForSignal;
        continue;
      }
      if (currentIntent.network === "offline") {
        yield* clearLease;
        yield* setState(offlineState(currentIntent, generation, failureCount + 1, latestFailure));
        const applicationActivated = yield* waitForSignal;
        if (applicationActivated) {
          resetRetryLadder();
        }
        continue;
      }

      const attempt = failureCount + 1;
      const attemptCredentialGeneration = yield* credentialGeneration;
      const outcome: AttemptOutcome = yield* Effect.scoped(
        runAttempt(attempt, generation, latestFailure, pendingRetry),
      );
      // Consumed on every iteration so a stale marker can never leak into a
      // later, unrelated failure.
      const failedWakeProbe = yield* Ref.getAndSet(wakeProbeFailed, false);
      generation = outcome.generation;
      if (outcome.established) {
        if (outcome.stable) {
          resetRetryLadder();
          latestFailure = null;
        }
      }
      if (outcome._tag === "Interrupted") {
        if (outcome.resetRetry) {
          resetRetryLadder();
        }
        continue;
      }

      const attemptSpan: Option.Option<Tracer.Span> = outcome.failure.attemptSpan;
      const error: ConnectionAttemptError = outcome.failure.error;
      latestFailure = error;
      if (error._tag === "ConnectionBlockedError") {
        // The credential this attempt presented was replaced while it was in
        // flight, so the block answers one that is gone. Published, it would
        // read as a rejection of the new one. The replacement's retry signal
        // re-attempts with the new credential.
        if ((yield* credentialGeneration) === attemptCredentialGeneration) {
          const blockedIntent = yield* Ref.get(intent);
          yield* setState({
            desired: blockedIntent.desired,
            network: blockedIntent.network,
            phase: "blocked",
            stage: null,
            attempt,
            generation,
            lastFailure: error,
            retryAt: null,
          });
        }
        const applicationActivated = yield* holdsUntilReplaced(error)
          ? waitForReplacement
          : waitForSignal;
        if (applicationActivated) {
          resetRetryLadder();
        }
        continue;
      }

      if ((yield* Ref.get(intent)).network === "offline") {
        // A lease kept through an offline spell that died meanwhile: the network's return, not a
        // backoff, starts the next attempt.
        continue;
      }

      if (failedWakeProbe) {
        // The wake probe found a dead transport while the user is returning to
        // the app, so reconnect immediately instead of sleeping the first
        // backoff rung. Only this first attempt skips the ladder; if it fails
        // too, normal backoff resumes.
        resetRetryLadder();
        yield* setState(connectingState(yield* Ref.get(intent), generation, 1, error));
        continue;
      }

      failureCount += 1;
      const delayMs = retryDelayMs(failureCount - 1);
      pendingRetry = Option.map(attemptSpan, (previousAttempt) => ({
        previousAttempt,
        failureCount,
        delayMs,
        reason: error.reason,
      }));
      const failedIntent = yield* Ref.get(intent);
      yield* setState({
        desired: failedIntent.desired,
        network: failedIntent.network,
        phase: "backoff",
        stage: null,
        attempt,
        generation,
        lastFailure: error,
        retryAt: (yield* Clock.currentTimeMillis) + delayMs,
      });
      const applicationActivated = yield* waitForRetrySignal(delayMs);
      if (applicationActivated) {
        resetRetryLadder();
      }
    }
  });

  yield* connectivity.changes.pipe(
    Stream.runForEach((network) =>
      Ref.modify(intent, (current) =>
        current.network === network ? [false, current] : ([true, { ...current, network }] as const),
      ).pipe(
        Effect.flatMap((changed) =>
          changed ? signal({ _tag: "NetworkChanged", network }) : Effect.void,
        ),
      ),
    ),
    Effect.forkScoped,
  );
  yield* wakeups.changes.pipe(
    Stream.runForEach((reason) => signal({ _tag: "Wakeup", reason })),
    Effect.forkScoped,
  );
  yield* run().pipe(Effect.forkScoped);

  const connect = Ref.update(intent, (current) => ({
    ...current,
    desired: true,
  })).pipe(
    Effect.andThen(signal({ _tag: "ConnectRequested" })),
    Effect.withSpan("EnvironmentSupervisor.connect"),
  );

  const disconnect = Ref.update(intent, (current) => ({
    ...current,
    desired: false,
  })).pipe(
    Effect.andThen(signal({ _tag: "DisconnectRequested" })),
    Effect.withSpan("EnvironmentSupervisor.disconnect"),
  );

  const retryNow = Ref.set(resetRetryState, true).pipe(
    Effect.andThen(signal({ _tag: "RetryRequested" })),
    Effect.withSpan("EnvironmentSupervisor.retryNow"),
  );

  const reportStreamDefect = (defective: RpcSession.RpcSession) =>
    signal({ _tag: "StreamDefect", session: defective }).pipe(
      Effect.withSpan("EnvironmentSupervisor.reportStreamDefect"),
    );

  yield* Effect.addFinalizer(() => Queue.shutdown(signals).pipe(Effect.andThen(clearLease)));

  return EnvironmentSupervisor.of({
    target,
    state,
    session,
    prepared,
    connect,
    disconnect,
    retryNow,
    reportStreamDefect,
  });
});
