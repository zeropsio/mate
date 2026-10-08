import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

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
import { git, gitExit, write } from "../../testing/crewGitFixture.ts";
import { makeMergeIn } from "./mergeIn.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const EFFECT = "crew/main/e/crew.mergeIn/1";
const row = (effect = EFFECT) =>
  effectRow(CREW_EFFECT_KINDS.mergeIn, { handle: "backend" }, { effectId: effect });

const lane = (root: string) => `${root}/.crew/backend`;

/** A copy with one committed turn that changes `path`. */
const laneWork = (root: string, path: string, content: string) =>
  Effect.gen(function* () {
    const workspace = yield* CrewWorkspace.CrewWorkspace;
    yield* createLane("backend");
    write(lane(root), path, content);
    return yield* workspace.commitTurn(laneKey("backend"), { assignment: "a-1", turn: 1 });
  });

const recorded = Effect.map(
  Effect.flatMap(CrewStore.CrewStore, (store) => store.getLane(laneKey("backend").crew, "backend")),
  (row) => Option.getOrUndefined(row)?.recordedTip,
);

const merges = (root: string) =>
  git(lane(root), ["log", "--merges", "--format=%H"])
    .split("\n")
    .filter((line) => line !== "").length;

describe("crew.mergeIn", () => {
  it.effect("merges the head into a lane cleanly, or leaves a conflict open as rework", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeMergeIn;
        yield* laneWork(root, "README.md", "lane\n");
        const current = okValue(yield* attempt(handler, row("crew/main/e/crew.mergeIn/1")));
        const cleanHead = personCommits(root, "docs/person.md", "person\n");
        const clean = okValue(yield* attempt(handler, row("crew/main/e/crew.mergeIn/2"))) as {
          readonly tip?: string;
        };
        const trailer = git(lane(root), [
          "log",
          "-1",
          "--format=%(trailers:key=Crew-Operation,valueonly)",
        ]);
        const conflictHead = personCommits(root, "README.md", "person\n");
        const conflict = okValue(yield* attempt(handler, row("crew/main/e/crew.mergeIn/3")));
        assert.deepStrictEqual(
          { current, clean, trailer, conflict },
          {
            current: { _tag: "current", head: git(root, ["rev-parse", "HEAD~2"]) },
            clean: {
              _tag: "merged",
              head: cleanHead,
              tip: clean.tip,
              lockfileChanged: false,
            },
            trailer: "crew/main/e/crew.mergeIn/2",
            conflict: { _tag: "conflict", head: conflictHead, paths: ["README.md"] },
          },
        );
      }),
    ),
  );

  it.effect("a merge-in killed after its merge commit is adopted: one merge, recorded", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeMergeIn;
        yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
        const head = personCommits(root, "docs/person.md", "person\n");
        // The service finished the merge; the Mate stopped before it recorded the tip.
        git(lane(root), [
          "merge",
          "-q",
          "--no-verify",
          "-m",
          `Merge your tree\n\nCrew-Operation: ${EFFECT}`,
          head,
        ]);
        const tip = git(lane(root), ["rev-parse", "HEAD"]);
        const adopted = okValue(yield* attempt(handler, row()));
        const again = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          { adopted, again, merges: merges(root), recorded: yield* recorded },
          {
            // An adopted merge cannot tell whether a lockfile moved: setup runs again.
            adopted: { _tag: "merged", head, tip, lockfileChanged: true },
            again: { _tag: "merged", head, tip, lockfileChanged: true },
            merges: 1,
            recorded: tip,
          },
        );
      }),
    ),
  );

  it.effect("a merge-in killed after git left its conflict open reads back as that conflict", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeMergeIn;
        yield* laneWork(root, "README.md", "lane\n");
        const head = personCommits(root, "README.md", "person\n");
        // The merge ran on the service and stopped on its conflict; the Mate never read it.
        gitExit(lane(root), ["merge", "-q", "--no-verify", head]);
        const adopted = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          { adopted, merging: gitExit(lane(root), ["rev-parse", "-q", "--verify", "MERGE_HEAD"]) },
          { adopted: { _tag: "conflict", head, paths: ["README.md"] }, merging: 0 },
        );
      }),
    ),
  );

  it.effect("refuses a copy whose tip the engine did not write, merging nothing", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeMergeIn;
        yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
        personCommits(root, "docs/person.md", "person\n");
        write(lane(root), "src/stray.ts", "stray\n");
        git(lane(root), ["add", "-A"]);
        git(lane(root), ["commit", "-q", "-m", "a commit the crew did not write"]);
        const stray = git(lane(root), ["rev-parse", "HEAD"]);
        const refused = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          { refused, merges: merges(root), tip: git(lane(root), ["rev-parse", "HEAD"]) },
          { refused: { _tag: "unknown-tip", tip: stray }, merges: 0, tip: stray },
        );
      }),
    ),
  );
});
