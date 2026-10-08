/**
 * `provider.respond` (process-bound, lane `control`): answers a request by the driver's own id,
 * with the call its kind takes. A request the driver no longer waits on (closed, or its session
 * gone) cannot be answered: the refusal expires it. Any other failure reopens it for the person.
 *
 * @module engine/effects/providerRespond
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ProviderApprovalDecision,
  type ApprovalRequestId,
  type ProviderUserInputAnswers,
} from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { RequestKey } from "../bridge/spi3.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { TurnPump } from "../pump/TurnPump.ts";
import { bounded, failed, liveHost, ok, recovering, timedOut } from "./shared.ts";

/** An answer the agent can no longer take. */
export const NOT_WAITING = "The agent no longer waits on this answer.";

const isDecision = Schema.is(ProviderApprovalDecision);

export const makeProviderRespond = Effect.gen(function* () {
  const provider = yield* ProviderService;
  const pump = yield* TurnPump;

  return {
    kind: "provider.respond",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as {
          readonly key: string;
          readonly sessionId: string | null;
          readonly answer: unknown;
        };
        const host = yield* liveHost(
          provider,
          yield* pump.existing(row.conversationId),
          payload.sessionId,
        );
        if (host === undefined) return failed(NOT_WAITING, { refused: true });
        const key = payload.key as RequestKey;
        const native = yield* host.nativeRequest(key);
        if (native === undefined) return failed(NOT_WAITING, { refused: true });
        const requestId = native.id as ApprovalRequestId;
        yield* host.record({ kind: "respond", request: key });
        if (native.kind === "approval") {
          const answer = payload.answer as { readonly decision?: unknown } | string;
          const decision = typeof answer === "string" ? answer : answer?.decision;
          if (!isDecision(decision)) return failed(`Not an approval decision: ${String(decision)}`);
          const answered = yield* bounded(
            provider.respondToRequest({ threadId: host.thread, requestId, decision }),
          );
          if (Option.isNone(answered)) return timedOut;
        } else {
          const answer = payload.answer as { readonly answers?: unknown } | null;
          const answers = (
            typeof answer === "object" && answer !== null && "answers" in answer
              ? answer.answers
              : answer
          ) as ProviderUserInputAnswers;
          const answered = yield* bounded(
            provider.respondToUserInput({ threadId: host.thread, requestId, answers }),
          );
          if (Option.isNone(answered)) return timedOut;
        }
        return ok();
      }).pipe(Effect.catchCause(recovering)),
  } satisfies EffectHandler;
});
