import type { UpdateIdleFacts } from "../update/MateUpdateDrain.ts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { MATE_UPDATE_DRAIN_MINUTES } from "@t3tools/shared/mateAutoUpdatePolicy";

export const MATE_UPDATE_DRAIN_DEADLINE = Duration.minutes(MATE_UPDATE_DRAIN_MINUTES);

export interface DrainPorts {
  readonly allowed: Effect.Effect<boolean>;
  readonly begin: Effect.Effect<void>;
  readonly cancel: Effect.Effect<void>;
  readonly facts: Effect.Effect<UpdateIdleFacts>;
  readonly quiesce: Effect.Effect<UpdateIdleFacts>;
  readonly changed: Effect.Effect<void>;
}

/** Time limits the wait; only committed engine and process evidence can prove idle. */
export function drainMateUpdate(
  ports: DrainPorts,
  deadline: Duration.Input = MATE_UPDATE_DRAIN_DEADLINE,
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
  return Effect.gen(function* () {
    if (!(yield* ports.allowed)) return false;
    yield* ports.begin;
    const wait = Effect.gen(function* () {
      while (true) {
        if (!(yield* ports.allowed)) return false;
        const facts = yield* ports.facts;
        if (facts.idle) {
          const settled = yield* ports.quiesce;
          if (settled.idle && (yield* ports.allowed)) return true;
          yield* waitOn(settled);
        } else yield* waitOn(facts);
        yield* ports.changed;
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
