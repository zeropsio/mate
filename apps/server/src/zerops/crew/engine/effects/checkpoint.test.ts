import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CrewIntegration from "../../CrewIntegration.ts";
import * as CrewStore from "../../CrewStore.ts";
import {
  attempt,
  createLane,
  effectRow,
  okValue,
  subjectsSince,
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import { git, write } from "../../testing/crewGitFixture.ts";
import { makeCheckpoint, type CheckpointPayload } from "./checkpoint.ts";
import { CREW_EFFECT_KINDS, laneKey } from "./shared.ts";

const PAYLOAD: CheckpointPayload = {
  handle: "backend",
  assignment: "a-1",
  turn: 1,
  explained: [],
};

const row = (effect = 1, payload: CheckpointPayload = PAYLOAD) =>
  effectRow(CREW_EFFECT_KINDS.checkpoint, payload, {
    effectId: `crew/main/e/crew.checkpoint/${effect}`,
  });

const lane = (root: string) => `${root}/.crew/backend`;

const recordedTip = Effect.map(
  Effect.flatMap(CrewStore.CrewStore, (store) => store.getLane(laneKey("backend").crew, "backend")),
  (row) => Option.getOrUndefined(row),
);

describe("crew.checkpoint", () => {
  it.effect(
    "commits a turn as WIP by the crew and records the tip; a quiet turn commits nothing",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeCheckpoint;
          const created = yield* createLane("backend");
          const start = created._tag === "created" ? created.head : "";
          write(lane(root), "src/score.ts", "export const score = 1;\n");
          const first = okValue(yield* attempt(handler, row(1)));
          const quiet = okValue(yield* attempt(handler, row(2)));
          const tip = git(lane(root), ["rev-parse", "HEAD"]);
          assert.deepStrictEqual(
            {
              first,
              quiet,
              subjects: subjectsSince(root, "backend", start),
              trailer: git(lane(root), [
                "log",
                "-1",
                "--format=%(trailers:key=Crew-Operation,valueonly)",
              ]),
              recorded: (yield* recordedTip)?.recordedTip,
            },
            {
              first: {
                _tag: "saved",
                commit: { _tag: "committed", tip, saved: ["src/score.ts"] },
                changes: [],
              },
              quiet: { _tag: "saved", commit: { _tag: "unchanged", tip }, changes: [] },
              subjects: ["wip(a-1): turn 1"],
              trailer: "crew/main/e/crew.checkpoint/1",
              recorded: tip,
            },
          );
        }),
      ),
  );

  it.effect(
    "a WIP commit its checkpoint finished after the Mate stopped is adopted, not parked",
    () =>
      withCrewEffects((root) =>
        Effect.gen(function* () {
          const handler = yield* makeCheckpoint;
          const created = yield* createLane("backend");
          const start = created._tag === "created" ? created.head : "";
          write(lane(root), "src/score.ts", "export const score = 1;\n");
          // The service finished the commit; the Mate stopped before it recorded the tip.
          git(lane(root), ["add", "-A"]);
          git(lane(root), [
            "commit",
            "-q",
            "-m",
            "wip(a-1): turn 1\n\nCrew-Operation: crew/main/e/crew.checkpoint/1",
          ]);
          const tip = git(lane(root), ["rev-parse", "HEAD"]);
          const adopted = okValue(yield* attempt(handler, row(1)));
          // The outcome was not recorded before a second restart: the same answer, no second commit.
          const again = okValue(yield* attempt(handler, row(1)));
          const recorded = yield* recordedTip;
          assert.deepStrictEqual(
            {
              adopted,
              again,
              subjects: subjectsSince(root, "backend", start),
              recorded: recorded?.recordedTip,
              state: recorded?.state,
            },
            {
              adopted: {
                _tag: "saved",
                commit: { _tag: "committed", tip, saved: ["src/score.ts"] },
                changes: [],
              },
              again: {
                _tag: "saved",
                commit: { _tag: "committed", tip, saved: ["src/score.ts"] },
                changes: [],
              },
              subjects: ["wip(a-1): turn 1"],
              recorded: tip,
              state: "ready",
            },
          );
        }),
      ),
  );

  it.effect("parks the lane on a secret file, naming it and staging nothing", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeCheckpoint;
        const created = yield* createLane("backend");
        const start = created._tag === "created" ? created.head : "";
        write(lane(root), ".env", "TOKEN=1\n");
        const parked = okValue(yield* attempt(handler, row(1)));
        assert.deepStrictEqual(
          {
            parked,
            subjects: subjectsSince(root, "backend", start),
            staged: git(lane(root), ["diff", "--cached", "--name-only"]),
            state: (yield* recordedTip)?.state,
          },
          {
            parked: {
              _tag: "saved",
              commit: { _tag: "parked", reason: "secrets", paths: [".env"] },
              changes: [],
            },
            subjects: [],
            staged: "",
            state: "parked",
          },
        );
      }),
    ),
  );

  it.effect("a checked copy's edits are never committed: tracked edits hold it", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeCheckpoint;
        const created = yield* createLane("backend");
        const start = created._tag === "created" ? created.head : "";
        const checked = { ...PAYLOAD, checked: true };
        write(lane(root), "untracked.txt", "scratch\n");
        const untracked = okValue(yield* attempt(handler, row(1, checked)));
        write(lane(root), "README.md", "edited after the check\n");
        const tracked = okValue(yield* attempt(handler, row(2, checked)));
        assert.deepStrictEqual(
          { untracked, tracked, subjects: subjectsSince(root, "backend", start) },
          {
            untracked: { _tag: "checked", edits: false },
            tracked: { _tag: "checked", edits: true },
            subjects: [],
          },
        );
      }),
    ),
  );

  it.effect("parks a lane whose turn moved a ref nobody explains", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const handler = yield* makeCheckpoint;
        yield* createLane("backend");
        const integration = yield* CrewIntegration.CrewIntegration;
        yield* integration.snapshotRefs(laneKey("backend"));
        git(root, ["tag", "sneaky"]);
        git(root, ["update-ref", "refs/t3/crew/landing/a-2", "HEAD"]);
        const policed = okValue(
          yield* attempt(handler, row(1, { ...PAYLOAD, explained: ["refs/t3/crew/landing/a-2"] })),
        ) as { readonly changes: ReadonlyArray<{ readonly ref: string }> };
        assert.deepStrictEqual(
          policed.changes.map((change) => change.ref),
          ["refs/tags/sneaky"],
        );
      }),
    ),
  );
});
