import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as CrewApp from "../../CrewApp.ts";
import {
  attempt,
  createLane,
  effectRow,
  okValue,
  withCrewEffects,
} from "../../testing/crewEffectFixture.ts";
import {
  alive,
  exists,
  read,
  remoteEnvWithSetsid,
  TEST_HOST,
  waitUntil,
} from "../../testing/crewGitFixture.ts";
import { makeAppStop } from "./appStop.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

const LANE = { host: TEST_HOST, handle: "backend" } as const;

/** Starts a child and waits - like a dev server; the child's pid lands beside the copy. */
const DEV_SERVER = 'sleep 30 & printf "%s" "$!" > ../backend.child; wait';

const row = (attemptNumber = 1) =>
  effectRow(CREW_EFFECT_KINDS.appStop, LANE, {
    effectId: "crew/main/e/crew.app.stop/1",
    attempt: attemptNumber,
  });

const SETSID = { remoteEnv: remoteEnvWithSetsid() };

describe("crew.app.stop", () => {
  it.effect("stops a crewmate's app and everything it started", () =>
    withCrewEffects(
      (root) =>
        Effect.gen(function* () {
          const handler = yield* makeAppStop;
          const app = yield* CrewApp.CrewApp;
          yield* createLane("backend");
          const started = yield* app.run({ ...LANE, command: DEV_SERVER, port: 3001 });
          waitUntil(() => exists(root, ".crew/backend.child"));
          const pid = started.state === "running" ? started.pid : -1;
          const child = Number(read(root, ".crew/backend.child"));
          const stopped = okValue(yield* attempt(handler, row()));
          waitUntil(() => !alive(pid) && !alive(child));
          assert.deepStrictEqual(
            { stopped, gone: [alive(pid), alive(child)] },
            { stopped: { state: "stopped" }, gone: [false, false] },
          );
        }),
      SETSID,
    ),
  );

  it.effect("a stop the restart cut after the app ended reads it stopped and signals nothing", () =>
    withCrewEffects(
      () =>
        Effect.gen(function* () {
          const handler = yield* makeAppStop;
          const app = yield* CrewApp.CrewApp;
          yield* createLane("backend");
          yield* app.run({ ...LANE, command: DEV_SERVER, port: 3001 });
          // The cut attempt's stop went through on the service.
          yield* app.stop(LANE);
          const again = okValue(yield* attempt(handler, row(2)));
          assert.deepStrictEqual(
            { again, status: yield* app.status(LANE) },
            { again: { state: "stopped" }, status: { state: "stopped" } },
          );
        }),
      SETSID,
    ),
  );
});
