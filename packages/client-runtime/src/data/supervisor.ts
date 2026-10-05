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
import type { StreamEvent, StreamFault } from "./streamMachine.ts";

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

const DEADLINE = { deadline: true } as const;

export const superviseLink = (options: LinkOptions): Effect.Effect<LinkSupervisor> =>
  Effect.gen(function* () {
    const { key, scopes, store } = options;
    const signals = yield* Queue.unbounded<LinkSignal>();

    const dispatch = (event: StreamEvent, target: LinkKey | ScopeKey = key) =>
      Effect.map(Clock.currentTimeMillis, (now) =>
        store.dispatch({ kind: "stream", key: target, now, event }),
      );

    /** Fails once the attempt's named deadline passes in the phase that named it. */
    const deadlines = (generation: number): Effect.Effect<never, typeof DEADLINE> =>
      Effect.gen(function* () {
        while (true) {
          const { next, generation: current } = streamOf(store.state(), key);
          if (
            current !== generation ||
            (next.kind !== "await-handshake" && next.kind !== "await-baseline")
          )
            return yield* Effect.never;
          const now = yield* Clock.currentTimeMillis;
          if (now >= next.deadlineAt) return yield* Effect.fail(DEADLINE);
          yield* Effect.sleep(next.deadlineAt - now);
        }
      });

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
          for (const scope of scopes) yield* dispatch({ kind: "parent-lost" }, scope);
          if ("deadline" in ended) return yield* dispatch({ kind: "deadline" });
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

    const run = Effect.gen(function* () {
      let directives = yield* dispatch({ kind: "demand", demanded: true });
      while (true) directives = yield* step(directives);
    }).pipe(Effect.onInterrupt(() => dispatch({ kind: "demand", demanded: false })));

    return {
      run,
      signal: (signal) => Effect.asVoid(Queue.offer(signals, signal)),
    };
  });
