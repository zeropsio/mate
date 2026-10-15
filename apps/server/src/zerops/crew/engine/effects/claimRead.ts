/**
 * `crew.claim.read` (replay-safe, lane `host/<host>`): what the host's dev server serves now —
 * your tree, a crewmate's copy, or nothing it can name — and the declared dev server a claim
 * stands a copy in for, read from the dev service's supervisor (`CrewRuntime.devServer`). The
 * crew's decider moves the Show-on-dev claim by it (`claimEventFromServed`); the read itself
 * writes nothing, so a re-run reads dev again.
 *
 * @module zerops/crew/engine/effects/claimRead
 */
import * as Effect from "effect/Effect";
import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewRuntime, type DevServerReading } from "../../CrewRuntime.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, settled } from "./shared.ts";

export interface ClaimReadPayload {
  readonly host: string;
}

export type ClaimReadValue = DevServerReading;

export const makeClaimRead = Effect.gen(function* () {
  const runtime = yield* CrewRuntime;
  return {
    kind: CREW_EFFECT_KINDS.claimRead,
    run: (row) =>
      settled(
        Effect.map(runtime.devServer(payloadOf<ClaimReadPayload>(row).host), (reading) =>
          done(reading satisfies ClaimReadValue),
        ),
      ),
  } satisfies EffectHandler;
});
