/**
 * A Mate engine conversation's subscription (`subscribeEngineConversation`) into the account: its
 * window snapshot, then each commit's changes, delivered atomically across the header, runs, items
 * and requests; streamed text into the live registry, never the store. A cursor per conversation
 * (`{epoch, origin, seq}`) resumes it after a drop or a release; a gap resubscribes from it; a
 * reset, another sequence space or an epoch from the past forget what was held first. The last
 * release keeps the conversation for {@link ENGINE_FORGET_AFTER_MS}; then it is forgotten. An
 * authoritative denial forgets it at once.
 *
 * @module data/adapters/mateEngine
 */
import {
  EnvironmentAuthorizationError,
  MATE_ENGINE_PROTOCOLS,
  WS_METHODS,
  type ConversationHeader,
  type EngineConversationFrame,
  type EnvironmentId,
  type EngineCursor,
  type EngineRowsFrame,
  type Item,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import type { RpcSession } from "../../rpc/session.ts";

import type { EngineLiveText } from "../engineLive.ts";
import {
  engineConversationId,
  engineConversationLink,
  engineConversationScopes,
  engineFactId,
  engineRowsLink,
  engineRowsScope,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import type { FamilyValues, LinkKey, Revision, ScopeKey } from "../model.ts";
import { streamOf, type Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";

/** How long a released conversation is kept, so a return resumes instead of reading it again. */
export const ENGINE_FORGET_AFTER_MS = 5 * 60 * 1_000;

/** The engine's wire as this adapter reads it; the transport and its session are the wire's. */
export interface EngineConversationWire {
  readonly subscribe: (
    key: EngineConversationKey,
    after: EngineCursor | null,
  ) => Stream.Stream<EngineConversationFrame, StreamFault>;
  readonly subscribeRows: (environmentId: string) => Stream.Stream<EngineRowsFrame, StreamFault>;
  /** The Mate's access as its connection learns it: a fault, or `null` once verified again. */
  readonly watch?: (
    environmentId: string,
    receive: (fault: StreamFault | null) => void,
  ) => Effect.Effect<void>;
}

const isAuthorization = Schema.is(EnvironmentAuthorizationError);

/** A failure of the wire's call, classified: the account's rules decide what follows. */
export function classifyEngineFailure(cause: Cause.Cause<unknown>): StreamFault {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) {
    const value = error.value;
    if (typeof value === "object" && value !== null && "outcome" in value)
      return value as StreamFault;
    if (isAuthorization(value)) return { outcome: "authoritative-denial", message: value.message };
  }
  const squashed = Cause.squash(cause);
  return {
    outcome: "transient",
    message: squashed instanceof Error ? squashed.message : String(squashed),
  };
}

/** The refusal an `unserved` frame is: the update route, or a Mate whose conversation is on V1. */
export const unservedFault = (unserved: {
  readonly reason: string;
  readonly message: string;
}): StreamFault => ({
  outcome: "definitive-refusal",
  code: unserved.reason === "protocol" ? "update" : "not-on-engine",
  message: unserved.message,
});

/** The highest protocol this build and the Mate both speak; `null` when they share none. */
export function engineProtocol(served: ReadonlyArray<number> | number | undefined): number | null {
  const theirs = typeof served === "number" ? [served] : (served ?? []);
  const shared = MATE_ENGINE_PROTOCOLS.filter((protocol) => theirs.includes(protocol));
  return shared.length === 0 ? null : Math.max(...shared);
}

const PROTOCOL = Math.max(...MATE_ENGINE_PROTOCOLS);

/** The engine's wire over the Mate's own socket: each call on its current session. */
export function makeEngineConversationWire(
  registry: EnvironmentRegistry["Service"],
): EngineConversationWire {
  const onSession = <A, E>(
    environmentId: string,
    open: (client: RpcSession["client"]) => Stream.Stream<A, E>,
  ): Stream.Stream<A, StreamFault> =>
    registry
      .followStream(
        environmentId as EnvironmentId,
        Stream.unwrap(
          Effect.map(EnvironmentSupervisor, (supervisor) =>
            SubscriptionRef.changes(supervisor.session).pipe(
              Stream.filter(Option.isSome),
              Stream.take(1),
              Stream.flatMap((session) => open(session.value.client)),
            ),
          ),
        ),
      )
      .pipe(Stream.catchCause((cause) => Stream.fail(classifyEngineFailure(cause))));
  return {
    subscribe: (key, after) =>
      onSession(key.environmentId, (client) =>
        client[WS_METHODS.subscribeEngineConversation]({
          protocol: PROTOCOL,
          conversationId: key.conversationId as never,
          ...(after === null ? {} : { after }),
        }),
      ),
    subscribeRows: (environmentId) =>
      onSession(environmentId, (client) =>
        client[WS_METHODS.subscribeEngineRows]({ protocol: PROTOCOL }),
      ),
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
  };
}

const RESUBSCRIBE = Symbol("resubscribe");
type Resubscribe = typeof RESUBSCRIBE;

type Records = Extract<EngineConversationFrame, { type: "changes" }>;

type Window = Extract<EngineConversationFrame, { type: "snapshot" }>["window"];

/** A frame's records as rows: each stamped with the epoch it was served in and its own `rev`. */
function rowsOf(
  key: EngineConversationKey,
  epoch: number,
  frame: Pick<Records, "runs" | "items" | "requests"> & {
    readonly header?: Records["header"];
    readonly head: number;
  },
  window: Window | undefined,
): ReadonlyArray<Row> {
  const { environmentId } = key;
  const revision = (seq: number): Revision => ({
    kind: "mate-conversation",
    environmentId,
    epoch,
    seq,
  });
  const rows: Row[] = [];
  if (frame.header !== undefined && window !== undefined)
    rows.push({
      family: "mateEngineConversation",
      id: engineConversationId(key),
      value: { environmentId, header: frame.header, window },
      revision: revision(frame.head),
    });
  for (const run of frame.runs)
    rows.push({
      family: "mateEngineRun",
      id: engineFactId(environmentId, run.id),
      value: { ...run, environmentId },
      revision: revision(run.rev),
    });
  for (const item of frame.items)
    rows.push({
      family: "mateEngineItem",
      id: engineFactId(environmentId, item.id),
      value: { ...item, environmentId },
      revision: revision(item.rev),
    });
  for (const request of frame.requests)
    rows.push({
      family: "mateEngineRequest",
      id: engineFactId(environmentId, request.id),
      value: { ...request, environmentId },
      revision: revision(request.rev),
    });
  return rows;
}

interface Held {
  count: number;
  stop: () => void;
  retry: () => void;
  recover: () => void;
  fault: (fault: StreamFault) => void;
}

/**
 * One held link: its supervisor runs while any holder holds it; the last release starts `grace`,
 * after which `expire` runs; a hold inside it cancels it.
 */
function makeLinks(options: {
  readonly store: AccountStore;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}) {
  const held = new Map<LinkKey, Held>();
  const expiring = new Map<LinkKey, unknown>();
  let closed = false;
  const hold = (
    link: LinkKey,
    scopes: ReadonlyArray<ScopeKey>,
    attempt: () => Effect.Effect<never, StreamFault>,
    release: { readonly graceMs: number; readonly expire: () => void } | null,
  ) => {
    if (closed) return () => {};
    const timer = expiring.get(link);
    if (timer !== undefined) {
      options.clearTimer(timer);
      expiring.delete(link);
    }
    let entry = held.get(link);
    if (entry === undefined) {
      // A fault told to the attempt under way ends it; told with none under way, it is the next
      // attempt's own check (the Mate's access) that decides, never a stale fault.
      let current: Deferred.Deferred<never, StreamFault> | null = null;
      const supervisor = Effect.runSync(
        superviseLink({
          key: link,
          scopes,
          store: options.store,
          attempt: () =>
            Effect.gen(function* () {
              const told = yield* Deferred.make<never, StreamFault>();
              current = told;
              return yield* Effect.raceFirst(attempt(), Deferred.await(told));
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  current = null;
                }),
              ),
            ),
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
        retry: () => void Effect.runFork(supervisor.signal("manual-retry")),
        recover: () => void Effect.runFork(supervisor.signal("input-changed")),
        fault: (fault) => {
          if (current !== null) Deferred.doneUnsafe(current, Exit.fail(fault));
        },
      };
      held.set(link, entry);
    }
    const active = entry;
    active.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--active.count > 0) return;
      active.stop();
      held.delete(link);
      if (release === null || closed) return;
      expiring.set(
        link,
        options.setTimer(() => {
          expiring.delete(link);
          if (!closed && !held.has(link)) release.expire();
        }, release.graceMs),
      );
    };
  };
  return {
    hold,
    held: (link: LinkKey) => held.get(link),
    close: () => {
      closed = true;
      for (const entry of held.values()) entry.stop();
      held.clear();
      for (const timer of expiring.values()) options.clearTimer(timer);
      expiring.clear();
    },
  };
}

export function makeMateEngineConversations(options: {
  readonly store: AccountStore;
  readonly wire: EngineConversationWire;
  readonly live: EngineLiveText;
  readonly forgetAfterMs?: number;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}) {
  const { store, wire, live } = options;
  const links = makeLinks(options);
  const cursors = new Map<string, EngineCursor>();
  /** Every conversation held or kept, by environment: whom a denial forgets. */
  const known = new Map<string, Map<string, EngineConversationKey>>();
  const watches = new Map<string, Fiber.Fiber<void>>();
  const withheld = new Map<string, StreamFault>();
  let closed = false;

  const now = () => Effect.runSync(Clock.currentTimeMillis);
  const signal = (key: LinkKey | ScopeKey, event: StreamEvent) =>
    store.dispatch({ kind: "stream", key, now: now(), event });

  const forget = (key: EngineConversationKey) => {
    cursors.delete(engineConversationId(key));
    live.forget(key);
    store.dispatch({ kind: "forget", scopes: Object.values(engineConversationScopes(key)) });
  };

  const receiveAccess = (environmentId: string, fault: StreamFault | null) => {
    if (closed) return;
    const conversations = [...(known.get(environmentId)?.values() ?? [])];
    if (fault === null) {
      if (!withheld.delete(environmentId)) return;
      for (const key of conversations) links.held(engineConversationLink(key))?.retry();
      return;
    }
    withheld.set(environmentId, fault);
    for (const key of conversations) {
      if (fault.outcome === "authoritative-denial") forget(key);
      links.held(engineConversationLink(key))?.fault(fault);
    }
  };

  const attempt = (key: EngineConversationKey) =>
    Effect.gen(function* () {
      const access = withheld.get(key.environmentId);
      if (access !== undefined) return yield* Effect.fail(access);
      const link = engineConversationLink(key);
      const scopes = Object.values(engineConversationScopes(key));
      const id = engineConversationId(key);
      for (;;) {
        signal(link, { kind: "handshake" });
        for (const scope of scopes) {
          signal(scope, { kind: "attempt" });
          signal(scope, { kind: "handshake" });
        }
        const generations = scopes.map((scope) => ({
          scope,
          generation: streamOf(store.state(), scope).generation,
        }));
        /** The header of a split commit's first part, until the part that moves the cursor. */
        let splitHeader: { readonly from: number; readonly header: ConversationHeader } | undefined;
        /** An item whose record arrives whole drops its streamed text, settle frame or not. */
        const settleClosed = (items: ReadonlyArray<Item>) => {
          for (const item of items)
            if (
              ((item.kind === "note" || item.kind === "thought") && !item.streaming) ||
              (item.kind === "call" && item.state !== "running")
            )
              live.settle(key, item.id);
        };
        const deliver = (rows: ReadonlyArray<Row>, reset: boolean) =>
          store.dispatch({
            kind: "delivery",
            via: "mate-direct",
            scopes: generations,
            reset,
            ...(reset ? { partial: true } : {}),
            rows,
            removals: [],
          });
        const handle = (
          frame: EngineConversationFrame,
        ): Effect.Effect<void, StreamFault | Resubscribe> =>
          Effect.suspend((): Effect.Effect<void, StreamFault | Resubscribe> => {
            if (closed) return Effect.void;
            // Denied or unverified: nothing more of it is taken, even a frame already on its way.
            const access = withheld.get(key.environmentId);
            if (access !== undefined) return Effect.fail(access);
            const cursor = cursors.get(id);
            switch (frame.type) {
              case "snapshot": {
                if (
                  cursor !== undefined &&
                  (cursor.origin !== frame.origin || frame.epoch < cursor.epoch)
                )
                  forget(key);
                Atom.batch(() => deliver(rowsOf(key, frame.epoch, frame, frame.window), true));
                settleClosed(frame.items);
                cursors.set(id, { epoch: frame.epoch, origin: frame.origin, seq: frame.head });
                return Effect.void;
              }
              case "changes": {
                if (cursor === undefined || frame.from !== cursor.seq)
                  return Effect.fail(RESUBSCRIBE);
                const held = store.state().facts.get(`mateEngineConversation:${id}`)?.content;
                const window =
                  held?.kind === "value"
                    ? (held.value as FamilyValues["mateEngineConversation"]).window
                    : undefined;
                // A split commit's parts share `from`; all but the last say `to = from`, and only the
                // first carries the header. Its sequence is the commit's, so it is held until the
                // part that moves the cursor names it.
                const header =
                  frame.to === frame.from
                    ? undefined
                    : (frame.header ??
                      (splitHeader?.from === frame.from ? splitHeader.header : undefined));
                splitHeader =
                  frame.to === frame.from && frame.header !== undefined
                    ? { from: frame.from, header: frame.header }
                    : frame.to === frame.from
                      ? splitHeader
                      : undefined;
                Atom.batch(() =>
                  deliver(
                    rowsOf(
                      key,
                      frame.epoch,
                      {
                        runs: frame.runs,
                        items: frame.items,
                        requests: frame.requests,
                        head: frame.to,
                        ...(header === undefined ? {} : { header }),
                      },
                      window,
                    ),
                    false,
                  ),
                );
                settleClosed(frame.items);
                cursors.set(id, { ...cursor, epoch: frame.epoch, seq: frame.to });
                return Effect.void;
              }
              case "synchronized": {
                if (cursor === undefined) return Effect.fail(RESUBSCRIBE);
                // A header that came alone (a restart's epoch, nothing newer) is the head's.
                if (splitHeader !== undefined) {
                  const pending = splitHeader.header;
                  splitHeader = undefined;
                  const held = store.state().facts.get(`mateEngineConversation:${id}`)?.content;
                  const window =
                    held?.kind === "value"
                      ? (held.value as FamilyValues["mateEngineConversation"]).window
                      : undefined;
                  deliver(
                    rowsOf(
                      key,
                      frame.epoch,
                      { runs: [], items: [], requests: [], head: frame.head, header: pending },
                      window,
                    ),
                    false,
                  );
                }
                cursors.set(id, { ...cursor, epoch: frame.epoch, seq: frame.head });
                Atom.batch(() => {
                  for (const scope of scopes) signal(scope, { kind: "baseline-committed" });
                  signal(link, { kind: "baseline-committed" });
                });
                return Effect.void;
              }
              case "reset":
                forget(key);
                return Effect.void;
              case "live.open":
                live.open(key, frame.itemId, frame.stream, frame.text);
                return Effect.void;
              case "live.append":
                live.append(key, frame.itemId, frame.stream, frame.offset, frame.text);
                return Effect.void;
              case "live.settle":
                live.settle(key, frame.itemId);
                return Effect.void;
              case "unserved":
                return Effect.fail(unservedFault(frame));
              default:
                // progress, context and frames of a newer build: nothing this build draws yet.
                return Effect.void;
            }
          });
        const ended = yield* Stream.runForEach(
          wire.subscribe(key, cursors.get(id) ?? null),
          handle,
        ).pipe(
          Effect.as("ended" as const),
          Effect.catch((error) =>
            error === RESUBSCRIBE ? Effect.succeed("resubscribe" as const) : Effect.fail(error),
          ),
        );
        if (ended === "resubscribe") continue;
        return yield* Effect.fail<StreamFault>({
          outcome: "transient",
          message: "The conversation's subscription ended.",
        });
      }
    }).pipe(
      Effect.tapError((fault) =>
        Effect.sync(() => {
          if (!closed && fault.outcome === "authoritative-denial") forget(key);
        }),
      ),
    );

  const watchAccess = (environmentId: string) => {
    if (watches.has(environmentId) || wire.watch === undefined) return;
    watches.set(
      environmentId,
      Effect.runFork(wire.watch(environmentId, (fault) => receiveAccess(environmentId, fault))),
    );
  };

  return {
    /** Holds the conversation while drawn; the returned release lets it go. */
    hold(key: EngineConversationKey): () => void {
      if (closed) return () => {};
      const byEnvironment = known.get(key.environmentId) ?? new Map();
      byEnvironment.set(engineConversationId(key), key);
      known.set(key.environmentId, byEnvironment);
      watchAccess(key.environmentId);
      const link = engineConversationLink(key);
      const fault = streamOf(store.state(), link).fault;
      const refusedForAccess =
        !withheld.has(key.environmentId) &&
        !links.held(link) &&
        (fault?.outcome === "access-unverified" || fault?.outcome === "authoritative-denial");
      const release = links.hold(
        link,
        Object.values(engineConversationScopes(key)),
        () => attempt(key) as Effect.Effect<never, StreamFault>,
        {
          graceMs: options.forgetAfterMs ?? ENGINE_FORGET_AFTER_MS,
          expire: () => {
            known.get(key.environmentId)?.delete(engineConversationId(key));
            forget(key);
          },
        },
      );
      // Refused for its Mate's access, held again after that access came back: it tries anew.
      if (refusedForAccess) links.held(link)?.recover();
      return release;
    },
    retry(key: EngineConversationKey) {
      links.held(engineConversationLink(key))?.retry();
    },
    /** Holds a Mate's conversation rows (its menu) while drawn. */
    holdRows(environmentId: string): () => void {
      if (closed) return () => {};
      watchAccess(environmentId);
      const link = engineRowsLink(environmentId);
      const scope = engineRowsScope(environmentId);
      return links.hold(
        link,
        [scope],
        () =>
          Effect.gen(function* () {
            const access = withheld.get(environmentId);
            if (access !== undefined) return yield* Effect.fail(access);
            signal(link, { kind: "handshake" });
            signal(scope, { kind: "attempt" });
            signal(scope, { kind: "handshake" });
            const generation = streamOf(store.state(), scope).generation;
            yield* Stream.runForEach(wire.subscribeRows(environmentId), (frame) =>
              Effect.suspend(() => {
                if (closed) return Effect.void;
                const deliver = (rows: EngineRowsFrame & { type: "snapshot" | "row" }) => {
                  const list = rows.type === "snapshot" ? rows.rows : [rows.row];
                  store.dispatch({
                    kind: "delivery",
                    via: "mate-direct",
                    scopes: [{ scope, generation }],
                    reset: rows.type === "snapshot",
                    rows: list.map((row): Row => ({
                      family: "mateEngineRow",
                      id: engineFactId(environmentId, row.conversationId),
                      value: { ...row, environmentId },
                      revision: { kind: "mate-conversation", ...row.revision },
                    })),
                    removals: [],
                  });
                };
                switch (frame.type) {
                  case "snapshot":
                  case "row":
                    deliver(frame);
                    return Effect.void;
                  case "synchronized":
                    signal(scope, { kind: "baseline-committed" });
                    signal(link, { kind: "baseline-committed" });
                    return Effect.void;
                  case "unserved":
                    return Effect.fail(unservedFault(frame));
                  default:
                    return Effect.void;
                }
              }),
            );
            return yield* Effect.fail<StreamFault>({
              outcome: "transient",
              message: "The conversation rows' subscription ended.",
            });
          }),
        null,
      );
    },
    /** Where a conversation's subscription stands: for its operations and tests. */
    cursor: (key: EngineConversationKey) => cursors.get(engineConversationId(key)) ?? null,
    close() {
      closed = true;
      links.close();
      for (const fiber of watches.values()) void Effect.runFork(Fiber.interrupt(fiber));
      watches.clear();
      cursors.clear();
      known.clear();
    },
  };
}
