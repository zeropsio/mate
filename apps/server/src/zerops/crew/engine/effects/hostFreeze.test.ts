import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

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
import { makeCheckpoint } from "./checkpoint.ts";
import { makeHostFreeze } from "./hostFreeze.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const row = (host = TEST_HOST, attemptNumber = 1) =>
  effectRow(
    CREW_EFFECT_KINDS.hostFreeze,
    { host },
    { effectId: "crew/main/e/crew.host.freeze/1", attempt: attemptNumber },
  );

const frozenSince = Effect.map(
  Effect.flatMap(CrewStore.CrewStore, (store) => store.lanesOnHost(TEST_HOST)),
  (lanes) => lanes.map((lane) => [lane.lane, lane.frozenSince] as const),
);

describe("crew.host.freeze", () => {
  it.effect("writes nothing into a frozen host's copies: a turn's checkpoint answers frozen", () =>
    withCrewEffects((root) =>
      Effect.gen(function* () {
        const freeze = yield* makeHostFreeze;
        const checkpoint = yield* makeCheckpoint;
        yield* createLane("backend");
        yield* createLane("frontend");
        const start = git(`${root}/.crew/backend`, ["rev-parse", "HEAD"]);
        const frozen = okValue(yield* attempt(freeze, row()));
        write(`${root}/.crew/backend`, "src/score.ts", "export const score = 1;\n");
        const saved = okValue(
          yield* attempt(
            checkpoint,
            effectRow(CREW_EFFECT_KINDS.checkpoint, {
              handle: "backend",
              assignment: "a-1",
              turn: 1,
              explained: [],
            }),
          ),
        );
        assert.deepStrictEqual(
          {
            frozen,
            saved,
            subjects: subjectsSince(root, "backend", start),
            every: (yield* frozenSince).every(([, since]) => since !== null),
          },
          {
            frozen: { lanes: ["backend", "frontend"] },
            saved: { _tag: "saved", commit: { _tag: "frozen" }, changes: [] },
            subjects: [],
            every: true,
          },
        );
      }),
    ),
  );

  it.effect("a freeze the restart cut after it was written keeps the time the deploy began", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const freeze = yield* makeHostFreeze;
        yield* createLane("backend");
        yield* attempt(freeze, row(TEST_HOST, 1));
        const first = yield* frozenSince;
        yield* TestClock.adjust("1 minute");
        const again = okValue(yield* attempt(freeze, row(TEST_HOST, 2)));
        assert.deepStrictEqual(
          { again, since: yield* frozenSince },
          { again: { lanes: ["backend"] }, since: first },
        );
      }),
    ),
  );

  it.effect("a host with no copies freezes nothing, and says so", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const freeze = yield* makeHostFreeze;
        yield* createLane("backend");
        const none = okValue(yield* attempt(freeze, row("apidev")));
        assert.deepStrictEqual(
          { none, untouched: yield* frozenSince },
          { none: { lanes: [] }, untouched: [["backend", null]] },
        );
      }),
    ),
  );
});
