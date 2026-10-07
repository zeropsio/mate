/**
 * `provider.steer` (process-bound, lane `turn`): a person's message into the running turn, only
 * on a driver that really takes one (Claude, OpenCode); it settles on the bridge's evidence, as a
 * send does.
 *
 * @module engine/effects/providerSteer
 */
import * as Effect from "effect/Effect";
import type { TurnHandle } from "@t3tools/contracts";

import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { makeDeliver, NO_LIVE_SESSION } from "./providerSend.ts";
import { failed, ok, recovering } from "./shared.ts";

interface SteerPayload {
  readonly runId: string;
  readonly sessionId: string;
  readonly itemId: string;
  readonly text: string;
}

export const makeProviderSteer = Effect.gen(function* () {
  const deliver = yield* makeDeliver;
  return {
    kind: "provider.steer",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as SteerPayload;
        const sent = yield* deliver(row, {
          session: payload.sessionId,
          turn: payload.itemId as TurnHandle,
          mode: "steer",
          text: payload.text,
          attachments: [],
        });
        if (!sent.live) return failed(NO_LIVE_SESSION, { undelivered: true });
        const evidence = sent.evidence;
        return evidence._tag === "Accepted"
          ? ok({ as: evidence.as })
          : failed(evidence.words, {
              undelivered: evidence._tag === "Refused" ? evidence.undelivered : "unknown",
            });
      }).pipe(Effect.catchCause(recovering)),
  } satisfies EffectHandler;
});
