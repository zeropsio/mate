// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

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
  exists,
  read,
  remoteEnvWithSetsid,
  TEST_HOST,
  waitUntil,
} from "../../testing/crewGitFixture.ts";
import { makeAppRun, type AppRunPayload } from "./appRun.ts";
import { CREW_EFFECT_KINDS } from "./shared.ts";

/** Writes the port it was given and counts its starts, then waits - like a dev server. */
const DEV_SERVER =
  'printf "%s" "$CREW_PORT" > ../backend.port; echo start >> ../backend.starts; echo listening; sleep 30';

const PAYLOAD: AppRunPayload = {
  host: TEST_HOST,
  handle: "backend",
  command: DEV_SERVER,
  port: 3001,
};

const row = (attemptNumber = 1) =>
  effectRow(CREW_EFFECT_KINDS.appRun, PAYLOAD, {
    effectId: "crew/main/e/crew.app.run/1",
    attempt: attemptNumber,
  });

const SETSID = { remoteEnv: remoteEnvWithSetsid() };

/** The app stopped after the test, whatever it asserted. */
const stopAfter = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.ensuring(
    body,
    Effect.flatMap(CrewApp.CrewApp, (app) => app.stop({ host: TEST_HOST, handle: "backend" })).pipe(
      Effect.ignore,
    ),
  );

const starts = (root: string) =>
  exists(root, ".crew/backend.starts")
    ? read(root, ".crew/backend.starts").trim().split("\n").length
    : 0;

describe("crew.app.run", () => {
  it.effect("runs a crewmate's app in its copy on its crew port", () =>
    withCrewEffects(
      (root) =>
        stopAfter(
          Effect.gen(function* () {
            const handler = yield* makeAppRun;
            yield* createLane("backend");
            const started = okValue(yield* attempt(handler, row())) as { readonly pid: number };
            waitUntil(() => exists(root, ".crew/backend.port"));
            assert.deepStrictEqual(
              { started, port: read(root, ".crew/backend.port") },
              { started: { state: "running", pid: started.pid }, port: "3001" },
            );
          }),
        ),
      SETSID,
    ),
  );

  it.effect(
    "an app its run started before the Mate stopped is found running, never started twice",
    () =>
      withCrewEffects(
        (root) =>
          stopAfter(
            Effect.gen(function* () {
              const handler = yield* makeAppRun;
              const app = yield* CrewApp.CrewApp;
              yield* createLane("backend");
              // The cut attempt started the app on the service.
              const first = yield* app.run(PAYLOAD);
              waitUntil(() => exists(root, ".crew/backend.starts"));
              const again = okValue(yield* attempt(handler, row(2)));
              assert.deepStrictEqual({ again, starts: starts(root) }, { again: first, starts: 1 });
            }),
          ),
        SETSID,
      ),
  );

  it.effect("an app on a copy that is gone starts nothing and says the copy is missing", () =>
    withCrewEffects(
      (root) =>
        Effect.gen(function* () {
          const handler = yield* makeAppRun;
          yield* createLane("backend");
          NodeFS.rmSync(`${root}/.crew/backend`, { recursive: true, force: true });
          const missing = okValue(yield* attempt(handler, row()));
          assert.deepStrictEqual(
            { missing, log: exists(root, ".crew/backend.run.log"), starts: starts(root) },
            { missing: { state: "lane-missing" }, log: false, starts: 0 },
          );
        }),
      SETSID,
    ),
  );
});
