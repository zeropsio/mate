/**
 * `session.close` (process-bound, lane `control`): stops the session, with no recovery —
 * ProviderService never re-creates a session to close it. An idle close keeps a session whose
 * background work still lives.
 *
 * @module engine/effects/sessionClose
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { SessionCloseReason } from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { SessionCloseAsk } from "../bridge/spi3.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { TurnPump } from "../pump/TurnPump.ts";
import { bounded, ok, recovering, timedOut } from "./shared.ts";

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
        const stopped = yield* bounded(provider.stopSession({ threadId: host.thread })).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.failCause(cause)
              : Effect.as(
                  Effect.logWarning(
                    "engine: a session would not stop; it is closed for the engine",
                    { cause },
                  ),
                  Option.some(void 0),
                ),
          ),
        );
        // Closed for the engine either way: nothing more goes into it.
        yield* host.record({ kind: "stopped" });
        return Option.isNone(stopped) ? timedOut : ok();
      }).pipe(Effect.catchCause(recovering)),
  } satisfies EffectHandler;
});
