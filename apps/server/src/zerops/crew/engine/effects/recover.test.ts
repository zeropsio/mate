// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

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
import { exists, git, read, TEST_HOST, write } from "../../testing/crewGitFixture.ts";
import { makeRecover, type RecoverPayload } from "./recover.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const PAYLOAD: RecoverPayload = {
  host: TEST_HOST,
  specs: [{ handle: "backend", setup: "echo run >> ../backend.setup-runs" }],
  landings: [],
};

const row = (payload: RecoverPayload = PAYLOAD, attemptNumber = 1) =>
  effectRow(CREW_EFFECT_KINDS.recover, payload, {
    effectId: "crew/main/e/crew.recover/1",
    attempt: attemptNumber,
  });

const frozen = Effect.map(
  Effect.flatMap(CrewStore.CrewStore, (store) => store.getLane(laneKey("backend").crew, "backend")),
  (row) => Option.getOrUndefined(row)?.frozenSince,
);

const setupRuns = (root: string) =>
  exists(root, ".crew/backend.setup-runs")
    ? read(root, ".crew/backend.setup-runs").trim().split("\n").length
    : 0;

/** A copy with saved work, its host frozen by a deploy, its directory gone. */
const deployDropped = (root: string) =>
  Effect.gen(function* () {
    const workspace = yield* CrewWorkspace.CrewWorkspace;
    yield* createLane("backend");
    write(`${root}/.crew/backend`, "src/wip.ts", "export {};\n");
    yield* workspace.commitTurn(laneKey("backend"), { assignment: "a-2", turn: 1 });
    yield* workspace.freeze(TEST_HOST);
    NodeFS.rmSync(`${root}/.crew/backend`, { recursive: true, force: true });
  });

describe("crew.recover", () => {
  it.effect("brings lanes back after a self-deploy dropped their directories", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeRecover;
        yield* deployDropped(root);
        const recovered = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          {
            recovered,
            wip: read(root, ".crew/backend/src/wip.ts"),
            runs: setupRuns(root),
            frozen: yield* frozen,
          },
          {
            recovered: {
              _tag: "recovered",
              readded: ["backend"],
              setups: { backend: { _tag: "passed", tail: "" } },
            },
            wip: "export {};\n",
            runs: 1,
            frozen: null,
          },
        );
      }),
    ),
  );

  it.effect("a recovery cut after it brought a copy back sets that copy up on its re-run", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeRecover;
        yield* deployDropped(root);
        // The copy came back on the service; the Mate stopped before its setup ran.
        git(root, ["worktree", "prune"]);
        git(root, ["worktree", "add", "-q", ".crew/backend", "crew/backend"]);
        const recovered = okValue(yield* attempt(handler, row(PAYLOAD, 2)));
        assert.deepStrictEqual(
          { recovered, runs: setupRuns(root), frozen: yield* frozen },
          {
            recovered: {
              _tag: "recovered",
              readded: [],
              setups: { backend: { _tag: "passed", tail: "" } },
            },
            runs: 1,
            frozen: null,
          },
        );
      }),
    ),
  );

  it.effect("names a landing a container replacement lost and brings no copy back", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeRecover;
        yield* deployDropped(root);
        const lost = okValue(
          yield* attempt(
            handler,
            row({ ...PAYLOAD, landings: [{ assignment: "a-1", title: "Add the score API" }] }),
          ),
        );
        assert.deepStrictEqual(
          { lost, copy: exists(root, ".crew/backend"), frozen: yield* frozen },
          {
            lost: {
              _tag: "landings-lost",
              landings: [{ assignment: "a-1", title: "Add the score API" }],
            },
            copy: false,
            frozen: null,
          },
        );
      }),
    ),
  );
});
