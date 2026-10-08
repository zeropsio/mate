import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CrewStore from "../../CrewStore.ts";
import {
  attempt,
  createLane,
  effectRow,
  okValue,
  subjectsSince,
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import { git, TEST_HOST, write } from "../../testing/crewGitFixture.ts";
import { makeSweep, SWEEP_SUBJECT } from "./sweep.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const row = (checked: ReadonlyArray<string> = [], attemptNumber = 1) =>
  effectRow(
    CREW_EFFECT_KINDS.sweep,
    { host: TEST_HOST, checked },
    { effectId: "crew/main/e/crew.sweep/1", attempt: attemptNumber },
  );

const laneState = (handle: string) =>
  Effect.map(
    Effect.flatMap(CrewStore.CrewStore, (store) => store.getLane(laneKey(handle).crew, handle)),
    (row) => Option.getOrUndefined(row),
  );

const tipOf = (root: string, handle: string) =>
  git(`${root}/.crew/${handle}`, ["rev-parse", "HEAD"]);

describe("crew.sweep", () => {
  it.effect("sweeps at boot: WIP for a dirty lane, a clean lane left as it is", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeSweep;
        yield* createLane("backend");
        yield* createLane("frontend");
        const start = tipOf(root, "backend");
        write(`${root}/.crew/backend`, "src/score.ts", "export const score = 1;\n");
        const swept = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          { swept, subjects: subjectsSince(root, "backend", start) },
          {
            swept: {
              lanes: [
                {
                  handle: "backend",
                  _tag: "committed",
                  tip: tipOf(root, "backend"),
                  saved: ["src/score.ts"],
                },
                { handle: "frontend", _tag: "clean", tip: start },
              ],
              brokenRefs: [],
            },
            subjects: [SWEEP_SUBJECT],
          },
        );
      }),
    ),
  );

  it.effect(
    "a sweep's WIP commit the Mate stopped before recording is adopted, its files named",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeSweep;
          yield* createLane("backend");
          const start = tipOf(root, "backend");
          write(`${root}/.crew/backend`, "src/score.ts", "export const score = 1;\n");
          git(`${root}/.crew/backend`, ["add", "-A"]);
          git(`${root}/.crew/backend`, ["commit", "-q", "-m", SWEEP_SUBJECT]);
          const tip = tipOf(root, "backend");
          const swept = okValue(yield* attempt(handler, row([], 2)));
          const lane = yield* laneState("backend");
          assert.deepStrictEqual(
            {
              swept,
              subjects: subjectsSince(root, "backend", start),
              recorded: lane?.recordedTip,
              state: lane?.state,
            },
            {
              swept: {
                lanes: [{ handle: "backend", _tag: "committed", tip, saved: ["src/score.ts"] }],
                brokenRefs: [],
              },
              subjects: [SWEEP_SUBJECT],
              recorded: tip,
              state: "ready",
            },
          );
        }),
      ),
  );

  it.effect("parks a lane whose tip the engine did not write, naming the tip", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeSweep;
        yield* createLane("backend");
        write(`${root}/.crew/backend`, "src/stray.ts", "stray\n");
        git(`${root}/.crew/backend`, ["add", "-A"]);
        git(`${root}/.crew/backend`, ["commit", "-q", "-m", "a commit the crew did not write"]);
        const stray = tipOf(root, "backend");
        const swept = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          { swept, state: (yield* laneState("backend"))?.state },
          {
            swept: {
              lanes: [{ handle: "backend", _tag: "parked", reason: "unknown-tip", paths: [stray] }],
              brokenRefs: [],
            },
            state: "parked",
          },
        );
      }),
    ),
  );
});
