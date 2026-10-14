/**
 * `crew.app.run` (replay-safe, lane `host/<host>`): a crewmate's own app started in its copy on
 * its crew port, as the dev service's supervisor's runtime entry (`CrewApp.run`).
 *
 * An app's evidence is the supervisor's entry: `run` of one already running as asked starts
 * nothing. Run again after a crash, the handler finds the app its earlier attempt started and
 * answers with it, so an app is never started twice. A dev service without the supervisor fails
 * the run at once: trying again changes nothing until its dev setup runs one.
 *
 * @module zerops/crew/engine/effects/appRun
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewApp, type AppStatus } from "../../CrewApp.ts";
import { CREW_EFFECT_KINDS, done, failedFor, payloadOf, settled } from "./shared.ts";

export interface AppRunPayload {
  readonly host: string;
  readonly handle: string;
  readonly command: string;
  readonly port: number;
  readonly env?: Readonly<Record<string, string>>;
}

export type AppRunValue = Exclude<AppStatus, { readonly state: "no-supervisor" }>;

/** Why a crew app cannot run on a dev service whose dev setup has no supervisor. */
export const noSupervisorWords = (host: string): string =>
  `${host} runs no dev-server supervisor; its dev setup needs \`zcp-devsup run\` as run.start to run crew apps`;

export const makeAppRun = Effect.gen(function* () {
  const app = yield* CrewApp;
  return {
    kind: CREW_EFFECT_KINDS.appRun,
    run: (row) =>
      settled(
        Effect.map(app.run(payloadOf<AppRunPayload>(row)), (status) =>
          status.state === "no-supervisor"
            ? failedFor(noSupervisorWords(payloadOf<AppRunPayload>(row).host))
            : done(status satisfies AppRunValue),
        ),
      ),
  } satisfies EffectHandler;
});
