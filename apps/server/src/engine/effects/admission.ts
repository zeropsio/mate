/**
 * The engine's one admission site (D6): whose login a run or a person's words spend is asked of
 * the `RunAdmission` port here, for every run at its admitted transition (`run.prepare`) and for
 * every steer before it reaches the agent (`provider.steer`).
 *
 * @module engine/effects/admission
 */
import * as Effect from "effect/Effect";
import type { Principal, RunTrigger } from "@t3tools/contracts";

import { RunAdmission } from "../ports.ts";

/** Asks the door; the refusal's words, or `null` when admitted. */
export const makeAdmit = Effect.map(
  RunAdmission,
  (admission) =>
    (input: {
      readonly instanceId: string | null;
      readonly principal: Principal;
      readonly trigger: RunTrigger;
    }): Effect.Effect<string | null> =>
      admission
        .admit({
          instanceId: input.instanceId ?? "",
          principal: input.principal,
          trigger: input.trigger,
        })
        .pipe(
          Effect.as(null),
          Effect.catchTag("RunRefused", (refusal) => Effect.succeed(refusal.message)),
        ),
);
