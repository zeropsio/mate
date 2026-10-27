import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

/** Observes the next completed unit of work, without owning its scheduling or outcome. */
export function completionReceipt() {
  let next = Deferred.makeUnsafe<void>();
  return {
    next: () => Deferred.await(next),
    complete: Effect.sync(() => {
      const completed = next;
      next = Deferred.makeUnsafe<void>();
      Deferred.doneUnsafe(completed, Effect.void);
    }),
  };
}
