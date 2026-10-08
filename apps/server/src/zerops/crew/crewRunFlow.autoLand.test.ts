import { assert, describe, it } from "@effect/vitest";
import type { CrewCommandError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";

import { refuse, type CrewCore } from "./crewCore.ts";
import { autoLand } from "./crewRunFlow.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";

const READY = {
  assignment: "task-1",
  number: 1,
  member: "backend",
  state: "ready",
} as unknown as CrewAssignmentRow;

/** What a run's own landing touches: its memory, the task as stored, the log, its fibers. */
const coreWith = (stored: () => CrewAssignmentRow, log: Array<string>) => {
  const fibers: Array<Fiber.Fiber<void>> = [];
  const core = {
    memory: {
      autoLanding: new Set<string>(),
      heldLandings: new Map<string, string>(),
      lastError: null as string | null,
    },
    store: {
      getAssignment: () => Effect.sync(() => Option.some(stored())),
      appendLog: (entry: { readonly kind: string }) => Effect.sync(() => void log.push(entry.kind)),
    },
    now: Effect.succeed("2026-10-01T10:00:00.000Z"),
    crewmate: () => (effect: Effect.Effect<unknown>) => effect,
    background: (effect: Effect.Effect<void>) =>
      Effect.forkDetach(effect).pipe(
        Effect.tap((fiber) => Effect.sync(() => fibers.push(fiber))),
        Effect.asVoid,
      ),
  } as unknown as CrewCore;
  return {
    core,
    drain: Effect.suspend(() =>
      Effect.forEach(fibers.splice(0), Fiber.join, { discard: true }),
    ).pipe(Effect.timeout("5 seconds"), Effect.orDie),
  };
};

describe("autoLand", () => {
  it.live("a ready task advanced again while its landing is queued is landed once", () =>
    Effect.gen(function* () {
      const log: Array<string> = [];
      const { core, drain } = coreWith(() => READY, log);
      const release = yield* Deferred.make<void>();
      let landings = 0;
      const landing = () =>
        Effect.sync(() => void (landings += 1)).pipe(Effect.andThen(Deferred.await(release)));
      yield* autoLand(core, READY, { kind: "crew", startedBy: "user-a" }, landing);
      yield* autoLand(core, READY, { kind: "crew", startedBy: "user-a" }, landing);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      yield* drain;
      assert.strictEqual(landings, 1);
    }),
  );

  it.live("a landing that finds its task landed meanwhile is a landing done, not a hold", () =>
    Effect.gen(function* () {
      const log: Array<string> = [];
      const { core, drain } = coreWith(() => ({ ...READY, state: "landed" }), log);
      yield* autoLand(core, READY, { kind: "crew", startedBy: "user-a" }, () =>
        Effect.fail(refuse("wrong-state", "#1 is landed") as CrewCommandError),
      );
      yield* drain;
      assert.deepStrictEqual([core.memory.lastError, log], [null, []]);
    }),
  );

  it.live("a landing held for a reason is said once, in the log and as the last error", () =>
    Effect.gen(function* () {
      const log: Array<string> = [];
      const { core, drain } = coreWith(() => READY, log);
      const held = () =>
        Effect.fail(
          refuse("wrong-state", "a chat of this Mate is working; land between its turns"),
        );
      yield* autoLand(core, READY, { kind: "crew", startedBy: "user-a" }, held);
      yield* drain;
      yield* autoLand(core, READY, { kind: "crew", startedBy: "user-a" }, held);
      yield* drain;
      assert.deepStrictEqual(
        [core.memory.lastError, log],
        [
          "#1 waits to land: a chat of this Mate is working; land between its turns",
          ["landing-held"],
        ],
      );
    }),
  );
});
