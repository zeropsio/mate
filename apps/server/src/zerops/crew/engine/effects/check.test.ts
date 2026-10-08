import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as CrewWorkspace from "../../CrewWorkspace.ts";
import {
  attempt,
  createLane,
  effectRow,
  okValue,
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import { exists, git, read, TEST_HOST, write } from "../../testing/crewGitFixture.ts";
import { makeCheck, type CheckPayload } from "./check.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const COUNTED = "echo run >> ../backend.check-runs; ";

const payload = (command: string, tip?: string): CheckPayload => ({
  handle: "backend",
  host: TEST_HOST,
  kind: "check",
  command: `${COUNTED}${command}`,
  ...(tip === undefined ? {} : { tip }),
});

const row = (body: CheckPayload, attemptNumber = 1) =>
  effectRow(CREW_EFFECT_KINDS.check, body, {
    effectId: "crew/main/e/crew.check/1",
    attempt: attemptNumber,
  });

const runs = (root: string) =>
  exists(root, ".crew/backend.check-runs")
    ? read(root, ".crew/backend.check-runs").trim().split("\n").length
    : 0;

const lane = (root: string) => `${root}/.crew/backend`;

describe("crew.check", () => {
  it.effect("runs the check on the copy's tree and names the tree it passed on", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeCheck;
        yield* createLane("backend");
        const tip = git(lane(root), ["rev-parse", "HEAD"]);
        const passed = okValue(yield* attempt(handler, row(payload("echo all green", tip))));
        assert.deepStrictEqual(
          { passed, runs: runs(root) },
          {
            passed: { _tag: "checked", tip, outcome: { _tag: "passed", tail: "all green\n" } },
            runs: 1,
          },
        );
      }),
    ),
  );

  it.effect(
    "a check a restart cut runs again on the tree it was asked for, never a moved one",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeCheck;
          yield* createLane("backend");
          const asked = git(lane(root), ["rev-parse", "HEAD"]);
          const again = okValue(yield* attempt(handler, row(payload("echo all green", asked), 2)));
          write(lane(root), "src/late.ts", "late\n");
          yield* Effect.flatMap(CrewWorkspace.CrewWorkspace, (workspace) =>
            workspace.commitTurn(laneKey("backend"), { assignment: "a-1", turn: 2 }),
          );
          const moved = git(lane(root), ["rev-parse", "HEAD"]);
          const refused = okValue(
            yield* attempt(handler, row(payload("echo all green", asked), 3)),
          );
          assert.deepStrictEqual(
            { again, refused, runs: runs(root) },
            {
              again: {
                _tag: "checked",
                tip: asked,
                outcome: { _tag: "passed", tail: "all green\n" },
              },
              refused: { _tag: "moved", tip: moved },
              runs: 1,
            },
          );
        }),
      ),
  );

  it.effect("a failed check is its outcome: its exit code and the tail of its output", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeCheck;
        yield* createLane("backend");
        const tip = git(lane(root), ["rev-parse", "HEAD"]);
        const failed = okValue(
          yield* attempt(handler, row(payload("echo 2 tests failed; exit 1"))),
        );
        assert.deepStrictEqual(failed, {
          _tag: "checked",
          tip,
          outcome: { _tag: "failed", code: 1, tail: "2 tests failed\n" },
        });
      }),
    ),
  );
});
