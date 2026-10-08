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
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import { git, read, write } from "../../testing/crewGitFixture.ts";
import { makeLand, type LandPayload } from "./land.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const PAYLOAD: LandPayload = { handle: "backend", assignment: "a-1", title: "Add the score API" };
const row = (effect = 1) =>
  effectRow(CREW_EFFECT_KINDS.land, PAYLOAD, { effectId: `crew/main/e/crew.land/${effect}` });

const lane = (root: string) => `${root}/.crew/backend`;

/** A copy with one committed turn: what a passed check lands. */
const laneWork = (root: string) =>
  Effect.gen(function* () {
    const workspace = yield* CrewWorkspace.CrewWorkspace;
    yield* createLane("backend");
    write(lane(root), "src/score.ts", "export const score = 1;\n");
    yield* workspace.commitTurn(laneKey("backend"), { assignment: "a-1", turn: 1 });
  });

/** The first two steps of a landing, as a script killed right after them left the repository. */
const squashAndAnchor = (root: string) => {
  const squash = git(root, [
    "commit-tree",
    "crew/backend^{tree}",
    "-p",
    "HEAD",
    "-m",
    PAYLOAD.title,
    "-m",
    `Crew-Lane: backend\nCrew-Assignment: ${PAYLOAD.assignment}`,
  ]);
  git(root, ["update-ref", `refs/t3/crew/landing/${PAYLOAD.assignment}`, squash]);
  return squash;
};

const trailerCount = (root: string) =>
  git(root, ["log", "--first-parent", "--format=%(trailers:key=Crew-Assignment,valueonly)", "HEAD"])
    .split("\n")
    .filter((line) => line === PAYLOAD.assignment).length;

const laneRow = Effect.map(
  Effect.flatMap(CrewStore.CrewStore, (store) => store.getLane(laneKey("backend").crew, "backend")),
  (row) => Option.getOrUndefined(row),
);

const settledState = (root: string) =>
  Effect.map(laneRow, (row) => ({
    trailers: trailerCount(root),
    anchors: git(root, ["for-each-ref", "refs/t3/crew/landing/"]),
    copy: git(lane(root), ["rev-parse", "HEAD"]),
    recorded: row?.recordedTip,
    lastLanding: row?.lastLanding,
  }));

describe("crew.land", () => {
  it.effect(
    "lands one squash commit with both trailers, resets the lane to it, and lands it once",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeLand;
          yield* laneWork(root);
          const landed = okValue(yield* attempt(handler, row()));
          const again = okValue(yield* attempt(handler, row()));
          const commit = git(root, ["rev-parse", "HEAD"]);
          assert.deepStrictEqual(
            {
              landed,
              again,
              trailers: git(root, ["log", "-1", "--format=%(trailers:only,unfold)"]),
              state: yield* settledState(root),
            },
            {
              landed: { _tag: "landed", commit },
              again: { _tag: "already-landed", commit },
              trailers: "Crew-Lane: backend\nCrew-Assignment: a-1",
              state: {
                trailers: 1,
                anchors: "",
                copy: commit,
                recorded: commit,
                lastLanding: commit,
              },
            },
          );
        }),
      ),
  );

  it.effect(
    "lands exactly once after a script killed between the anchor and the fast-forward",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeLand;
          yield* laneWork(root);
          squashAndAnchor(root);
          const landed = okValue(yield* attempt(handler, row())) as { readonly _tag: string };
          const commit = git(root, ["rev-parse", "HEAD"]);
          assert.deepStrictEqual(
            { landed: landed._tag, state: yield* settledState(root) },
            {
              landed: "landed",
              state: {
                trailers: 1,
                anchors: "",
                copy: commit,
                recorded: commit,
                lastLanding: commit,
              },
            },
          );
        }),
      ),
  );

  it.effect(
    "lands exactly once after a script killed between the fast-forward and the anchor's removal",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeLand;
          yield* laneWork(root);
          const squash = squashAndAnchor(root);
          git(root, ["merge", "--ff-only", "-q", squash]);
          const adopted = okValue(yield* attempt(handler, row()));
          assert.deepStrictEqual(
            { adopted, state: yield* settledState(root) },
            {
              adopted: { _tag: "already-landed", commit: squash },
              state: {
                trailers: 1,
                anchors: "",
                copy: squash,
                recorded: squash,
                lastLanding: squash,
              },
            },
          );
        }),
      ),
  );

  it.effect(
    "a landing the service finished after the Mate stopped is landed, its copy moved to it",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeLand;
          yield* laneWork(root);
          const squash = squashAndAnchor(root);
          git(root, ["merge", "--ff-only", "-q", squash]);
          git(root, ["update-ref", "-d", `refs/t3/crew/landing/${PAYLOAD.assignment}`]);
          git(lane(root), ["reset", "-q", "--keep", squash]);
          const adopted = okValue(yield* attempt(handler, row()));
          assert.deepStrictEqual(
            { adopted, state: yield* settledState(root) },
            {
              adopted: { _tag: "already-landed", commit: squash },
              state: {
                trailers: 1,
                anchors: "",
                copy: squash,
                recorded: squash,
                lastLanding: squash,
              },
            },
          );
        }),
      ),
  );

  it.effect("refuses over a tracked path edited in the person's tree and names it", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeLand;
        yield* laneWork(root);
        const before = git(root, ["rev-parse", "HEAD"]);
        write(lane(root), "README.md", "lane\n");
        yield* Effect.flatMap(CrewWorkspace.CrewWorkspace, (workspace) =>
          workspace.commitTurn(laneKey("backend"), { assignment: "a-1", turn: 2 }),
        );
        write(root, "README.md", "the person's edit\n");
        const refused = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          {
            refused,
            head: git(root, ["rev-parse", "HEAD"]),
            person: read(root, "README.md"),
            anchors: git(root, ["for-each-ref", "refs/t3/crew/landing/"]),
          },
          {
            refused: {
              _tag: "refused",
              refusal: { kind: "dirty", action: "wait", paths: ["README.md"] },
            },
            head: before,
            person: "the person's edit\n",
            anchors: "",
          },
        );
      }),
    ),
  );
});
