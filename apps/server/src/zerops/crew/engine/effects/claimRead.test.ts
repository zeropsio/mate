// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  attempt,
  createLane,
  devServerPidFile,
  effectRow,
  okValue,
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import { TEST_HOST } from "../../testing/crewGitFixture.ts";
import { makeClaimRead } from "./claimRead.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const row = (attemptNumber = 1) =>
  effectRow(
    CREW_EFFECT_KINDS.claimRead,
    { host: TEST_HOST },
    { effectId: "crew/main/e/crew.claim.read/1", attempt: attemptNumber },
  );

/** zcp's dev server as its pidfile names it: a process whose cwd is `cwd`. */
const devServer = (root: string, cwd: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const child = NodeChildProcess.spawn("sleep", ["30"], { cwd, stdio: "ignore" });
      NodeFS.writeFileSync(devServerPidFile(root), `${child.pid}\n`);
      return child;
    }),
    (child) =>
      Effect.sync(() => {
        child.kill("SIGKILL");
        NodeFS.rmSync(devServerPidFile(root), { force: true });
      }),
  );

describe("crew.claim.read", () => {
  it.effect("reads what dev serves: your tree, a crewmate's copy, or nothing it can name", () =>
    withCrewEffects((root) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handler = yield* makeClaimRead;
          yield* createLane("backend");
          const nothing = okValue(yield* attempt(handler, row()));
          const lane = yield* Effect.scoped(
            Effect.andThen(devServer(root, NodePath.join(root, ".crew/backend")), () =>
              Effect.map(attempt(handler, row()), okValue),
            ),
          );
          const tree = yield* Effect.scoped(
            Effect.andThen(devServer(root, root), () =>
              Effect.map(attempt(handler, row()), okValue),
            ),
          );
          assert.deepStrictEqual(
            { nothing, lane, tree },
            {
              nothing: { served: { by: "unknown" } },
              lane: { served: { by: "crewmate", handle: "backend" } },
              tree: { served: { by: "tree" } },
            },
          );
        }),
      ),
    ),
  );

  it.effect("a claim read the restart cut reads dev again and moves nothing", () =>
    withCrewEffects((root) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handler = yield* makeClaimRead;
          yield* createLane("backend");
          yield* devServer(root, NodePath.join(root, ".crew/backend"));
          const first = okValue(yield* attempt(handler, row(1)));
          const again = okValue(yield* attempt(handler, row(2)));
          assert.deepStrictEqual(
            { first, again },
            {
              first: { served: { by: "crewmate", handle: "backend" } },
              again: { served: { by: "crewmate", handle: "backend" } },
            },
          );
        }),
      ),
    ),
  );
});
