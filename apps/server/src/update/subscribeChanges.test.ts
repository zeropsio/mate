import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { mergeUpdateSubscriptions, subscribeUpdateChanges } from "./subscribeChanges.ts";

describe("update wake subscriptions", () => {
  it.effect("remembers every source completing before the waiter starts consuming", () =>
    Effect.gen(function* () {
      const admission = yield* PubSub.sliding<void>(1);
      const receipt = yield* PubSub.sliding<void>(1);
      const { changes } = yield* mergeUpdateSubscriptions([
        subscribeUpdateChanges(admission),
        subscribeUpdateChanges(receipt),
      ]);
      // Both completions land in the gap after acquisition and before the consumer is forked.
      yield* PubSub.publish(admission, void 0);
      yield* PubSub.publish(receipt, void 0);
      const seen = yield* changes.pipe(Stream.take(2), Stream.runCollect);
      assert.strictEqual(seen.length, 2);
    }).pipe(Effect.scoped),
  );
});
