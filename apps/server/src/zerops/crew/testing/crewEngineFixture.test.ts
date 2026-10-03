// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CrewShell, script } from "../CrewShell.ts";
import { eventually, withCrewEngine } from "./crewEngineFixture.ts";
import { applied } from "./crewEngineSteps.ts";
import { TEST_HOST } from "./crewGitFixture.ts";

/** Names this file's long command among every process on the machine. */
// @effect-diagnostics-next-line globalDate:off
const MARKER = `crew-teardown-${process.pid}-${Date.now()}`;

/** Whether a process whose command line names `marker` runs. */
const running = (marker: string): boolean =>
  NodeChildProcess.spawnSync("pgrep", ["-f", marker]).status === 0;

describe("withCrewEngine", () => {
  // The fixture removes the service's repository once its engine is gone. Whatever the world's
  // service ran must be gone by then too, even a command that will not stop when asked.
  it.live("a world's teardown leaves no process its service ran", () =>
    Effect.gen(function* () {
      yield* withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const shell = yield* CrewShell;
          // Run as the engine runs its background work: in a scope whose close interrupts it.
          yield* shell
            .run(TEST_HOST, script(`trap '' TERM; sleep 30 # ${MARKER}\n`), {
              timeout: "60 seconds",
            })
            .pipe(Effect.forkScoped);
          yield* eventually(Effect.sync(() => running(MARKER)));
        }).pipe(Effect.scoped),
      );
      assert.isFalse(running(MARKER));
    }),
  );
});
