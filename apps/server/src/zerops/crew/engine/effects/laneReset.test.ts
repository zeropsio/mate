import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CrewIntegration from "../../CrewIntegration.ts";
import * as CrewStore from "../../CrewStore.ts";
import * as CrewWorkspace from "../../CrewWorkspace.ts";
import {
  attempt,
  createLane,
  effectRow,
  okValue,
  personCommits,
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import { git, write } from "../../testing/crewGitFixture.ts";
import { makeLaneReset, type LaneResetPayload } from "./laneReset.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const DISPATCH: LaneResetPayload = { mode: "dispatch", handle: "backend" };
const DISCARD: LaneResetPayload = {
  mode: "discard",
  handle: "backend",
  run: "r-1",
  assignment: "a-1",
  attempt: 1,
};
const ATTEMPT_REF = "refs/t3/crew/r-1/a-1/1";

const row = (payload: LaneResetPayload, effect = 1) =>
  effectRow(CREW_EFFECT_KINDS.laneReset, payload, {
    effectId: `crew/main/e/crew.lane.reset/${effect}`,
  });

const lane = (root: string) => `${root}/.crew/backend`;

const laneRow = Effect.map(
  Effect.flatMap(CrewStore.CrewStore, (store) => store.getLane(laneKey("backend").crew, "backend")),
  (row) => Option.getOrUndefined(row),
);

/** A copy whose last landing is its tip, and your tree moved on after it. */
const landedThenMoved = (root: string) =>
  Effect.gen(function* () {
    const workspace = yield* CrewWorkspace.CrewWorkspace;
    const integration = yield* CrewIntegration.CrewIntegration;
    yield* createLane("backend");
    write(lane(root), "src/score.ts", "export const score = 1;\n");
    yield* workspace.commitTurn(laneKey("backend"), { assignment: "a-0", turn: 1 });
    yield* integration.land({ ...laneKey("backend"), assignment: "a-0", title: "Score" });
    return personCommits(root, "docs/person.md", "person\n");
  });

describe("crew.lane.reset", () => {
  it.effect("resets a lane whose tip is its last landing to the current head at dispatch", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneReset;
        const head = yield* landedThenMoved(root);
        const reset = okValue(yield* attempt(handler, row(DISPATCH)));
        write(lane(root), "src/more.ts", "more\n");
        yield* Effect.flatMap(CrewWorkspace.CrewWorkspace, (workspace) =>
          workspace.commitTurn(laneKey("backend"), { assignment: "a-1", turn: 1 }),
        );
        const own = git(lane(root), ["rev-parse", "HEAD"]);
        const kept = okValue(yield* attempt(handler, row(DISPATCH, 2)));
        const recorded = yield* laneRow;
        assert.deepStrictEqual(
          { reset, kept, recorded: recorded?.recordedTip, snapshot: recorded?.refSnapshot },
          {
            reset: { _tag: "ready", dispatchCommit: head, reset: true },
            kept: { _tag: "ready", dispatchCommit: own, reset: false },
            recorded: own,
            snapshot: {},
          },
        );
      }),
    ),
  );

  it.effect("its own dispatch's reset, to your tree's head, is adopted", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneReset;
        const head = yield* landedThenMoved(root);
        // The service moved the copy; the Mate stopped before it recorded the move.
        git(lane(root), ["reset", "-q", "--hard", head]);
        const adopted = okValue(yield* attempt(handler, row(DISPATCH)));
        const recorded = yield* laneRow;
        assert.deepStrictEqual(
          {
            adopted,
            recorded: recorded?.recordedTip,
            dispatch: recorded?.dispatchCommit,
            state: recorded?.state,
          },
          {
            adopted: { _tag: "ready", dispatchCommit: head, reset: true },
            recorded: head,
            dispatch: head,
            state: "ready",
          },
        );
      }),
    ),
  );

  it.effect("a copy moved anywhere but your tree's head is not adopted: it parks", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneReset;
        yield* landedThenMoved(root);
        git(lane(root), ["checkout", "-q", "-b", "stray"]);
        write(lane(root), "stray.md", "stray\n");
        git(lane(root), ["add", "-A"]);
        git(lane(root), ["commit", "-q", "-m", "stray"]);
        git(lane(root), ["checkout", "-q", "crew/backend"]);
        git(lane(root), ["reset", "-q", "--hard", "stray"]);
        const stray = git(lane(root), ["rev-parse", "HEAD"]);
        const parked = okValue(yield* attempt(handler, row(DISPATCH)));
        assert.deepStrictEqual(
          { parked, state: (yield* laneRow)?.state },
          { parked: { _tag: "parked", reason: "unknown-tip", tip: stray }, state: "parked" },
        );
      }),
    ),
  );

  it.effect("dispatch refuses to reset a copy that still has preserved dirty work", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneReset;
        yield* landedThenMoved(root);
        const before = git(lane(root), ["rev-parse", "HEAD"]);
        write(lane(root), "src/score.ts", "kept edit\n");
        const dirty = okValue(yield* attempt(handler, row(DISPATCH)));
        assert.deepStrictEqual(
          { dirty, tip: git(lane(root), ["rev-parse", "HEAD"]) },
          { dirty: { _tag: "dirty" }, tip: before },
        );
      }),
    ),
  );

  it.effect(
    "keeps an attempt's tip under its ref and resets the lane to where the attempt began",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeLaneReset;
          const created = yield* createLane("backend");
          const start = created._tag === "created" ? created.head : "";
          write(lane(root), "src/score.ts", "export const score = 1;\n");
          const kept = okValue(yield* attempt(handler, row(DISCARD))) as { readonly tip: string };
          assert.deepStrictEqual(
            {
              kept,
              ref: git(root, ["rev-parse", ATTEMPT_REF]),
              copy: git(lane(root), ["rev-parse", "HEAD"]),
              recorded: (yield* laneRow)?.recordedTip,
            },
            {
              kept: { _tag: "kept", ref: ATTEMPT_REF, tip: kept.tip },
              ref: kept.tip,
              copy: start,
              recorded: start,
            },
          );
        }),
      ),
  );

  it.effect("a discard killed after its WIP commit keeps that commit, never a second", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneReset;
        const created = yield* createLane("backend");
        const start = created._tag === "created" ? created.head : "";
        write(lane(root), "src/score.ts", "export const score = 1;\n");
        git(lane(root), ["add", "-A"]);
        git(lane(root), ["commit", "-q", "-m", "wip(a-1): keep attempt 1"]);
        const wip = git(lane(root), ["rev-parse", "HEAD"]);
        const kept = okValue(yield* attempt(handler, row(DISCARD)));
        assert.deepStrictEqual(
          {
            kept,
            ref: git(root, ["rev-parse", ATTEMPT_REF]),
            commits: git(root, ["rev-list", "--count", `${start}..${ATTEMPT_REF}`]),
            copy: git(lane(root), ["rev-parse", "HEAD"]),
            recorded: (yield* laneRow)?.recordedTip,
          },
          {
            kept: { _tag: "kept", ref: ATTEMPT_REF, tip: wip },
            ref: wip,
            commits: "1",
            copy: start,
            recorded: start,
          },
        );
      }),
    ),
  );

  it.effect(
    "a discard killed after its reset is adopted: the attempt kept once, the copy at its start",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeLaneReset;
          const created = yield* createLane("backend");
          const start = created._tag === "created" ? created.head : "";
          write(lane(root), "src/score.ts", "export const score = 1;\n");
          git(lane(root), ["add", "-A"]);
          git(lane(root), ["commit", "-q", "-m", "wip(a-1): keep attempt 1"]);
          const wip = git(lane(root), ["rev-parse", "HEAD"]);
          git(root, ["update-ref", ATTEMPT_REF, wip]);
          git(lane(root), ["reset", "-q", "--hard", start]);
          const kept = okValue(yield* attempt(handler, row(DISCARD)));
          const recorded = yield* laneRow;
          assert.deepStrictEqual(
            { kept, copy: git(lane(root), ["rev-parse", "HEAD"]), recorded: recorded?.recordedTip },
            { kept: { _tag: "kept", ref: ATTEMPT_REF, tip: wip }, copy: start, recorded: start },
          );
        }),
      ),
  );
});
