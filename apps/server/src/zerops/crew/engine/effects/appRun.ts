/**
 * `crew.app.run` (replay-safe, lane `host/<host>`): a crewmate's own app started in its copy on
 * its crew port, as the dev service's supervisor's runtime entry (`CrewApp.run`).
 *
 * An app's evidence is the supervisor's entry: `run` of one already running as asked starts
 * nothing; without a supervisor that answers, its pidfile naming a live process does the same
 * (`CrewApp`). Run again after a crash, the handler finds the app its earlier attempt started and
 * answers with it, so an app is never started twice.
 *
 * @module zerops/crew/engine/effects/appRun
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewApp, type AppStatus } from "../../CrewApp.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, settled } from "./shared.ts";

export interface AppRunPayload {
  readonly host: string;
  readonly handle: string;
  readonly command: string;
  readonly port: number;
  readonly env?: Readonly<Record<string, string>>;
}

export type AppRunValue = AppStatus;

export const makeAppRun = Effect.gen(function* () {
  const app = yield* CrewApp;
  return {
    kind: CREW_EFFECT_KINDS.appRun,
    run: (row) =>
      settled(
        Effect.map(app.run(payloadOf<AppRunPayload>(row)), (status) =>
          done(status satisfies AppRunValue),
        ),
      ),
  } satisfies EffectHandler;
});
