/**
 * `provider.steer` (process-bound, lane `turn`): a person's message into the running turn, only
 * on a driver that really takes one (Claude, OpenCode), admitted for the person steering first;
 * it settles on the bridge's evidence, as a send does.
 *
 * @module engine/effects/providerSteer
 */
import * as Effect from "effect/Effect";
import type { Principal, TurnHandle } from "@t3tools/contracts";

import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { makeAdmit } from "./admission.ts";
import { makeDeliver, NO_LIVE_SESSION } from "./providerSend.ts";
import { failed, ok, recovering } from "./shared.ts";

interface SteerPayload {
  readonly runId: string;
  readonly sessionId: string;
  readonly itemId: string;
  readonly text: string;
  /** Whose words these are, on whose agent (absent from a payload a build before them wrote). */
  readonly instanceId?: string | null;
  readonly principal?: Principal;
}

export const makeProviderSteer = Effect.gen(function* () {
  const deliver = yield* makeDeliver;
  const admit = yield* makeAdmit;
  return {
    kind: "provider.steer",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as SteerPayload;
        // The person steering spends the agent's login as a send would: asked first (D6).
        if (payload.principal !== undefined) {
          const refused = yield* admit({
            instanceId: payload.instanceId ?? null,
            principal: payload.principal,
            trigger: { kind: "person", itemId: payload.itemId as never },
          });
          if (refused !== null) return failed(refused, { undelivered: true });
        }
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
