import type { UpdateIdleFacts } from "../update/MateUpdateDrain.ts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export const MATE_UPDATE_DRAIN_DEADLINE = Duration.minutes(10);

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
        }
        yield* ports.changed;
      }
    });
    const result = yield* wait.pipe(Effect.timeoutOption(deadline));
    drained = Option.isSome(result) && result.value;
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
