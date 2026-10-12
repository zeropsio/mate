/**
 * The engine's one admission site (D6): whose login a run or a person's words spend is asked of
 * the `RunAdmission` port here, for every run at its admitted transition (`run.prepare`) and for
 * every steer before it reaches the agent (`provider.steer`).
 *
 * @module engine/effects/admission
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { Principal, RunAdmissionRefusal, RunTrigger } from "@t3tools/contracts";

import { RunAdmission } from "../ports.ts";
import { wordsOf } from "./shared.ts";

/** A refusal: its words, and the login it was for when admission named one. */
export interface AdmitRefusal {
  readonly words: string;
  readonly admission?: RunAdmissionRefusal;
}

/** Asks the door; the refusal, or `null` when admitted. */
export const makeAdmit = Effect.map(
  RunAdmission,
  (admission) =>
    (input: {
      readonly instanceId: string | null;
      readonly principal: Principal;
      readonly trigger: RunTrigger;
    }): Effect.Effect<AdmitRefusal | null> =>
      admission
        .admit({
          instanceId: input.instanceId ?? "",
          principal: input.principal,
          trigger: input.trigger,
        })
        .pipe(
          Effect.as(null),
          Effect.catchTags({
            RunRefused: (refusal): Effect.Effect<AdmitRefusal> =>
              Effect.succeed({
                words: refusal.message,
                ...(refusal.admission === undefined ? {} : { admission: refusal.admission }),
              }),
          }),
          // An admission that broke admits nothing: its words are the refusal's.
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.failCause(cause)
              : Effect.succeed({ words: `The run could not be admitted: ${wordsOf(cause)}` }),
          ),
        ),
);
