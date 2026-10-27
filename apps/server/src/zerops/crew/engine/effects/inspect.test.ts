// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

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
import { git, TEST_HOST, write } from "../../testing/crewGitFixture.ts";
import { makeInspect, type InspectPayload } from "./inspect.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const PAYLOAD: InspectPayload = {
  host: TEST_HOST,
  handles: ["backend", "frontend"],
  landings: ["a-1", "a-2"],
};

const row = (attemptNumber = 1) =>
  effectRow(CREW_EFFECT_KINDS.inspect, PAYLOAD, {
    effectId: "crew/main/e/crew.inspect/1",
    attempt: attemptNumber,
  });

/** Every ref and the person's status: what a read must leave as it found it. */
const repository = (root: string) => ({
  refs: git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]),
  status: git(root, ["status", "--porcelain"]),
  copy: git(`${root}/.crew/backend`, ["status", "--porcelain"]),
});

/** backend: one commit ahead and an edit; frontend: its directory gone; a-1 landed by hand. */
const arrange = (root: string) =>
  Effect.gen(function* () {
    const workspace = yield* CrewWorkspace.CrewWorkspace;
    yield* createLane("backend");
    yield* createLane("frontend");
    write(`${root}/.crew/backend`, "src/score.ts", "export const score = 1;\nexport {};\n");
    yield* workspace.commitTurn(laneKey("backend"), { assignment: "a-3", turn: 1 });
    write(`${root}/.crew/backend`, "src/draft.ts", "draft\n");
    NodeFS.rmSync(`${root}/.crew/frontend`, { recursive: true, force: true });
    write(root, "docs/landed.md", "landed\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "Landed", "-m", "Crew-Lane: x\nCrew-Assignment: a-1"]);
    return git(root, ["rev-parse", "HEAD"]);
  });

describe("crew.inspect", () => {
  it.effect("reads each copy's figures, a missing copy and a landing that went through", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeInspect;
        const head = yield* arrange(root);
        const before = repository(root);
        const read = okValue(yield* attempt(handler, row()));
        assert.deepStrictEqual(
          { read, after: repository(root) },
          {
            read: {
              integration: { branch: "main", head },
              lanes: [
                {
                  handle: "backend",
                  present: true,
                  stats: {
                    ahead: 1,
                    insertions: 2,
                    deletions: 0,
                    dirty: true,
                    integration: { branch: "main", head },
                  },
                },
                { handle: "frontend", present: false, stats: null },
              ],
              landings: [
                { assignment: "a-1", commit: head },
                { assignment: "a-2", commit: null },
              ],
            },
            after: before,
          },
        );
      }),
    ),
  );

  it.effect("an inspection the restart cut reads the same facts again and writes nothing", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeInspect;
        yield* arrange(root);
        const before = repository(root);
        const first = okValue(yield* attempt(handler, row(1)));
        const again = okValue(yield* attempt(handler, row(2)));
        assert.deepStrictEqual({ again, after: repository(root) }, { again: first, after: before });
      }),
    ),
  );
});
