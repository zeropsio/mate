import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import { CrewEngine, inertCrewEngine } from "../CrewEngine.ts";
import { CREW_OFF_SNAPSHOT } from "../crewSnapshot.ts";
import { snapshotWhere } from "./crewEngineSteps.ts";

describe("snapshotWhere", () => {
  // A loaded machine slows the engine, never the condition: the wait ends when the engine
  // publishes the snapshot, however long that takes, and the test's own budget bounds it.
  it.effect("waits for the snapshot the engine publishes, however long it takes", () =>
    Effect.gen(function* () {
      const hub = yield* SubscriptionRef.make(CREW_OFF_SNAPSHOT);
      const waiting = yield* snapshotWhere((snapshot) => snapshot.seq === 2).pipe(
        Effect.provideService(CrewEngine, {
          ...inertCrewEngine,
          snapshot: SubscriptionRef.changes(hub),
        }),
        Effect.forkChild,
      );
      yield* TestClock.adjust("30 seconds");
      yield* SubscriptionRef.set(hub, { ...CREW_OFF_SNAPSHOT, seq: 1 });
      yield* TestClock.adjust("30 seconds");
      yield* SubscriptionRef.set(hub, { ...CREW_OFF_SNAPSHOT, seq: 2 });
      const seen = yield* Fiber.join(waiting);
      assert.strictEqual(seen.seq, 2);
    }),
  );
});
