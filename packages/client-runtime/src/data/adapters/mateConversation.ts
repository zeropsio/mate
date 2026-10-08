/** Reuses ordered snapshot/replay and paging; only the account reducer retains source values. */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/reactivity";
import { EnvironmentRegistry } from "../../connection/registry.ts";
import type { EnvironmentCacheStore } from "../../platform/persistence.ts";
import { followStreamInEnvironment } from "../../state/runtime.ts";
import type { ShellSnapshotLoader } from "../../state/shellSnapshotHttp.ts";
import type { ThreadSnapshotLoader } from "../../state/threadSnapshotHttp.ts";
import { openShellReplay } from "./mateShellReplay.ts";
import { openThreadReplay, type ThreadResumeCache } from "./mateThreadReplay.ts";
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
            Stream.unwrap(
              openThreadReplay(key.threadId as ThreadId, resume, true).pipe(
                Effect.map(SubscriptionRef.changes),
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
  const shell = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      const store = get(holders(JSON.stringify({ environmentId })));
      return store === null
        ? AsyncResult.initial<import("./mateShellReplay.ts").EnvironmentShellState, E>(true)
        : AsyncResult.success(get(store.data.project(mateShell, { environmentId })));
    }),
  );
  const thread = Atom.family((encoded: string) =>
    Atom.make((get) => {
      const key = JSON.parse(encoded) as ConversationKey;
      const store = get(holders(encoded));
      return store === null
        ? AsyncResult.initial<import("../../state/threadState.ts").EnvironmentThreadState, E>(true)
        : AsyncResult.success(get(store.data.project(mateThread, key)));
    }),
  );
  return {
    shellStateAtom: shell,
    threadStateAtom: (environmentId: EnvironmentId, threadId: ThreadId) =>
      thread(JSON.stringify({ environmentId, threadId })),
  };
}
