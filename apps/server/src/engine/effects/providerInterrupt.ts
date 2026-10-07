/**
 * `provider.interrupt` (process-bound, lane `control`): asks the driver to stop the run's turn.
 * Its return only records that it was asked; the run ends on its turn's own end. With no live
 * session nothing is called, and the Stop ends the run there and then.
 *
 * @module engine/effects/providerInterrupt
 */
import * as Effect from "effect/Effect";
import type { TurnHandle, TurnId } from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { TurnPump } from "../pump/TurnPump.ts";
import { failed, liveHost, ok, recovering } from "./shared.ts";

export const makeProviderInterrupt = Effect.gen(function* () {
  const provider = yield* ProviderService;
  const pump = yield* TurnPump;

  return {
    kind: "provider.interrupt",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as {
          readonly sessionId: string | null;
          readonly turn: string | null;
          readonly providerTurnId: string | null;
        };
        const host = yield* liveHost(
          provider,
          yield* pump.existing(row.conversationId),
          payload.sessionId,
        );
        if (host === undefined) return failed("No live session to stop.");
        const turn = payload.turn as TurnHandle | null;
        if (turn !== null) yield* host.record({ kind: "interrupt", turn });
        const native =
          (turn === null ? undefined : yield* host.nativeTurn(turn)) ??
          payload.providerTurnId ??
          undefined;
        yield* provider.interruptTurn({
          threadId: host.thread,
          ...(native === undefined ? {} : { turnId: native as TurnId }),
        });
        return ok();
      }).pipe(Effect.catchCause(recovering)),
  } satisfies EffectHandler;
});
