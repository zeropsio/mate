import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/**
 * Lanes that run effects one at a time per key, in the order they asked: a
 * thread's sends reach the agent in the order they were sent, however long
 * one of them waits for its files. A key's lane goes with its last user.
 */
export function makeSendLanes() {
  const lanes = new Map<string, { readonly semaphore: Semaphore.Semaphore; users: number }>();
  return <A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const lane = lanes.get(key) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 };
      lanes.set(key, lane);
      lane.users += 1;
      return lane.semaphore
        .withPermits(1)(effect)
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              lane.users -= 1;
              if (lane.users === 0 && lanes.get(key) === lane) lanes.delete(key);
            }),
          ),
        );
    });
}
