/**
 * `session.close` (process-bound, lane `control`): stops the session, with no recovery —
 * ProviderService never re-creates a session to close it. An idle close keeps a session whose
 * background work still lives.
 *
 * @module engine/effects/sessionClose
 */
import * as Effect from "effect/Effect";
import type { SessionCloseReason } from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { SessionCloseAsk } from "../bridge/spi3.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { TurnPump } from "../pump/TurnPump.ts";
import { ok, recovering } from "./shared.ts";

/** What a session close asks of the bridge, by the engine's reason. */
const askOf = (reason: SessionCloseReason): SessionCloseAsk =>
  reason === "model" ? "rotate" : reason === "idle" ? "idle" : "asked";

export const makeSessionClose = Effect.gen(function* () {
  const provider = yield* ProviderService;
  const pump = yield* TurnPump;

  return {
    kind: "session.close",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as {
          readonly sessionId: string;
          readonly reason: SessionCloseReason;
        };
        const host = yield* pump.existing(row.conversationId);
        // Not the host's session any more (it closed, or a restart came between): nothing to do.
        if (host === undefined || (yield* host.current) !== payload.sessionId) return ok();
        if (payload.reason === "idle" && (yield* host.liveWork) > 0) return ok({ kept: true });
        yield* host.record({ kind: "stop", cause: askOf(payload.reason) });
        yield* provider.stopSession({ threadId: host.thread }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("engine: a session would not stop; it is closed for the engine", {
              cause,
            }),
          ),
        );
        yield* host.record({ kind: "stopped" });
        return ok();
      }).pipe(Effect.catchCause(recovering)),
  } satisfies EffectHandler;
});
