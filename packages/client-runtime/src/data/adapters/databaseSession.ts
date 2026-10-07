/** A demanded console-status stream. Observation never starts the console; database read intents do. */
import {
  WS_METHODS,
  type EnvironmentId,
  type ZeropsDataConsoleSessionEvent,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { databaseSessionScope, type DatabaseSessionValue } from "../families/database.ts";
import type { LinkKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { classifyDatabaseFailure } from "./databaseFailure.ts";

export type DatabaseSessionEvent =
  | { readonly kind: "session" }
  | { readonly kind: "lost" }
  | { readonly kind: "value"; readonly value: ZeropsDataConsoleSessionEvent };
export interface DatabaseSessionWire {
  readonly open: (environmentId: EnvironmentId) => Stream.Stream<DatabaseSessionEvent, StreamFault>;
}

export function makeDatabaseSessionWire(
  registry: EnvironmentRegistry["Service"],
): DatabaseSessionWire {
  return {
    open: (environmentId) =>
      registry
        .followStream(
          environmentId,
          Stream.unwrap(
            Effect.map(EnvironmentSupervisor, (supervisor) =>
              SubscriptionRef.changes(supervisor.session).pipe(
                Stream.switchMap(
                  Option.match({
                    onNone: () => Stream.make({ kind: "lost" } as const),
                    onSome: (session) =>
                      Stream.concat(
                        Stream.make({ kind: "session" } as const),
                        session.client[WS_METHODS.subscribeZeropsDataConsole]({}).pipe(
                          Stream.map((value): DatabaseSessionEvent => ({ kind: "value", value })),
                        ),
                      ),
                  }),
                ),
              ),
            ),
          ),
        )
        .pipe(Stream.catchCause((cause) => Stream.fail(classifyDatabaseSessionFailure(cause)))),
  };
}
function classifyDatabaseSessionFailure(cause: Cause.Cause<unknown>): StreamFault {
  const squashed = Cause.squash(cause);
  const text = squashed instanceof Error ? squashed.message : String(squashed);
  if (text.includes("Unknown request tag"))
    return {
      outcome: "definitive-refusal",
      code: "unsupported",
      message: "This Mate doesn't include the data console yet.",
    };
  return classifyDatabaseFailure(squashed);
}

/** A status sample has no wire revision; one source stream orders complete values, fenced by its scope generation. */
export function makeDatabaseSessionSink(store: AccountStore, environmentId: EnvironmentId) {
  const scope = databaseSessionScope(environmentId);
  const prior = store.state().facts.get(`databaseSession:${environmentId}`)?.revision;
  let sequence = prior?.kind === "mate-link" ? prior.sequence : 0;
  let based = false;
  let generation = -1;
  const signal = (event: StreamEvent, now: number) =>
    store.dispatch({ kind: "stream", key: scope, now, event });
  return {
    session(now: number) {
      based = false;
      signal({ kind: "demand", demanded: true }, now);
      signal({ kind: "attempt" }, now);
      signal({ kind: "handshake" }, now);
      generation = streamOf(store.state(), scope).generation;
    },
    value(event: ZeropsDataConsoleSessionEvent, now: number) {
      const state = streamOf(store.state(), scope);
      if (state.generation !== generation || state.phase === "refused" || state.phase === "paused")
        return;
      const value: DatabaseSessionValue = {
        status: event.status,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      };
      const row = {
        family: "databaseSession",
        id: environmentId,
        value,
        revision: { kind: "mate-link", sequence: ++sequence },
      } as const;
      if (!based) {
        store.dispatch({ kind: "baseline-begin", scope, generation: state.generation });
        store.dispatch({
          kind: "baseline-commit",
          scope,
          generation: state.generation,
          via: "mate-direct",
          rows: [row],
          members: [environmentId],
        });
        signal({ kind: "baseline-committed" }, now);
        based = true;
      } else
        store.dispatch({
          kind: "rows",
          scope,
          generation: state.generation,
          method: "push",
          via: "mate-direct",
          rows: [row],
        });
    },
    lost(fault: StreamFault, now: number) {
      signal({ kind: "fault", fault, jitter: 0 }, now);
      if (fault.outcome === "authoritative-denial")
        store.dispatch({
          kind: "access",
          family: "databaseSession",
          id: environmentId,
          access: "denied",
        });
    },
  };
}

export function startDatabaseSession({
  store,
  environmentId,
  wire,
  onDenied,
}: {
  readonly store: AccountStore;
  readonly environmentId: EnvironmentId;
  readonly wire: DatabaseSessionWire;
  readonly onDenied?: () => void;
}) {
  const scope = databaseSessionScope(environmentId);
  const key: LinkKey = `mate:database-session-${encodeURIComponent(environmentId)}`;
  let retry = () => {};
  let release = () => {};
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const sink = makeDatabaseSessionSink(store, environmentId);
        const attempt = Effect.gen(function* () {
          yield* Stream.runForEach(wire.open(environmentId), (event) =>
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              if (event.kind === "lost")
                return yield* Effect.fail<StreamFault>({
                  outcome: "transient",
                  message: "The Mate's socket is not connected.",
                });
              if (event.kind === "session") {
                store.dispatch({ kind: "stream", key, now, event: { kind: "handshake" } });
                sink.session(now);
              } else {
                sink.value(event.value, now);
                store.dispatch({ kind: "stream", key, now, event: { kind: "baseline-committed" } });
              }
            }),
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                const fault = classifyDatabaseSessionFailure(cause);
                if (fault.outcome === "authoritative-denial") onDenied?.();
                sink.lost(fault, yield* Clock.currentTimeMillis);
                return yield* Effect.fail(fault);
              }),
            ),
          );
          return yield* Effect.fail<StreamFault>({
            outcome: "transient",
            message: "The database session stream ended.",
          });
        });
        const supervisor = yield* superviseLink({
          store,
          key,
          scopes: [scope],
          attempt: () => attempt,
          repairSession: Effect.fail({
            outcome: "definitive-refusal",
            message: "Sign in to this Mate again.",
          } satisfies StreamFault),
        });
        retry = () => {
          Effect.runFork(supervisor.signal("manual-retry"));
        };
        release = () => {
          Effect.runSync(supervisor.release);
        };
        return yield* supervisor.run;
      }),
    ),
  );
  return {
    stop: () => {
      release();
      Effect.runFork(Fiber.interrupt(fiber));
    },
    retry: () => retry(),
  };
}
