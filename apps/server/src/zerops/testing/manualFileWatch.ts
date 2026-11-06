import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";

import type { FileWatch, WatchFiles } from "../fileWatch.ts";

/** A file watch a test fires itself: `change` wakes every watch armed at the time. */
export const manualFileWatch = Effect.gen(function* () {
  const changes = yield* PubSub.unbounded<void>();
  const watch: WatchFiles = Effect.map(PubSub.subscribe(changes), (subscription): FileWatch => ({
    next: Effect.asVoid(PubSub.takeAll(subscription)),
  }));
  return { watch, change: PubSub.publish(changes, undefined).pipe(Effect.asVoid) };
});
