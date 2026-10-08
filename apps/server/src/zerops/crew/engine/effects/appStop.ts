/**
 * `crew.app.stop` (replay-safe, lane `host/<host>`): a crewmate's own app stopped with everything
 * it started — TERM to its process group, KILL after the grace (`CrewApp.stop`, unchanged).
 *
 * A stopped app's evidence is its pidfile gone or naming no live process: a re-run after a crash
 * that finds it so signals nothing and answers stopped.
 *
 * @module zerops/crew/engine/effects/appStop
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewApp, type AppLane, type AppStatus } from "../../CrewApp.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, settled } from "./shared.ts";

export type AppStopPayload = AppLane;

export type AppStopValue = AppStatus;

export const makeAppStop = Effect.gen(function* () {
  const app = yield* CrewApp;
  return {
    kind: CREW_EFFECT_KINDS.appStop,
    run: (row) =>
      settled(
        Effect.map(app.stop(payloadOf<AppStopPayload>(row)), (status) =>
          done(status satisfies AppStopValue),
        ),
      ),
  } satisfies EffectHandler;
});
