/** A replay's consumer receipt: the predicate runs after the event has been collected. */
import type { SpiEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export const collectReplay = Effect.fnUntraced(function* (
  stream: Stream.Stream<SpiEvent>,
  onEvent: (event: SpiEvent) => void = () => {},
) {
  const events: SpiEvent[] = [];
  const listeners = new Set<() => void>();
  const fiber = yield* Stream.runForEach(stream, (event) =>
    Effect.sync(() => {
      events.push(event);
      onEvent(event);
      for (const listener of listeners) listener();
    }),
  ).pipe(Effect.forkScoped({ startImmediately: true }));
  const waitFor = (complete: (events: ReadonlyArray<SpiEvent>) => boolean) =>
    Effect.gen(function* () {
      if (complete(events)) return;
      const done = yield* Deferred.make<void>();
      const check = () => {
        if (complete(events)) Deferred.doneUnsafe(done, Effect.void);
      };
      listeners.add(check);
      check();
      yield* Deferred.await(done).pipe(
        Effect.timeout("6 seconds"),
        Effect.orDie,
        Effect.ensuring(Effect.sync(() => listeners.delete(check))),
      );
    });
  return { events, fiber, waitFor };
});

/** ACP may publish the terminal event before closing its assistant item. */
export function completedTurn(events: ReadonlyArray<SpiEvent>): boolean {
  if (!events.some((event) => event.type === "turn.completed")) return false;
  return events
    .filter(
      (event) => event.type === "item.started" && event.payload.itemType === "assistant_message",
    )
    .every((item) =>
      events.some((event) => event.type === "item.completed" && event.itemId === item.itemId),
    );
}
