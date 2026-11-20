/**
 * `crew.deliver` (replay-safe): the crew talking to a crewmate's
 * conversation — a send as the person or the run's starter, a card, a Stop, a rotation, an
 * assignment — as one engine command.
 *
 * Its command id is derived from the effect id (`crew-deliver:<effectId>`), so the conversation's
 * receipt is its evidence: run again after a crash, the same command is told again and the engine
 * answers with the receipt it stored, never acting twice. A command the conversation refuses is the
 * effect's failure, refused for good, in the conversation's words.
 *
 * The conversation is told through the engine's `Conversations.tell`.
 *
 * @module zerops/crew/engine/effects/deliver
 */
import * as Effect from "effect/Effect";
import {
  CommandId,
  type CommandResult,
  type ConversationId,
  type Principal,
} from "@t3tools/contracts";

import { Conversations } from "../../../../engine/Conversations.ts";
import type { Command } from "../../../../engine/domain/command.ts";
import type { EffectHandler, HandlerResult } from "../../../../engine/outbox/EffectWorker.ts";
import { CREW_EFFECT_KINDS, done, payloadOf } from "./shared.ts";

export interface DeliverPayload {
  /** The crewmate whose conversation it is: its lane, `deliver/<handle>`. */
  readonly handle: string;
  readonly conversationId: ConversationId;
  /** The person, or the run's starter, the command acts for. */
  readonly principal: Principal;
  readonly command: Command;
  /** Told instead when `command` is refused (a steer whose run no longer takes it). */
  readonly fallback?: Command;
}

export type DeliverValue = Omit<Extract<CommandResult, { readonly _tag: "Accepted" }>, "_tag">;

import { deliveryCommandId } from "../command.ts";

export { deliveryCommandId, deliveryOfCommand } from "../command.ts";

export const makeDeliver = Effect.gen(function* () {
  const conversations = yield* Conversations;
  return {
    kind: CREW_EFFECT_KINDS.deliver,
    run: (row) =>
      Effect.gen(function* () {
        const payload = payloadOf<DeliverPayload>(row);
        const tell = (command: Command, commandId: string) =>
          conversations.tell({
            commandId: CommandId.make(commandId),
            conversationId: payload.conversationId,
            principal: payload.principal,
            command,
          });
        const first = yield* tell(
          payload.command,
          payload.fallback === undefined
            ? deliveryCommandId(row.effectId)
            : `${deliveryCommandId(row.effectId)}:joined`,
        );
        const result =
          first._tag === "Rejected" && payload.fallback !== undefined
            ? yield* tell(payload.fallback, deliveryCommandId(row.effectId))
            : first;
        if (result._tag === "Rejected") {
          return {
            _tag: "Done",
            outcome: {
              kind: "failed",
              reason: result.rejection.detail ?? result.rejection.reason,
              refused: true,
            },
          } satisfies HandlerResult;
        }
        const { _tag: _accepted, ...value } = result;
        return done(value satisfies DeliverValue);
      }).pipe(
        // The step was not committed: told again, with backoff; the receipt dedupes it.
        Effect.catch((error) =>
          Effect.succeed<HandlerResult>({ _tag: "Retry", reason: error.message }),
        ),
      ),
  } satisfies EffectHandler;
});
