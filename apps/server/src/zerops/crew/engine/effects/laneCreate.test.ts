import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CrewStore from "../../CrewStore.ts";
import { attempt, effectRow, okValue, withCrewEffects } from "../../testing/crewEffectFixture.ts";
import { exists, git, read, TEST_HOST } from "../../testing/crewGitFixture.ts";
import { makeLaneCreate, type LaneCreatePayload } from "./laneCreate.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

/** Setup that counts its runs beside the copy, outside every tree. */
const PAYLOAD: LaneCreatePayload = {
  handle: "backend",
  host: TEST_HOST,
  setup: "echo run >> ../backend.setup-runs",
};

const row = (payload: LaneCreatePayload = PAYLOAD) =>
  effectRow(CREW_EFFECT_KINDS.laneCreate, payload, {
    effectId: "crew/main/e/crew.lane.create/1",
  });

const laneRow = Effect.map(
  Effect.flatMap(CrewStore.CrewStore, (store) => store.getLane(laneKey("backend").crew, "backend")),
  (row) => Option.getOrUndefined(row),
);

const setupRuns = (root: string) =>
  exists(root, ".crew/backend.setup-runs")
    ? read(root, ".crew/backend.setup-runs").trim().split("\n").length
    : 0;

const worktrees = (root: string) =>
  git(root, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;

describe("crew.lane.create", () => {
  it.effect("creates a lane that leaves the person's git status clean, set up and recorded", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneCreate;
        const head = git(root, ["rev-parse", "HEAD"]);
        const created = okValue(yield* attempt(handler, row()));
        const recorded = yield* laneRow;
        assert.deepStrictEqual(
          {
            created,
            status: git(root, ["status", "--porcelain"]),
            recorded: recorded?.recordedTip,
            dispatch: recorded?.dispatchCommit,
            lockfileHash: typeof recorded?.lockfileHash,
            runs: setupRuns(root),
          },
          {
            created: { _tag: "created", tip: head, setup: { _tag: "passed", tail: "" } },
            status: "",
            recorded: head,
            dispatch: head,
            lockfileHash: "string",
            runs: 1,
          },
        );
      }),
    ),
  );

  it.effect(
    "a copy its create added before the Mate stopped is recorded, added once and set up",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeLaneCreate;
          const head = git(root, ["rev-parse", "HEAD"]);
          // The service added the copy; the Mate stopped before it recorded it or set it up.
          git(root, ["worktree", "add", "-q", ".crew/backend", "-b", "crew/backend", head]);
          const created = okValue(yield* attempt(handler, row()));
          assert.deepStrictEqual(
            {
              created,
              recorded: (yield* laneRow)?.recordedTip,
              worktrees: worktrees(root),
              runs: setupRuns(root),
            },
            {
              created: { _tag: "created", tip: head, setup: { _tag: "passed", tail: "" } },
              recorded: head,
              worktrees: 2,
              runs: 1,
            },
          );
        }),
      ),
  );

  it.effect("a recorded copy is left alone: a re-run after the create only sets it up again", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneCreate;
        yield* attempt(handler, row());
        const again = okValue(yield* attempt(handler, row()));
        const head = git(root, ["rev-parse", "HEAD"]);
        assert.deepStrictEqual(
          { again, worktrees: worktrees(root), runs: setupRuns(root) },
          {
            again: { _tag: "created", tip: head, setup: { _tag: "passed", tail: "" } },
            worktrees: 2,
            runs: 2,
          },
        );
      }),
    ),
  );

  it.effect("a setup that fails is named with its output, the copy kept for a retry", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneCreate;
        const head = git(root, ["rev-parse", "HEAD"]);
        const failed = okValue(
          yield* attempt(handler, row({ ...PAYLOAD, setup: "echo missing tool; exit 3" })),
        );
        const recorded = yield* laneRow;
        assert.deepStrictEqual(
          { failed, recorded: recorded?.recordedTip, lockfileHash: recorded?.lockfileHash },
          {
            failed: {
              _tag: "created",
              tip: head,
              setup: { _tag: "failed", code: 3, tail: "missing tool\n" },
            },
            recorded: head,
            lockfileHash: null,
          },
        );
      }),
    ),
  );

  it.effect("a tree with no commit yet gets no copy, and says so", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLaneCreate;
        git(root, ["checkout", "-q", "--orphan", "empty"]);
        const refused = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          { refused, copy: exists(root, ".crew/backend"), recorded: yield* laneRow },
          { refused: { _tag: "no-head" }, copy: false, recorded: undefined },
        );
      }),
    ),
  );
});
