/**
 * Ids the engine derives for its own commands, so a retry, a redelivery or a restart converges on
 * one receipt instead of acting twice. The entity ids (run, item, request, effect, wake) live in
 * the contracts; this module re-exports them beside the command ids.
 *
 * @module engine/domain/ids
 */
import {
  CommandId,
  type EffectId,
  type SessionId,
  type BootId,
  type ConversationId,
  type WakeId,
} from "@t3tools/contracts";

export {
  ConversationId,
  EffectId,
  ItemId,
  RequestId,
  RunId,
  SessionId,
  WakeId,
  BootId,
  effectId,
  itemId,
  requestId,
  runId,
  wakeId,
} from "@t3tools/contracts";

/**
 * A wake's firing: one per arming (the sequence of its `WakeArmed`), so a wake armed again — for a
 * recurring wake's next time, or for a moment it already fired at — fires again, and a fire read
 * before a re-arm can never fire the newer arming.
 */
export const wakeFiredCommandId = (wake: WakeId, armedSeq: number): CommandId =>
  CommandId.make(`wake:${wake}#${armedSeq}`);

/** An effect's terminal outcome: settled once, whoever reports it. */
export const effectSettledCommandId = (effect: EffectId): CommandId =>
  CommandId.make(`settle:${effect}`);

/** A boot's recovery of one conversation. */
export const recoveredCommandId = (boot: BootId, conversation: ConversationId): CommandId =>
  CommandId.make(`recover:${boot}:${conversation}`);

/** The n-th signal batch a session delivered. */
export const signalsCommandId = (session: SessionId, batch: number): CommandId =>
  CommandId.make(`signals:${session}:${batch}`);
