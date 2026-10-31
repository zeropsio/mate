/**
 * `provider.send` (process-bound, lane `turn`): a message into the session.
 *
 * Nothing is sent without a live session: the send is refused as undelivered, and the engine
 * opens a session and sends once more. The send is recorded before the driver is called, the call
 * runs in the session's scope (Cursor, Grok and Antigravity return only when the turn ends), and
 * the effect settles on the bridge's evidence: the driver took the message (into a new turn, or
 * steered into the running one), refused it, or its session closed first. So the lane frees while
 * the turn runs and a Stop or an answer never waits behind it. Past the call nothing is retried:
 * a message is never sent twice.
 *
 * @module engine/effects/providerSend
 */
import * as Effect from "effect/Effect";
import type {
  ChatAttachment,
  ModelSelection,
  ProviderInteractionMode,
  TurnHandle,
  RunId,
} from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import type { SendMode } from "../bridge/spi3.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import type { EffectRow } from "../outbox/EffectOutbox.ts";
import { TurnPump } from "../pump/TurnPump.ts";
import { Conversations } from "../Conversations.ts";
import { failed, isSessionGone, liveHost, ok, recovering, wordsOf } from "./shared.ts";

/** What a send that found no live session reads: nothing went, so it may go again. */
export const NO_LIVE_SESSION = "The session was not live; nothing was sent.";

interface SendPayload {
  readonly runId: string;
  readonly sessionId: string;
  readonly turn: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  /** The conversation's model and options: a session applies those it takes per turn. */
  readonly modelSelection?: ModelSelection;
  /** Absent: default. */
  readonly interactionMode?: ProviderInteractionMode;
}

/** Records a send, makes the call in the session's scope, and waits on the bridge's evidence. */
export const makeDeliver = Effect.gen(function* () {
  const provider = yield* ProviderService;
  const pump = yield* TurnPump;
  const conversations = yield* Conversations;
  return Effect.fnUntraced(function* (
    row: EffectRow,
    input: {
      readonly session: string;
      readonly runId: string;
      readonly turn: TurnHandle;
      readonly mode: SendMode;
      readonly text: string;
      readonly attachments: ReadonlyArray<ChatAttachment>;
      readonly modelSelection?: ModelSelection | undefined;
      readonly interactionMode?: ProviderInteractionMode | undefined;
    },
  ) {
    const host = yield* liveHost(provider, yield* pump.existing(row.conversationId), input.session);
    if (host === undefined) return { live: false as const };
    const evidence = yield* host.beginSend(input.turn, input.mode);
    const trimmed = input.text.trim();
    const owner = yield* conversations.state(row.conversationId);
    const run = owner.runs[input.runId as RunId];
    const invocationRequired = run === undefined || run.principal.kind === "task";
    yield* host.forkInSession(
      provider
        .sendTurn({
          threadId: host.thread,
          invocationContext: input.runId,
          invocationRequired,
          ...(trimmed === "" ? {} : { input: input.text }),
          ...(input.attachments.length === 0 ? {} : { attachments: input.attachments }),
          ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
          ...(input.interactionMode === undefined
            ? {}
            : { interactionMode: input.interactionMode }),
        })
        .pipe(
          Effect.matchCauseEffect({
            onSuccess: (result) =>
              host.record({
                kind: "sent",
                turn: input.turn,
                nativeTurn: String(result.turnId),
                ...(result.resumeCursor === undefined ? {} : { resume: result.resumeCursor }),
              }),
            onFailure: (cause) =>
              host.record({
                kind: "send-failed",
                turn: input.turn,
                words: wordsOf(cause),
                sessionGone: cause.reasons.some(
                  (reason) => reason._tag === "Fail" && isSessionGone(reason.error),
                ),
              }),
          }),
        ),
    );
    return { live: true as const, host, evidence: yield* evidence };
  });
});

export const makeProviderSend = Effect.gen(function* () {
  const deliver = yield* makeDeliver;

  const send: EffectHandler = {
    kind: "provider.send",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as SendPayload;
        const turn = payload.turn as TurnHandle;
        const sent = yield* deliver(row, {
          session: payload.sessionId,
          runId: payload.runId,
          turn,
          mode: "new",
          text: payload.text,
          attachments: payload.attachments ?? [],
          modelSelection: payload.modelSelection,
          interactionMode: payload.interactionMode,
        });
        if (!sent.live) return failed(NO_LIVE_SESSION, { undelivered: true });
        const evidence = sent.evidence;
        switch (evidence._tag) {
          case "Refused":
            return failed(evidence.words, { undelivered: evidence.undelivered });
          case "Closed":
            return failed(evidence.words, { undelivered: "unknown" });
          case "Accepted": {
            const native = yield* sent.host.nativeTurn(turn);
            return ok({
              turn: evidence.as === "steered" && evidence.into !== null ? evidence.into : turn,
              providerTurnId: native ?? null,
            });
          }
        }
      }).pipe(Effect.catchCause(recovering)),
  };

  return send;
});
