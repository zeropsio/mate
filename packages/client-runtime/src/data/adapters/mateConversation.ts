/** Reuses ordered snapshot/replay and paging; only the account reducer retains source values. */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/reactivity";
import { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "../../state/threadState.ts";
import { engineRouteOf, mateEngineHostAtom, type EngineRoute } from "../engineHost.ts";
import {
  ENGINE_UPDATE_WORDS,
  engineRows,
  engineHeldTurns,
  engineThread,
  overlayEngineShell,
} from "../projections/mateEngine.ts";
import type { EnvironmentCacheStore } from "../../platform/persistence.ts";
import { followStreamInEnvironment } from "../../state/runtime.ts";
import type { ShellSnapshotLoader } from "../../state/shellSnapshotHttp.ts";
import type { ThreadSnapshotLoader } from "../../state/threadSnapshotHttp.ts";
import { openShellReplay } from "./mateShellReplay.ts";
import {
  openThreadReplay,
  registerOlderThreadTurns,
  type ThreadResumeCache,
} from "./mateThreadReplay.ts";
import type { AccountStore } from "../store.ts";
import type { MateThreadValue } from "../families/mateConversation.ts";
import {
  conversationId,
  conversationScope,
  mateShell,
  mateThread,
  type ConversationKey,
} from "../projections/mateConversation.ts";
import { streamOf, type Row } from "../reducer.ts";
/**
 * A V1 conversation read that starts only once the Mate's door says its conversation is V1's: an
 * engine Mate's parked V1 history is never read. The cached paint comes from the account's facts.
 */
const v1Only = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  Stream.unwrap(
    Effect.map(EnvironmentSupervisor, (supervisor) =>
      SubscriptionRef.changes(supervisor.prepared).pipe(
        Stream.filter(Option.isSome),
        Stream.map((prepared) => engineRouteOf(prepared.value).kind === "v1"),
        Stream.changes,
        Stream.switchMap((v1) => (v1 ? stream : Stream.empty)),
      ),
    ),
  );

export const mateConversationStoreAtom = Atom.make<AccountStore | null>(null).pipe(Atom.keepAlive);
export const publishConversation = (
  store: AccountStore,
  key: ConversationKey,
  value: import("../families/mateConversation.ts").MateShellValue | MateThreadValue,
) => {
  const family = key.threadId === undefined ? "mateShell" : "mateThread";
  const scope = conversationScope(key);
  const id = conversationId(key);
  const status = value.state.status;
  const ready = status === "live" || status === "deleted";
  if (
    (ready || status === "synchronizing") &&
    streamOf(store.state(), scope).phase !== "live" &&
    streamOf(store.state(), scope).phase !== "baselining"
  ) {
    for (const event of [{ kind: "attempt" }, { kind: "handshake" }] as const)
      store.dispatch({
        kind: "stream",
        key: scope,
        now: Effect.runSync(Clock.currentTimeMillis),
        event,
      });
  }
  const generation = streamOf(store.state(), scope).generation;
  const prior = store.state().facts.get(`${family}:${id}`)?.revision;
  const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
  const hasValue =
    "snapshot" in value.state
      ? Option.isSome(value.state.snapshot)
      : Option.isSome(value.state.data) || value.state.status === "deleted";
  if (hasValue) {
    const row = { family, id, value, revision: { kind: "mate-link", sequence } } as Row;
    if (ready) {
      store.dispatch({ kind: "access", family, id, access: "allowed" });
      store.dispatch({ kind: "baseline-begin", scope, generation });
      store.dispatch({
        kind: "baseline-commit",
        scope,
        generation,
        via: "mate-direct",
        members: [id],
        rows: [row],
      });
    } else {
      store.dispatch({
        kind: "rows",
        scope,
        generation,
        via: "mate-direct",
        method: "read",
        rows: [row],
      });
    }
  }
  store.dispatch({
    kind: "stream",
    key: scope,
    now: Effect.runSync(Clock.currentTimeMillis),
    event:
      status === "live" || status === "deleted"
        ? { kind: "baseline-committed" }
        : status === "synchronizing"
          ? { kind: "handshake" }
          : {
              kind: "fault",
              jitter: 0,
              fault: { outcome: "transient", message: "Conversation replay is unavailable." },
            },
  });
};

export function createAccountConversationAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ShellSnapshotLoader | ThreadSnapshotLoader | R,
    E
  >,
) {
  const holders = Atom.family((encoded: string) =>
    Atom.make((get) => {
      const store = get(mateConversationStoreAtom);
      if (store === null) return null;
      const key = JSON.parse(encoded) as ConversationKey;
      const scope = conversationScope(key);
      let active = true;

      for (const event of [
        { kind: "demand", demanded: true },
        { kind: "attempt" },
        { kind: "handshake" },
      ] as const)
        store.dispatch({
          kind: "stream",
          key: scope,
          now: Effect.runSync(Clock.currentTimeMillis),
          event,
        });
      const effect = Effect.gen(function* () {
        const connection = yield* EnvironmentRegistry;
        let protectedRead = true;
        yield* connection.stateChanges(key.environmentId as EnvironmentId).pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              if (!active) return;
              if (state.phase === "connected") {
                protectedRead = true;
                if (
                  ["refused", "paused", "recovering"].includes(streamOf(store.state(), scope).phase)
                )
                  store.dispatch({
                    kind: "stream",
                    key: scope,
                    now: Effect.runSync(Clock.currentTimeMillis),
                    event: { kind: "input-changed" },
                  });
                return;
              }
              if (
                state.phase === "blocked" &&
                state.lastFailure?._tag === "ConnectionBlockedError" &&
                ["authentication", "permission", "read-only"].includes(state.lastFailure.reason)
              ) {
                protectedRead = false;
                const access =
                  state.lastFailure.reason === "authentication"
                    ? ("unverified" as const)
                    : ("denied" as const);
                store.dispatch({
                  kind: "access",
                  family: key.threadId === undefined ? "mateShell" : "mateThread",
                  id: conversationId(key),
                  access,
                });
                store.dispatch({
                  kind: "stream",
                  key: scope,
                  now: Effect.runSync(Clock.currentTimeMillis),
                  event: {
                    kind: "fault",
                    jitter: 0,
                    fault: {
                      outcome:
                        access === "unverified" ? "access-unverified" : "authoritative-denial",
                      message: state.lastFailure.message,
                    },
                  },
                });
              }
            }),
          ),
          Effect.forkScoped,
        );
        if (key.threadId === undefined) {
          yield* followStreamInEnvironment(
            key.environmentId as EnvironmentId,
            Stream.unwrap(openShellReplay(store).pipe(Effect.map(SubscriptionRef.changes))),
          ).pipe(
            Stream.runForEach((state) =>
              Effect.sync(() => {
                if (active && protectedRead) publishConversation(store, key, { state });
              }),
            ),
          );
        } else {
          let owner: object | undefined;
          const resume: ThreadResumeCache = {
            get owner() {
              return owner;
            },
            set owner(value) {
              owner = value;
            },
            get snapshot() {
              const fact = store.state().facts.get(`mateThread:${conversationId(key)}`);
              return fact?.content.kind === "value"
                ? (fact.content.value as MateThreadValue).resume
                : undefined;
            },
            set snapshot(value) {
              if (!active || !protectedRead || value === undefined) return;
              publishConversation(store, key, { state: value.state, resume: value });
            },
          };
          yield* followStreamInEnvironment(
            key.environmentId as EnvironmentId,
            v1Only(
              Stream.unwrap(
                openThreadReplay(key.threadId as ThreadId, resume, true).pipe(
                  Effect.map(SubscriptionRef.changes),
                ),
              ),
            ),
          ).pipe(
            Stream.runForEach((state) =>
              Effect.sync(() => {
                if (active && protectedRead) {
                  const retained = resume.snapshot;
                  publishConversation(store, key, {
                    state,
                    ...(retained === undefined ? {} : { resume: retained }),
                  });
                }
              }),
            ),
          );
        }
      });
      get.mount(runtime.atom(effect));
      get.addFinalizer(() => {
        active = false;
        store.dispatch({
          kind: "stream",
          key: scope,
          now: Effect.runSync(Clock.currentTimeMillis),
          event: { kind: "demand", demanded: false },
        });
      });
      return store;
    }),
  );
  /**
   * Where each Mate's conversation is read, as its door said (`capabilities.mateEngine`): kept
   * across reconnects, so a socket that drops never unmounts the conversation; a Mate that comes
   * back on the other path moves it there.
   */
  const routes = Atom.family((environmentId: string) =>
    runtime
      .atom(
        Stream.unwrap(
          Effect.map(EnvironmentRegistry, (registry) =>
            registry.followStream(
              environmentId as EnvironmentId,
              Stream.unwrap(
                Effect.map(EnvironmentSupervisor, (supervisor) =>
                  SubscriptionRef.changes(supervisor.prepared),
                ),
              ),
            ),
          ),
        ).pipe(
          Stream.filter(Option.isSome),
          Stream.map((prepared) => engineRouteOf(prepared.value)),
          Stream.changesWith(
            (left, right) =>
              left.kind === right.kind &&
              (left.kind !== "engine" ||
                right.kind !== "engine" ||
                left.protocol === right.protocol),
          ),
        ),
      )
      .pipe(Atom.keepAlive, Atom.withLabel(`mate-conversation-route:${environmentId}`)),
  );
  const routeOf = (get: Atom.AtomContext, environmentId: string): EngineRoute =>
    // Before the door answers, V1 as always. The web keeps no conversation across a reload, so this
    // paints only the opening state, never V1 content an engine Mate would take back.
    Option.getOrElse(AsyncResult.value(get(routes(environmentId))), () => ({
      kind: "unknown" as const,
    }));
  /** An engine conversation held while its thread is read; stable across its changes. */
  const engineHolds = Atom.family((encoded: string) =>
    Atom.make((get) => {
      const host = get(mateEngineHostAtom);
      const key = JSON.parse(encoded) as Required<ConversationKey>;
      if (host !== null) {
        const conversation = {
          environmentId: key.environmentId as string,
          conversationId: key.threadId as string,
        };
        get.addFinalizer(host.conversations.hold(conversation));
        // "Load earlier" asks the same registry a V1 thread's machine answers.
        get.addFinalizer(
          registerOlderThreadTurns(
            key.environmentId as EnvironmentId,
            key.threadId as ThreadId,
            () => {
              host.conversations.readEarlier(conversation);
            },
          ),
        );
      }
      return host;
    }),
  );
  const engineRowHolds = Atom.family((environmentId: string) =>
    Atom.make((get) => {
      const host = get(mateEngineHostAtom);
      if (host !== null) get.addFinalizer(host.conversations.holdRows(environmentId));
      return host;
    }),
  );
  const shell = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      const store = get(holders(JSON.stringify({ environmentId })));
      if (store === null)
        return AsyncResult.initial<import("./mateShellReplay.ts").EnvironmentShellState, E>(true);
      const v1 = get(store.data.project(mateShell, { environmentId }));
      if (routeOf(get, environmentId).kind !== "engine") return AsyncResult.success(v1);
      const host = get(engineRowHolds(environmentId));
      return AsyncResult.success(
        host === null
          ? v1
          : overlayEngineShell(
              v1,
              get(host.store.data.project(engineRows, environmentId)),
              get(host.store.data.project(engineHeldTurns, environmentId)),
            ),
      );
    }),
  );
  const thread = Atom.family((encoded: string) =>
    Atom.make((get) => {
      const key = JSON.parse(encoded) as ConversationKey;
      const route = routeOf(get, key.environmentId);
      type State = import("../../state/threadState.ts").EnvironmentThreadState;
      switch (route.kind) {
        case "update":
          return AsyncResult.success<State>({
            ...EMPTY_ENVIRONMENT_THREAD_STATE,
            error: Option.some(ENGINE_UPDATE_WORDS),
          });
        case "engine": {
          const host = get(engineHolds(encoded));
          return host === null || key.threadId === undefined
            ? AsyncResult.initial<State, E>(true)
            : AsyncResult.success<State>(
                get(
                  host.store.data.project(engineThread, {
                    environmentId: key.environmentId,
                    conversationId: key.threadId,
                  }),
                ),
              );
        }
        case "unknown":
        case "v1": {
          // V1 until the door says otherwise: its cached paint and its access words at once.
          const store = get(holders(encoded));
          return store === null
            ? AsyncResult.initial<State, E>(true)
            : AsyncResult.success(get(store.data.project(mateThread, key)));
        }
      }
    }),
  );
  return {
    shellStateAtom: shell,
    threadStateAtom: (environmentId: EnvironmentId, threadId: ThreadId) =>
      thread(JSON.stringify({ environmentId, threadId })),
  };
}
