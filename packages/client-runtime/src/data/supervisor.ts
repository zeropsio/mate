/**
 * The one runtime loop behind every connection: it carries out what the stream machine directs —
 * open an attempt, repair the session once, wait for the named retry or for the person's "try
 * now" — and feeds every outcome back as a stream event. Adapters only open an attempt and
 * classify how it ended; when and whether to try again is decided here, by the machine alone.
 *
 * An attempt runs until it fails. While it is down, the link's scopes are stale: their facts stay.
 *
 * @module data/supervisor
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import type * as Scope from "effect/Scope";

import type { LinkKey, ScopeKey } from "./model.ts";
import { streamOf, type RuntimeDirective } from "./reducer.ts";
import type { AccountStore } from "./store.ts";
import {
  NO_ANSWER_IN_TIME,
  STREAM_POLICY,
  type StreamEvent,
  type StreamFault,
} from "./streamMachine.ts";

export type LinkSignal = "manual-retry" | "input-changed" | "resume";

export interface LinkSupervisor {
  /** Runs for as long as the link is demanded; interrupting it ends the demand. */
  readonly run: Effect.Effect<never>;
  /** The person's "try now", or a changed input a refusal was decided over. */
  readonly signal: (signal: LinkSignal) => Effect.Effect<void>;
  /**
   * Lets the link's demand go now, before its run is interrupted: the run's own end then lets
   * nothing go, so a link that takes over the same keys meanwhile keeps its demand.
   */
  readonly release: Effect.Effect<void>;
}

export interface LinkOptions {
  readonly key: LinkKey;
  readonly scopes: ReadonlyArray<ScopeKey>;
  /** The details screens demand now: children of the link like its scopes, held by demand. */
  readonly details?: () => ReadonlyArray<ScopeKey>;
  /**
   * Told when a child moved without the attempt hearing it — the person's signal reached it, or
   * its read passed its deadline: the attempt under way may read it again.
   */
  readonly childMoved?: () => void;
  readonly store: AccountStore;
  /** One attempt: open, register, deliver; it ends only by failing with its classified fault. */
  readonly attempt: (generation: number) => Effect.Effect<never, StreamFault, Scope.Scope>;
  readonly repairSession: Effect.Effect<void, StreamFault>;
}

/** A named deadline passed: the stream that named it. */
interface Deadline {
  readonly deadline: LinkKey | ScopeKey;
}

export const superviseLink = (options: LinkOptions): Effect.Effect<LinkSupervisor> =>
  Effect.gen(function* () {
    const { key, scopes, store } = options;
    /** Every child of the link now: its navigation scopes and the details demanded. */
    const children = () => [...scopes, ...(options.details?.() ?? [])];
    const signals = yield* Queue.sliding<LinkSignal>(1);

    /**
     * Every stream event goes through here. Whenever the link ends up refused — by a refusal, a
     * denial, or a session that could not be repaired — each scope is refused with the link's fault:
     * a scope never waits on a parent that will not come back by itself.
     */
    const dispatch = (event: StreamEvent, target: LinkKey | ScopeKey = key) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const before = streamOf(store.state(), key).phase;
        const directives = store.dispatch({ kind: "stream", key: target, now, event });
        const link = streamOf(store.state(), key);
        if (target === key && before !== "refused" && link.phase === "refused")
          for (const scope of children())
            store.dispatch({
              kind: "stream",
              key: scope,
              now,
              event: {
                kind: "fault",
                jitter: 0,
                fault: {
                  outcome: "definitive-refusal",
                  message: link.fault?.message ?? "The connection was refused.",
                },
              },
            });
        return directives;
      });

    /**
     * Fails once a named deadline passes in the phase that named it: the link's for this attempt,
     * or any scope's while it waits on its handshake or baseline. A scope's generation is its own,
     * so for a scope only the waiting state counts. Ending the attempt re-registers every scope.
     */
    const watch = (
      target: LinkKey | ScopeKey,
      generation: number | null,
    ): Effect.Effect<never, Deadline> =>
      Effect.scoped(
        Effect.gen(function* () {
          const changes = yield* Queue.sliding<void>(1);
          const stop = store.subscribe(() => Queue.offerUnsafe(changes, undefined));
          yield* Effect.addFinalizer(() => Effect.sync(stop));
          while (true) {
            const { next, generation: current } = streamOf(store.state(), target);
            const waiting = next.kind === "await-handshake" || next.kind === "await-baseline";
            // The link ends its initial wait once connected. A scope can baseline again on the
            // next segment, so keep watching its named deadlines until the attempt ends.
            if (generation !== null && (current !== generation || !waiting))
              return yield* Effect.never;
            const now = yield* Clock.currentTimeMillis;
            if (waiting && now >= next.deadlineAt) return yield* Effect.fail({ deadline: target });
            yield* waiting
              ? Effect.raceFirst(Queue.take(changes), Effect.sleep(next.deadlineAt - now))
              : Queue.take(changes);
          }
        }),
      );
    /**
     * The demanded details' deadlines, whichever are demanded now: a detail demanded during the
     * attempt is looked at within the time its handshake may take. A detail's read that passes its
     * deadline is that detail's to retry alone; the link's attempt goes on.
     */
    const watchDetails: Effect.Effect<never> = Effect.gen(function* () {
      while (true) {
        const now = yield* Clock.currentTimeMillis;
        let wake = now + STREAM_POLICY.handshakeTimeoutMs;
        for (const scope of options.details?.() ?? []) {
          const { next } = streamOf(store.state(), scope);
          if (next.kind !== "await-handshake" && next.kind !== "await-baseline") continue;
          if (now >= next.deadlineAt) {
            yield* dispatch({ kind: "deadline" }, scope);
            options.childMoved?.();
          } else wake = Math.min(wake, next.deadlineAt);
        }
        yield* Effect.sleep(wake - now);
      }
    });
    const deadlines = (generation: number): Effect.Effect<never, Deadline> =>
      Effect.raceAllFirst([
        watch(key, generation),
        ...scopes.map((scope) => watch(scope, null)),
        watchDetails,
      ]);

    const step = (
      directives: ReadonlyArray<RuntimeDirective>,
    ): Effect.Effect<ReadonlyArray<RuntimeDirective>> =>
      Effect.gen(function* () {
        const connect = directives.find((directive) => directive.kind === "connect");
        if (connect !== undefined && connect.kind === "connect") {
          const ended = yield* Effect.flip(
            Effect.scoped(
              Effect.raceFirst(options.attempt(connect.generation), deadlines(connect.generation)),
            ),
          );
          if ("deadline" in ended) {
            for (const scope of children()) yield* dispatch({ kind: "parent-lost" }, scope);
            // The link's own deadline is its machine's; a scope's ends the link's attempt.
            return yield* ended.deadline === key
              ? dispatch({ kind: "deadline" })
              : dispatch({
                  kind: "fault",
                  fault: { outcome: "transient", message: NO_ANSWER_IN_TIME },
                  jitter: yield* Random.next,
                });
          }
          // The scopes wait for the link's next attempt; if the link is refused, so are they.
          for (const scope of children()) yield* dispatch({ kind: "parent-lost" }, scope);
          return yield* dispatch({ kind: "fault", fault: ended, jitter: yield* Random.next });
        }
        if (directives.some((directive) => directive.kind === "repair-session")) {
          const repaired = yield* Effect.exit(options.repairSession);
          return yield* repaired._tag === "Success"
            ? dispatch({ kind: "session-repaired" })
            : dispatch({
                kind: "fault",
                fault:
                  repaired.cause.reasons[0]?._tag === "Fail"
                    ? repaired.cause.reasons[0].error
                    : { outcome: "transient", message: "The session repair died." },
                jitter: yield* Random.next,
              });
        }
        const { next } = streamOf(store.state(), key);
        if (next.kind === "retry") {
          const wait = Math.max(0, next.at - (yield* Clock.currentTimeMillis));
          const woken = yield* Effect.timeoutOrElse(Queue.take(signals), {
            duration: wait,
            orElse: () => Effect.succeed("retry-due" as const),
          });
          return yield* dispatch({ kind: woken });
        }
        return yield* dispatch({ kind: yield* Queue.take(signals) });
      });

    /** Demand moves the link and its scopes together: navigation scopes live as long as it. */
    const demand = (demanded: boolean) =>
      Effect.gen(function* () {
        // Navigation is demanded with the link; on its end, every child lets go.
        for (const scope of demanded ? scopes : children())
          yield* dispatch({ kind: "demand", demanded }, scope);
        return yield* dispatch({ kind: "demand", demanded });
      });

    let released = false;
    const release = Effect.suspend(() => {
      if (released) return Effect.void;
      released = true;
      return Effect.asVoid(demand(false));
    });
    const run = Effect.gen(function* () {
      let directives = yield* demand(true);
      while (true) directives = yield* step(directives);
    }).pipe(Effect.onInterrupt(() => release));

    return {
      run,
      release,
      // The person's try-now, or a changed input, is the scopes' too: a refused scope revives only
      // by it, never by its link's own attempts.
      signal: (signal) =>
        Effect.gen(function* () {
          if (
            signal === "resume" &&
            [key, ...children()].every(
              (target) => streamOf(store.state(), target).phase !== "recovering",
            )
          )
            return;
          for (const scope of children()) yield* dispatch({ kind: signal }, scope);
          options.childMoved?.();
          if (signal !== "resume" || streamOf(store.state(), key).phase === "recovering")
            yield* Queue.offer(signals, signal);
        }),
    };
  });
