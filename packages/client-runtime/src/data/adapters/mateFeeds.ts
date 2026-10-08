/** Snapshot transports only. The account reducer retains values; the common supervisor owns recovery. */
import {
  CrewFrameUndecodable,
  EnvironmentAuthorizationError,
  EnvironmentAuthInvalidError,
  EnvironmentScopeRequiredError,
  EnvironmentOperationForbiddenError,
  WS_METHODS,
  type EnvironmentId,
  type ThreadId,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import * as HttpClient from "effect/http/HttpClient";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { EnvironmentRegistry } from "../../connection/registry.ts";
import { applyTerminalMetadataStreamEvent } from "../../state/terminalSession.ts";
import {
  MATE_FEED_FAMILIES,
  mateFeedId,
  mateFeedLink,
  mateFeedScope,
  type MateFeedKey,
  type MateFeedValues,
} from "../families/mateFeeds.ts";
import { applyServerConfigProjection } from "../../state/serverConfigProjection.ts";
import { fetchEnvironmentSessionState } from "./mateClientAccess.ts";
import { ManagedRelayDpopSigner } from "../../relay/managedRelay.ts";
import { streamOf, type Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
const isHttpAuthInvalid = Schema.is(EnvironmentAuthInvalidError);
const isHttpDenied = Schema.is(
  Schema.Union([EnvironmentScopeRequiredError, EnvironmentOperationForbiddenError]),
);
const isAuthorization = Schema.is(EnvironmentAuthorizationError);
const isUndecodable = Schema.is(CrewFrameUndecodable);
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
/**
 * Where a crew frame stands: the engine's revision (the crew owner's gapless seq under the Mate's
 * epoch), or V1's wall-clock `seq` where the frame carries none.
 */
export type CrewFrameMark =
  | { readonly kind: "revision"; readonly epoch: number; readonly seq: number }
  | { readonly kind: "seq"; readonly seq: number };

export function crewFrameMark(frame: {
  readonly seq: number;
  readonly revision?: { readonly epoch: number; readonly seq: number } | undefined;
}): CrewFrameMark {
  return frame.revision === undefined
    ? { kind: "seq", seq: frame.seq }
    : { kind: "revision", epoch: frame.revision.epoch, seq: frame.revision.seq };
}

/** A crew frame is taken only when newer than the last: epoch first, then its sequence. */
export function isNewerCrewFrame(
  last: CrewFrameMark | null,
  frame: Parameters<typeof crewFrameMark>[0],
): boolean {
  if (last === null) return true;
  const next = crewFrameMark(frame);
  if (next.kind === "revision" && last.kind === "revision")
    return next.epoch !== last.epoch ? next.epoch > last.epoch : next.seq > last.seq;
  // A server that changed what it speaks within one session: its first frame is a baseline.
  if (next.kind !== last.kind) return true;
  return next.seq > last.seq;
}

export function classifyMateFeedFailure(cause: Cause.Cause<unknown>): StreamFault {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason) && isHttpAuthInvalid(reason.error))
      return { outcome: "access-unverified", message: reason.error.message };
    if (Cause.isFailReason(reason) && isHttpDenied(reason.error))
      return { outcome: "authoritative-denial", message: reason.error.message };
    if (Cause.isFailReason(reason) && isAuthorization(reason.error))
      return { outcome: "definitive-refusal", message: reason.error.message };
    if (Cause.isDieReason(reason) && messageOf(reason.defect).startsWith("Unknown request tag"))
      return {
        outcome: "definitive-refusal",
        code: "unsupported",
        message: messageOf(reason.defect).replace("Unknown request tag: ", ""),
      };
  }
  return { outcome: "transient", message: messageOf(Cause.squash(cause)) };
}
export type MateFeedEvent =
  | { readonly kind: "session-unavailable" }
  | { readonly kind: "session" }
  | { readonly kind: "value"; readonly value: MateFeedValues[keyof MateFeedValues] };
export interface MateFeedWire {
  readonly open: (key: MateFeedKey) => Stream.Stream<MateFeedEvent, StreamFault>;
  readonly watch?: (
    environmentId: string,
    receive: (fault: StreamFault | null) => void,
  ) => Effect.Effect<void>;
}
/** Session rotation cancels the previous stream before asking for the replacement baseline. */
export function makeMateFeedWire(
  registry: EnvironmentRegistry["Service"],
  httpClient?: HttpClient.HttpClient,
): MateFeedWire {
  return {
    watch: (environmentId, receive) =>
      registry.stateChanges(environmentId as EnvironmentId).pipe(
        Stream.runForEach((state) =>
          Effect.sync(() => {
            if (
              state.phase === "blocked" &&
              state.lastFailure?._tag === "ConnectionBlockedError" &&
              ["authentication", "permission", "read-only"].includes(state.lastFailure.reason)
            )
              receive({
                outcome:
                  state.lastFailure.reason === "authentication"
                    ? "access-unverified"
                    : "authoritative-denial",
                message: state.lastFailure.message,
              });
            else if (state.phase === "connected") receive(null);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() =>
            receive({
              outcome: "authoritative-denial",
              message: "This Mate is no longer registered.",
            }),
          ),
        ),
      ),
    open: (key) =>
      registry
        .followStream(
          key.environmentId as EnvironmentId,
          Stream.unwrap(
            Effect.map(EnvironmentSupervisor, (supervisor) =>
              SubscriptionRef.changes(supervisor.session).pipe(
                Stream.switchMap((session) => {
                  if (Option.isNone(session))
                    return Stream.make({ kind: "session-unavailable" } as const);
                  const client = session.value.client;
                  let values: Stream.Stream<MateFeedValues[keyof MateFeedValues], unknown>;
                  switch (key.family) {
                    case "mateServerConfig":
                      values = Stream.concat(
                        Stream.fromEffect(session.value.initialConfig).pipe(
                          Stream.map(
                            (config) => ({ version: 1, type: "snapshot", config }) as const,
                          ),
                        ),
                        client[WS_METHODS.subscribeServerConfig]({
                          usageLimitSources: true,
                          usageLimitsCommand: true,
                          mateUpdate: true,
                        }),
                      ).pipe(
                        Stream.mapAccum(
                          () =>
                            Option.none<
                              import("../../state/serverConfigProjection.ts").ServerConfigProjection
                            >(),
                          (current, event) => {
                            const next = applyServerConfigProjection(current, event);
                            return [next, Option.toArray(next)] as const;
                          },
                        ),
                      );
                      break;
                    case "mateWelcome":
                      values = client[WS_METHODS.subscribeServerLifecycle]({}).pipe(
                        Stream.filter((event) => event.type === "welcome"),
                        Stream.map(
                          (event) =>
                            event.payload as import("@t3tools/contracts").ServerLifecycleWelcomePayload,
                        ),
                      );
                      break;
                    case "mateProviderAuth":
                      values = client[WS_METHODS.providerAuthSubscribe](
                        key.input as unknown as import("../../rpc/client.ts").EnvironmentRpcInput<
                          typeof WS_METHODS.providerAuthSubscribe
                        >,
                      );
                      break;
                    case "mateProviderInstall":
                      values = client[WS_METHODS.providerInstallSubscribe](
                        key.input as unknown as import("../../rpc/client.ts").EnvironmentRpcInput<
                          typeof WS_METHODS.providerInstallSubscribe
                        >,
                      );
                      break;
                    case "mateResourceTelemetry":
                      values = client[WS_METHODS.subscribeResourceTelemetry]({});
                      break;
                    case "mateProjectClone":
                      values = client[WS_METHODS.subscribeProjectClones]({});
                      break;
                    case "mateClientSession":
                      if (httpClient === undefined) {
                        values = Stream.fail<StreamFault>({
                          outcome: "definitive-refusal",
                          message: "The authenticated HTTP transport is unavailable.",
                        });
                        break;
                      }
                      values = Stream.fromEffect(
                        Effect.gen(function* () {
                          const prepared = yield* SubscriptionRef.get(supervisor.prepared);
                          if (Option.isNone(prepared))
                            return yield* Effect.fail<StreamFault>({
                              outcome: "access-unverified",
                              message: "The Mate session is not verified.",
                            });
                          return yield* fetchEnvironmentSessionState({
                            prepared: prepared.value,
                            signer: yield* Effect.serviceOption(ManagedRelayDpopSigner),
                          });
                        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
                      );
                      break;
                    case "mateLifecycle":
                      values = client[WS_METHODS.subscribeZeropsLifecycle]({
                        threadId: key.input?.threadId as ThreadId,
                      });
                      break;
                    case "mateAgentAuth":
                      values = client[WS_METHODS.subscribeZeropsAgentAuth]({});
                      break;
                    case "mateCrew":
                      values = client[WS_METHODS.subscribeZeropsCrew]({}).pipe(
                        Stream.mapEffect((frame) =>
                          isUndecodable(frame)
                            ? Effect.fail<StreamFault>({
                                outcome: "definitive-refusal",
                                code: "malformed",
                                message: "Crew sent a frame this client cannot read.",
                              })
                            : Effect.succeed(frame),
                        ),
                      );
                      break;
                    case "mateCrewFiles":
                      values = Stream.fromEffect(client[WS_METHODS.zeropsCrewFilesGet]({}));
                      break;
                    case "mateTerminal":
                      values = Stream.suspend(() => {
                        let based = false;
                        let terminals: ReadonlyArray<TerminalSummary> = [];
                        return client[WS_METHODS.subscribeTerminalMetadata]({}).pipe(
                          Stream.mapEffect((event) => {
                            if (!based && event.type !== "snapshot")
                              return Effect.fail<StreamFault>({
                                outcome: "definitive-refusal",
                                code: "malformed",
                                message: "Terminal metadata arrived without a baseline.",
                              });
                            based = true;
                            terminals = applyTerminalMetadataStreamEvent(terminals, event);
                            return Effect.succeed(terminals);
                          }),
                        );
                      });
                      break;
                  }
                  return Stream.concat(
                    Stream.make({ kind: "session" } as const),
                    values.pipe(Stream.map((value): MateFeedEvent => ({ kind: "value", value }))),
                  );
                }),
              ),
            ),
          ),
        )
        .pipe(
          Stream.takeUntil(
            (event) =>
              MATE_FEED_FAMILIES[key.family].scope.mode !== "realtime" && event.kind === "value",
          ),
          Stream.catchCause((cause) => {
            const error = Cause.findErrorOption(cause);
            if (Option.isSome(error) && isAuthorization(error.value))
              return Stream.fail<StreamFault>({
                outcome: "authoritative-denial",
                message: error.value.message,
              });
            return Stream.fail(
              Option.isSome(error) &&
                typeof error.value === "object" &&
                error.value !== null &&
                "outcome" in error.value
                ? (error.value as StreamFault)
                : classifyMateFeedFailure(cause),
            );
          }),
        ),
  };
}
/** One stream per demanded identity, shared by all holders, with retained refusals across remounts. */
export function makeMateFeeds(options: {
  readonly store: AccountStore;
  readonly wire: MateFeedWire;
}) {
  const { store, wire } = options;
  const held = new Map<
    string,
    {
      count: number;
      stop: () => void;
      retry: () => void;
      refresh: () => void;
      fault: (fault: StreamFault) => void;
      recover: () => void;
    }
  >();
  const seen = new Map<string, Map<string, MateFeedKey>>();
  const watches = new Map<string, Fiber.Fiber<void>>();
  const withheld = new Map<string, StreamFault>();
  const receiveAccess = (environmentId: string, fault: StreamFault | null) => {
    if (closed) return;
    if (fault !== null) {
      withheld.set(environmentId, fault);
      for (const [scope, key] of seen.get(environmentId) ?? []) {
        store.dispatch({
          kind: "access",
          family: key.family,
          id: mateFeedId(key),
          access: fault.outcome === "authoritative-denial" ? "denied" : "unverified",
        });
        store.dispatch({
          kind: "stream",
          key: mateFeedScope(key),
          now: Effect.runSync(Clock.currentTimeMillis),
          event: { kind: "fault", fault, jitter: 0 },
        });
        held.get(scope)?.fault(fault);
      }
    } else {
      const verified = withheld.delete(environmentId);
      for (const [scope, key] of seen.get(environmentId) ?? []) {
        if (
          !verified &&
          streamOf(store.state(), mateFeedLink(key)).fault?.outcome !== "access-unverified" &&
          streamOf(store.state(), mateFeedScope(key)).fault?.outcome !== "access-unverified"
        )
          continue;
        store.dispatch({
          kind: "access",
          family: key.family,
          id: mateFeedId(key),
          access: "allowed",
        });
        const active = held.get(scope);
        if (active) active.recover();
        else {
          const now = Effect.runSync(Clock.currentTimeMillis);
          for (const target of [mateFeedLink(key), mateFeedScope(key)]) {
            store.dispatch({ kind: "stream", key: target, now, event: { kind: "input-changed" } });
            store.dispatch({
              kind: "stream",
              key: target,
              now,
              event: { kind: "demand", demanded: false },
            });
          }
        }
      }
    }
  };
  let closed = false;
  const closeListeners = new Set<() => void>();
  const hold = (key: MateFeedKey) => {
    if (closed) return () => {};
    const scope = mateFeedScope(key);
    const scopes = seen.get(key.environmentId) ?? new Map<string, MateFeedKey>();
    scopes.set(scope, key);
    seen.set(key.environmentId, scopes);
    if (!watches.has(key.environmentId) && wire.watch)
      watches.set(
        key.environmentId,
        Effect.runFork(
          wire.watch(key.environmentId, (fault) => receiveAccess(key.environmentId, fault)),
        ),
      );
    let entry = held.get(scope);
    if (entry === undefined) {
      const link = mateFeedLink(key);
      const faults = Effect.runSync(Queue.unbounded<StreamFault>());
      const wake = Effect.runSync(Queue.sliding<void>(1));
      const signal = (target: typeof scope | typeof link, event: StreamEvent) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      const readAttempt = () =>
        Effect.gen(function* () {
          const unlisten = store.subscribe(() => Queue.offerUnsafe(wake, undefined));
          yield* Effect.addFinalizer(() => Effect.sync(unlisten));
          const access = withheld.get(key.environmentId);
          if (access) return yield* Effect.fail(access);
          for (;;) {
            let based = false;
            let generation: number | undefined;
            let crewMark: CrewFrameMark | null = null;
            yield* Stream.runForEach(wire.open(key), (event) =>
              Effect.gen(function* () {
                if (closed || withheld.has(key.environmentId)) return;
                if (event.kind === "session-unavailable") {
                  based = false;
                  generation = undefined;
                  yield* signal(scope, { kind: "parent-lost" });
                  return;
                }
                if (event.kind === "session") {
                  based = false;
                  crewMark = null;
                  yield* signal(link, { kind: "handshake" });
                  yield* signal(scope, { kind: "attempt" });
                  yield* signal(scope, { kind: "handshake" });
                  generation = streamOf(store.state(), scope).generation;
                  return;
                }
                if (
                  generation === undefined ||
                  generation !== streamOf(store.state(), scope).generation
                )
                  return;
                const observationGeneration = generation;
                if (key.family === "mateCrew" && "seq" in event.value) {
                  const frame = event.value as Parameters<typeof crewFrameMark>[0];
                  if (!isNewerCrewFrame(crewMark, frame)) return;
                  crewMark = crewFrameMark(frame);
                }
                const now = yield* Clock.currentTimeMillis;
                const prior = store.state().facts.get(`${key.family}:${mateFeedId(key)}`)?.revision;
                const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
                const row = {
                  family: key.family,
                  id: mateFeedId(key),
                  value: { snapshot: event.value, observedAtMs: now },
                  revision: { kind: "mate-link", sequence },
                } as Row;
                Atom.batch(() => {
                  store.dispatch({
                    kind: "access",
                    family: key.family,
                    id: row.id,
                    access: "allowed",
                  });
                  if (!based) {
                    store.dispatch({
                      kind: "baseline-begin",
                      scope,
                      generation: observationGeneration,
                    });
                    store.dispatch({
                      kind: "baseline-commit",
                      scope,
                      generation: observationGeneration,
                      via: "mate-direct",
                      rows: [row],
                      members: [row.id],
                    });
                    based = true;
                  } else
                    store.dispatch({
                      kind: "rows",
                      scope,
                      generation: observationGeneration,
                      method: "push",
                      via: "mate-direct",
                      rows: [row],
                    });
                  store.dispatch({
                    kind: "stream",
                    key: scope,
                    now,
                    event: { kind: "baseline-committed" },
                  });
                  store.dispatch({
                    kind: "stream",
                    key: link,
                    now,
                    event: { kind: "baseline-committed" },
                  });
                });
              }),
            );
            if (MATE_FEED_FAMILIES[key.family].scope.mode === "realtime")
              return yield* Effect.fail<StreamFault>({
                outcome: "transient",
                message: "The Mate feed ended.",
              });
            for (;;) {
              const stream = streamOf(store.state(), scope);
              if (stream.phase === "connecting" || stream.phase === "baselining") break;
              if (stream.next.kind === "revalidate") {
                const now = yield* Clock.currentTimeMillis;
                if (now >= stream.next.at) {
                  yield* signal(scope, { kind: "revalidate" });
                  break;
                }
                yield* Effect.raceFirst(Queue.take(wake), Effect.sleep(stream.next.at - now));
              } else yield* Queue.take(wake);
            }
          }
        }).pipe(
          Effect.catch((fault: StreamFault) => {
            if (
              !closed &&
              (fault.outcome === "authoritative-denial" || fault.outcome === "access-unverified")
            )
              store.dispatch({
                kind: "access",
                family: key.family,
                id: mateFeedId(key),
                access: fault.outcome === "authoritative-denial" ? "denied" : "unverified",
              });
            return Effect.fail(fault);
          }),
        );
      const supervisor = Effect.runSync(
        superviseLink({
          key: link,
          scopes: [scope],
          store,
          attempt: () =>
            Effect.raceFirst(readAttempt(), Queue.take(faults).pipe(Effect.flatMap(Effect.fail))),
          repairSession: Effect.fail({
            outcome: "definitive-refusal",
            message: "Reconnect this Mate to verify access.",
          }),
        }),
      );
      const fiber = Effect.runFork(supervisor.run);
      entry = {
        count: 0,
        stop: () => {
          Effect.runSync(supervisor.release);
          void Effect.runFork(Fiber.interrupt(fiber));
        },
        retry: () => {
          Effect.runSync(signal(scope, { kind: "revalidate" }));
          void Effect.runFork(supervisor.signal("manual-retry"));
        },
        fault: (fault) => {
          Queue.offerUnsafe(faults, fault);
        },
        recover: () => {
          void Effect.runFork(supervisor.signal("input-changed"));
        },
        refresh: () => {
          Effect.runSync(signal(scope, { kind: "revalidate" }));
        },
      };
      held.set(scope, entry);
    }
    entry.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--entry.count === 0) {
        entry.stop();
        held.delete(scope);
      }
    };
  };
  return {
    hold,
    retry: (key: MateFeedKey) => held.get(mateFeedScope(key))?.retry(),
    revalidate: (key: MateFeedKey) => held.get(mateFeedScope(key))?.refresh(),
    onClose: (listener: () => void) => {
      if (closed) listener();
      else closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    close: () => {
      closed = true;
      for (const listener of closeListeners) listener();
      closeListeners.clear();
      for (const entry of held.values()) entry.stop();
      held.clear();
      for (const fiber of watches.values()) void Effect.runFork(Fiber.interrupt(fiber));
      watches.clear();
    },
  };
}

/** Hosts obtain transport services here; they only bind account lifecycle. */
export const mateFeedServices = Effect.gen(function* () {
  return { registry: yield* EnvironmentRegistry, httpClient: yield* HttpClient.HttpClient };
});
