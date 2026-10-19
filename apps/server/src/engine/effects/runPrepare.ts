/**
 * `run.prepare` (replay-safe, lane `side`): the run's one admission, before the agent starts
 * work.
 *
 * Admission is asked here, for the run's principal and trigger, at the run's admitted
 * transition; a refusal, or an admission that broke, ends the run with its words before anything
 * of it ran.
 *
 * @module engine/effects/runPrepare
 */
import * as Effect from "effect/Effect";
import type { Principal, RunTrigger } from "@t3tools/contracts";

import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { makeAdmit } from "./admission.ts";
import { failed, ok } from "./shared.ts";

interface Payload {
  readonly runId: string;
  readonly instanceId: string | null;
  readonly principal: Principal;
  readonly trigger: RunTrigger;
}

export const makeRunPrepare = Effect.gen(function* () {
  const admit = yield* makeAdmit;
  return {
    kind: "run.prepare",
    run: (row) =>
      Effect.gen(function* () {
        // Admission's outcome is its own: refused or broken, the run never goes without it.
        const refused = yield* admit(row.payload as Payload);
        if (refused !== null)
          return failed(refused.words, {
            refused: true,
            ...(refused.admission === undefined ? {} : { admission: refused.admission }),
          });
        return ok();
      }),
  } satisfies EffectHandler;
});
