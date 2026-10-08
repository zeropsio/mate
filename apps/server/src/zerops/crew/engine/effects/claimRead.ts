/**
 * `crew.claim.read` (replay-safe, lane `host/<host>`): what the host's dev server serves now —
 * your tree, a crewmate's copy, or nothing it can name — read from zcp's dev-server process
 * (`CrewRuntime.served`, unchanged). The crew's decider moves the Show-on-dev claim by it
 * (`claimEventFromServed`); the read itself writes nothing, so a re-run reads dev again.
 *
 * @module zerops/crew/engine/effects/claimRead
 */
import * as Effect from "effect/Effect";
import type { CrewServed } from "@t3tools/contracts";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewRuntime } from "../../CrewRuntime.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, settled } from "./shared.ts";

export interface ClaimReadPayload {
  readonly host: string;
}

export interface ClaimReadValue {
  readonly served: CrewServed;
}

export const makeClaimRead = Effect.gen(function* () {
  const runtime = yield* CrewRuntime;
  return {
    kind: CREW_EFFECT_KINDS.claimRead,
    run: (row) =>
      settled(
        Effect.map(runtime.served(payloadOf<ClaimReadPayload>(row).host), (served) =>
          done({ served } satisfies ClaimReadValue),
        ),
      ),
  } satisfies EffectHandler;
});
