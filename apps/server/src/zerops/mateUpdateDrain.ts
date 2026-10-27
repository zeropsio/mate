import type { UpdateIdleFacts } from "../update/MateUpdateDrain.ts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { MATE_UPDATE_DRAIN_MINUTES } from "@t3tools/shared/mateAutoUpdatePolicy";

export const MATE_UPDATE_DRAIN_DEADLINE = Duration.minutes(MATE_UPDATE_DRAIN_MINUTES);

/**
 * How long a Mate stays quiet after its last turn before an automatic update may restart it: the
 * person reads the answer, and may answer it, before the Mate goes away for its update.
 */
export const MATE_UPDATE_QUIET = Duration.minutes(1);

/** What an automatic update waits on before it closes admission. */
export interface UpdateQuietFacts extends UpdateIdleFacts {
  /** When the Mate's last turn ended (epoch ms); absent when it has had none. */
  readonly lastTurnEndedAt: number | undefined;
}

/** How long, from `now`, until the Mate has been quiet for `quietMs`: 0 once it has. */
export function quietWaitMs(input: {
  readonly lastTurnEndedAt: number | undefined;
  readonly refusedAt: number | undefined;
  readonly now: number;
  readonly quietMs: number;
}): number {
  const since = Math.max(input.lastTurnEndedAt ?? -Infinity, input.refusedAt ?? -Infinity);
  return Math.max(0, since + input.quietMs - input.now);
}

export interface DrainPorts {
  readonly allowed: Effect.Effect<boolean>;
  readonly begin: Effect.Effect<void>;
  readonly cancel: Effect.Effect<void>;
  readonly facts: Effect.Effect<UpdateIdleFacts>;
  readonly quiesce: Effect.Effect<UpdateIdleFacts>;
  readonly changed: Effect.Effect<void>;
  /**
   * An automatic update's wait, with admission still open, for the Mate to be idle and quiet for
   * {@link MATE_UPDATE_QUIET} past its last turn: an answer is never followed straight away by a
   * restart. Absent for an update the person asked for, which closes admission at once.
   */
  readonly quiet?: Effect.Effect<UpdateQuietFacts>;
}

/** Time limits the wait; only committed engine and process evidence can prove idle. */
export function drainMateUpdate(
  ports: DrainPorts,
  deadline: Duration.Input = MATE_UPDATE_DRAIN_DEADLINE,
  quiet: Duration.Input = MATE_UPDATE_QUIET,
): Effect.Effect<boolean> {
  let drained = false;
  // What the drain last waited on: a refused drain names it in the runtime log.
  let waitingOn = "";
  const waitOn = (facts: UpdateIdleFacts) =>
    Effect.suspend(() => {
      const words = facts.blockers.join("; ");
      if (words === waitingOn) return Effect.void;
      waitingOn = words;
      return Effect.logInfo(`mate update: waiting on ${words}`);
    });
  const quietMs = Duration.toMillis(quiet);
  // When admission last closed onto work: the quiet wait starts over from there.
  let refusedAt: number | undefined;
  /** Waits, admission open, until the Mate is idle and quiet; false when the policy says no. */
  const awaitQuiet = (facts: Effect.Effect<UpdateQuietFacts>) =>
    Effect.gen(function* () {
      while (true) {
        if (!(yield* ports.allowed)) return false;
        const now = yield* Clock.currentTimeMillis;
        const read = yield* facts;
        if (!read.idle) {
          yield* waitOn(read);
          yield* ports.changed;
          continue;
        }
        const wait = quietWaitMs({
          lastTurnEndedAt: read.lastTurnEndedAt,
          refusedAt,
          now,
          quietMs,
        });
        if (wait === 0) return true;
        yield* waitOn({ idle: false, blockers: ["a quiet minute after the last turn"] });
        // A timed wake: nothing else may happen before the minute is up.
        yield* Effect.raceFirst(ports.changed, Effect.sleep(Duration.millis(wait)));
      }
    });
  return Effect.gen(function* () {
    const wait = Effect.gen(function* () {
      while (true) {
        if (ports.quiet !== undefined && !(yield* awaitQuiet(ports.quiet))) return false;
        if (!(yield* ports.allowed)) return false;
        yield* ports.begin;
        while (true) {
          if (!(yield* ports.allowed)) return false;
          const facts = yield* ports.facts;
          if (facts.idle) {
            const settled = yield* ports.quiesce;
            if (settled.idle && (yield* ports.allowed)) return true;
            yield* waitOn(settled);
          } else yield* waitOn(facts);
          if (ports.quiet !== undefined) {
            // Work began as admission closed: reopen it, and wait for quiet again.
            yield* ports.cancel;
            refusedAt = yield* Clock.currentTimeMillis;
            break;
          }
          yield* ports.changed;
        }
      }
    });
    const result = yield* wait.pipe(Effect.timeoutOption(deadline));
    drained = Option.isSome(result) && result.value;
    if (Option.isNone(result))
      yield* Effect.logInfo(`mate update: not idle before the drain deadline: ${waitingOn}`);
    return drained;
  }).pipe(Effect.ensuring(Effect.suspend(() => (drained ? Effect.void : ports.cancel))));
}

/** Every owner must affirm idle, including the completed native-close receipt. */
export function joinUpdateIdleFacts(...facts: ReadonlyArray<UpdateIdleFacts>): UpdateIdleFacts {
  return {
    idle: facts.every((fact) => fact.idle),
    blockers: facts.flatMap((fact) => fact.blockers),
  };
}
