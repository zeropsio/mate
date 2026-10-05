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
import { STREAM_POLICY, type StreamEvent, type StreamFault } from "./streamMachine.ts";

export type LinkSignal = "manual-retry" | "input-changed";

export interface LinkSupervisor {
  /** Runs for as long as the link is demanded; interrupting it ends the demand. */
  readonly run: Effect.Effect<never>;
  /** The person's "try now", or a changed input a refusal was decided over. */
  readonly signal: (signal: LinkSignal) => Effect.Effect<void>;
}

export interface LinkOptions {
  readonly key: LinkKey;
  readonly scopes: ReadonlyArray<ScopeKey>;
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
    const signals = yield* Queue.unbounded<LinkSignal>();

    const dispatch = (event: StreamEvent, target: LinkKey | ScopeKey = key) =>
      Effect.map(Clock.currentTimeMillis, (now) =>
        store.dispatch({ kind: "stream", key: target, now, event }),
      );

    /**
     * Fails once a named deadline passes in the phase that named it: the link's for this attempt,
     * or any scope's while it waits on its handshake or baseline. A scope's generation is its own,
     * so for a scope only the waiting state counts. Ending the attempt re-registers every scope.
     */
    const watch = (
      target: LinkKey | ScopeKey,
      generation: number | null,
    ): Effect.Effect<never, Deadline> =>
      Effect.gen(function* () {
        while (true) {
          const { next, phase, generation: current } = streamOf(store.state(), target);
          const waiting = next.kind === "await-handshake" || next.kind === "await-baseline";
          // The link's watch ends once this attempt stops waiting; a scope's once it is live.
          if (generation !== null && (current !== generation || !waiting))
            return yield* Effect.never;
          if (phase === "live") return yield* Effect.never;
          const now = yield* Clock.currentTimeMillis;
          if (waiting && now >= next.deadlineAt) return yield* Effect.fail({ deadline: target });
          // A scope not begun yet is looked at again within the time its handshake may take.
          yield* Effect.sleep(waiting ? next.deadlineAt - now : STREAM_POLICY.handshakeTimeoutMs);
        }
      });
    const deadlines = (generation: number): Effect.Effect<never, Deadline> =>
      Effect.raceAllFirst([watch(key, generation), ...scopes.map((scope) => watch(scope, null))]);

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
            for (const scope of scopes) yield* dispatch({ kind: "parent-lost" }, scope);
            // The link's own deadline is its machine's; a scope's ends the link's attempt.
            return yield* ended.deadline === key
              ? dispatch({ kind: "deadline" })
              : dispatch({
                  kind: "fault",
                  fault: { outcome: "transient", message: `No answer for ${ended.deadline}.` },
                  jitter: yield* Random.next,
                });
          }
          const jitter = yield* Random.next;
          // A refusal of the link is its scopes' refusal too; any other end leaves them waiting.
          const refused =
            ended.outcome === "definitive-refusal" || ended.outcome === "authoritative-denial";
          for (const scope of scopes)
            yield* dispatch(
              refused ? { kind: "fault", fault: ended, jitter } : { kind: "parent-lost" },
              scope,
            );
          return yield* dispatch({ kind: "fault", fault: ended, jitter });
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
        for (const scope of scopes) yield* dispatch({ kind: "demand", demanded }, scope);
        return yield* dispatch({ kind: "demand", demanded });
      });

    const run = Effect.gen(function* () {
      let directives = yield* demand(true);
      while (true) directives = yield* step(directives);
    }).pipe(Effect.onInterrupt(() => demand(false)));

    return {
      run,
      // The person's try-now, or a changed input, is the scopes' too: a refused scope revives only
      // by it, never by its link's own attempts.
      signal: (signal) =>
        Effect.gen(function* () {
          for (const scope of scopes) yield* dispatch({ kind: signal }, scope);
          yield* Queue.offer(signals, signal);
        }),
    };
  });
