/**
 * `crew.deliver` (replay-safe, lane `deliver/<handle>`): the crew talking to a crewmate's
 * conversation — a send as the person or the run's starter, a card, a Stop, a rotation, an
 * assignment — as one engine command.
 *
 * Its command id is derived from the effect id (`crew-deliver:<effectId>`), so the conversation's
 * receipt is its evidence: run again after a crash, the same command is told again and the engine
 * answers with the receipt it stored, never acting twice. A command the conversation refuses is the
 * effect's failure, refused for good, in the conversation's words.
 *
 * The conversation is reached through {@link CrewDelivery}: the engine's own `Conversations.tell`
 * by default ({@link crewDeliveryLayer}); the wiring may route it through `MateEngine.deliver`.
 *
 * @module zerops/crew/engine/effects/deliver
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CommandId,
  type CommandResult,
  type ConversationId,
  type EffectId,
  type Principal,
} from "@t3tools/contracts";

import type { StepFailure } from "../../../../engine/ConversationActor.ts";
import { Conversations } from "../../../../engine/Conversations.ts";
import type { Command, Envelope } from "../../../../engine/domain/command.ts";
import type { EffectHandler, HandlerResult } from "../../../../engine/outbox/EffectWorker.ts";
import type { EngineStoreError } from "../../../../engine/store/EngineStore.ts";
import { CREW_EFFECT_KINDS, done, payloadOf } from "./shared.ts";

export interface CrewDeliveryShape {
  /** Tells a conversation one command; returns once its step is committed, or why it was refused. */
  readonly deliver: (
    envelope: Envelope,
  ) => Effect.Effect<CommandResult, StepFailure | EngineStoreError>;
}

/** Where crew's deliveries reach the conversations. */
export class CrewDelivery extends Context.Service<CrewDelivery, CrewDeliveryShape>()(
  "t3/zerops/crew/engine/effects/deliver/CrewDelivery",
) {}

/** Deliveries told straight to the engine's conversations. */
export const crewDeliveryLayer = Layer.effect(
  CrewDelivery,
  Effect.map(Conversations, (conversations) => ({ deliver: conversations.tell })),
);

export interface DeliverPayload {
  /** The crewmate whose conversation it is: its lane, `deliver/<handle>`. */
  readonly handle: string;
  readonly conversationId: ConversationId;
  /** The person, or the run's starter, the command acts for. */
  readonly principal: Principal;
  readonly command: Command;
}

export type DeliverValue = Omit<Extract<CommandResult, { readonly _tag: "Accepted" }>, "_tag">;

/** One delivery's command id: the same for every attempt of one effect. */
export const deliveryCommandId = (effect: EffectId): CommandId =>
  CommandId.make(`crew-deliver:${effect}`);

export const makeDeliver = Effect.gen(function* () {
  const delivery = yield* CrewDelivery;
  return {
    kind: CREW_EFFECT_KINDS.deliver,
    run: (row) =>
      Effect.gen(function* () {
        const payload = payloadOf<DeliverPayload>(row);
        const result = yield* delivery.deliver({
          commandId: deliveryCommandId(row.effectId),
          conversationId: payload.conversationId,
          principal: payload.principal,
          command: payload.command,
        });
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
