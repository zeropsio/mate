/** Snapshot transports only. The account reducer retains values; the common supervisor owns recovery. */
import {
  CrewFrameUndecodable,
  EnvironmentAuthorizationError,
  WS_METHODS,
  type EnvironmentId,
  type ThreadId,
  type TerminalSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { applyTerminalMetadataStreamEvent } from "../../state/terminalSession.ts";
import {
  MATE_FEED_FAMILIES,
  mateFeedId,
  mateFeedLink,
  mateFeedScope,
  type MateFeedKey,
  type MateFeedValues,
} from "../families/mateFeeds.ts";
import { streamOf, type Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
const isAuthorization = Schema.is(EnvironmentAuthorizationError);
const isUndecodable = Schema.is(CrewFrameUndecodable);
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export function classifyMateFeedFailure(cause: Cause.Cause<unknown>): StreamFault {
  for (const reason of cause.reasons) {
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
export function makeMateFeedWire(registry: EnvironmentRegistry["Service"]): MateFeedWire {
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
                    return Stream.fail<StreamFault>({
                      outcome: "transient",
                      message: "The Mate's socket is not connected.",
                    });
                  const client = session.value.client;
                  let values: Stream.Stream<MateFeedValues[keyof MateFeedValues], unknown>;
                  switch (key.family) {
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
                    case "mateUsage":
                      values = Stream.fromEffect(
                        client[WS_METHODS.serverGetUsageSummary](
                          key.input as unknown as UsageSummaryInput,
                        ),
                      );
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
    } else if (withheld.delete(environmentId)) {
      for (const [scope, key] of seen.get(environmentId) ?? []) {
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
            let generation = 0;
            let crewSeq = -1;
            yield* Stream.runForEach(wire.open(key), (event) =>
              Effect.gen(function* () {
                if (closed || withheld.has(key.environmentId)) return;
                if (event.kind === "session") {
                  based = false;
                  crewSeq = -1;
                  yield* signal(link, { kind: "handshake" });
                  yield* signal(scope, { kind: "attempt" });
                  yield* signal(scope, { kind: "handshake" });
                  generation = streamOf(store.state(), scope).generation;
                  return;
                }
                if (generation !== streamOf(store.state(), scope).generation) return;
                if (key.family === "mateCrew" && "seq" in event.value) {
                  if (event.value.seq <= crewSeq) return;
                  crewSeq = event.value.seq;
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
                    store.dispatch({ kind: "baseline-begin", scope, generation });
                    store.dispatch({
                      kind: "baseline-commit",
                      scope,
                      generation,
                      via: "mate-direct",
                      rows: [row],
                      members: [row.id],
                    });
                    based = true;
                  } else
                    store.dispatch({
                      kind: "rows",
                      scope,
                      generation,
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
