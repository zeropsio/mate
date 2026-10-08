// @effect-diagnostics nodeBuiltinImport:off -- real Git fixture paths on the test host.
import { assert, describe, it } from "@effect/vitest";
import type { CrewOperation, CrewSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as NodePath from "node:path";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import { CrewEngine, inertCrewEngine } from "../CrewEngine.ts";
import { CREW_OFF_SNAPSHOT } from "../crewSnapshot.ts";
import { copyOperationsFinished, readyTask, snapshotWhere } from "./crewEngineSteps.ts";
import { withCrewEngine } from "./crewEngineFixture.ts";
import { git, write } from "./crewGitFixture.ts";

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

  it.effect(
    "editing a copy waits for its running operation's receipt, independent of other copies",
    () =>
      Effect.gen(function* () {
        const operation: CrewOperation = {
          id: "check-backend",
          crew: "crew",
          handle: "backend",
          taskId: "task",
          kind: "check",
          stage: "checking",
          confirmedStage: "checking",
          status: "running",
          startedBy: "karel",
          resumeState: "merging",
          targets: {
            host: "appdev",
            path: null,
            ref: null,
            threadId: null,
            commandId: null,
            attempt: 0,
          },
          result: null,
          detail: null,
          startedAt: "2026-10-08T10:00:00.000Z",
          updatedAt: "2026-10-08T10:00:00.000Z",
        };
        const other = { ...operation, id: "check-other", handle: "other" };
        const hub = yield* SubscriptionRef.make<CrewSnapshot>(CREW_OFF_SNAPSHOT);
        const waiting = yield* copyOperationsFinished("backend").pipe(
          Effect.provideService(CrewEngine, {
            ...inertCrewEngine,
            snapshot: SubscriptionRef.changes(hub),
          }),
          Effect.forkChild,
        );
        yield* TestClock.adjust("30 seconds");
        assert.isUndefined(waiting.pollUnsafe());
        yield* SubscriptionRef.set(hub, {
          ...CREW_OFF_SNAPSHOT,
          operations: [operation, other],
        });
        yield* TestClock.adjust("30 seconds");
        assert.isUndefined(waiting.pollUnsafe());
        yield* SubscriptionRef.set(hub, {
          ...CREW_OFF_SNAPSHOT,
          operations: [{ ...operation, status: "succeeded" as const }, other],
        });
        const seen = yield* Fiber.join(waiting);
        assert.strictEqual(seen.operations?.[0]?.status, "succeeded");
        assert.strictEqual(seen.operations?.[1]?.status, "running");
      }),
  );
});

it.live("a ready task still owns its copy until its final lane read completes", () =>
  withCrewEngine((world) =>
    Effect.gen(function* () {
      const check = yield* world.holdSsh((script) => script.includes("test -f ok.txt"));
      const waiting = yield* readyTask(world).pipe(Effect.forkChild);
      yield* check.reached;
      const hold = yield* world.holdSsh((script) => script.includes("dirty=no"));
      yield* check.release;
      yield* hold.reached;
      const ready = yield* snapshotWhere((frame) => frame.board.tasks[0]?.state === "ready");
      assert.isTrue(
        ready.operations?.some(
          (operation) => operation.kind === "check" && operation.status === "running",
        ),
      );
      yield* Effect.yieldNow;
      assert.isUndefined(waiting.pollUnsafe());
      yield* hold.release;
      yield* Fiber.join(waiting);
      const copy = NodePath.join(world.root, ".crew/backend");
      write(copy, "after-check.txt", "unchecked\n");
      git(copy, ["add", "-A"]);
      git(copy, ["commit", "-q", "-m", "after the check"]);
    }),
  ),
);
