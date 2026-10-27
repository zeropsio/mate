// @effect-diagnostics nodeBuiltinImport:off
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  attempt,
  createLane,
  effectRow,
  okValue,
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import {
  DEV_SERVER,
  remoteEnvWithSupervisor,
  serveDev,
  stopSupervised,
  TEST_HOST,
} from "../../testing/crewGitFixture.ts";
import { makeClaimRead } from "./claimRead.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const row = (attemptNumber = 1) =>
  effectRow(
    CREW_EFFECT_KINDS.claimRead,
    { host: TEST_HOST },
    { effectId: "crew/main/e/crew.claim.read/1", attempt: attemptNumber },
  );

/** The supervisor serves dev from `from` until the scope closes. */
const devServer = (root: string, from: Parameters<typeof serveDev>[1]) =>
  Effect.acquireRelease(
    Effect.sync(() => serveDev(root, from)),
    () => Effect.sync(() => stopSupervised(root)),
  );

const SUPERVISED = { remoteEnv: remoteEnvWithSupervisor() };
const DECLARED = { ...DEV_SERVER, cwd: "." };

describe("crew.claim.read", () => {
  it.effect("reads what dev serves: your tree, a crewmate's copy, or nothing it can name", () =>
    withCrewEffects(
      (root) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handler = yield* makeClaimRead;
            yield* createLane("backend");
            const nothing = okValue(yield* attempt(handler, row()));
            const lane = yield* Effect.scoped(
              Effect.andThen(devServer(root, { handle: "backend" }), () =>
                Effect.map(attempt(handler, row()), okValue),
              ),
            );
            const tree = yield* Effect.scoped(
              Effect.andThen(devServer(root, "tree"), () =>
                Effect.map(attempt(handler, row()), okValue),
              ),
            );
            assert.deepStrictEqual(
              { nothing, lane, tree },
              {
                nothing: { served: { by: "unknown" }, devServer: null },
                lane: { served: { by: "crewmate", handle: "backend" }, devServer: DECLARED },
                tree: { served: { by: "tree" }, devServer: DECLARED },
              },
            );
          }),
        ),
      SUPERVISED,
    ),
  );

  it.effect("a claim read the restart cut reads dev again and moves nothing", () =>
    withCrewEffects(
      (root) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handler = yield* makeClaimRead;
            yield* createLane("backend");
            yield* devServer(root, { handle: "backend" });
            const first = okValue(yield* attempt(handler, row(1)));
            const again = okValue(yield* attempt(handler, row(2)));
            const served = { served: { by: "crewmate", handle: "backend" }, devServer: DECLARED };
            assert.deepStrictEqual({ first, again }, { first: served, again: served });
          }),
        ),
      SUPERVISED,
    ),
  );
});
