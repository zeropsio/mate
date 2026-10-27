import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { attempt, effectRow, withCrewEffects } from "../../testing/crewEffectFixture.ts";
import { exists, TEST_HOST, TEST_IDENTITY } from "../../testing/crewGitFixture.ts";
import { makeCheckpoint } from "./checkpoint.ts";
import { makeInspect } from "./inspect.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const inspect = (host: string) =>
  effectRow(CREW_EFFECT_KINDS.inspect, { host, handles: [], landings: [] });

describe("crew effects' failures", () => {
  it.effect("a service that answers as another one fails at once, and nothing runs on it", () =>
    withCrewEffects(
      (root) =>
        Effect.gen(function* () {
          const handler = yield* makeInspect;
          const result = yield* attempt(handler, inspect(TEST_HOST));
          assert.deepStrictEqual(
            { result, wrote: exists(root, ".crew") },
            {
              result: {
                _tag: "Done",
                outcome: {
                  kind: "failed",
                  reason: `Crew shell on '${TEST_HOST}' failed (identity): Mate remote workspace identity mismatch`,
                },
              },
              wrote: false,
            },
          );
        }),
      { remoteEnv: { projectId: TEST_IDENTITY.projectId, serviceId: "another-service" } },
    ),
  );

  it.effect("a host whose binding is not verified yet is tried again, in its words", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const handler = yield* makeInspect;
        const result = yield* attempt(handler, inspect("nowhere"));
        assert.deepStrictEqual(result, {
          _tag: "Retry",
          reason:
            "Crew shell on 'nowhere' failed (unverified): no verified repository binding for this host",
        });
      }),
    ),
  );

  it.effect("a copy nobody recorded fails at once, naming it", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const handler = yield* makeCheckpoint;
        const result = yield* attempt(
          handler,
          effectRow(CREW_EFFECT_KINDS.checkpoint, {
            handle: "ghost",
            assignment: "a-1",
            turn: 1,
            explained: [],
          }),
        );
        assert.deepStrictEqual(result, {
          _tag: "Done",
          outcome: { kind: "failed", reason: "No lane is recorded for main/ghost" },
        });
      }),
    ),
  );
});
