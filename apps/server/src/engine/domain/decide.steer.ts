/**
 * A message steered into the running turn.
 *
 * @module engine/domain/decide.steer
 */
import {
  itemId as deriveItemId,
  type EffectId,
  type MessageAbout,
  type PersonAttachment,
  type SessionId,
  mateMessageSenderName,
} from "@t3tools/contracts";

import type { Command } from "./command.ts";
import type { ConversationState, RunRecord } from "./state.ts";
import { steeredWith, toldWith } from "./told.ts";
import { Rejected, type StepBuilder } from "./decide.step.ts";
import { actsForSomeone } from "./decide.runs.ts";

export const steer = (b: StepBuilder, command: Extract<Command, { _tag: "Steer" }>): void => {
  actsForSomeone(b);
  if (b.state.archived) throw new Rejected("archived");
  const run = b.state.runs[command.runId];
  if (run === undefined) throw new Rejected("unknown-run");
  if (run.state !== "running" && run.state !== "waiting") throw new Rejected("run-not-running");
  const session = b.state.session;
  const attachments = command.attachments ?? [];
  if (
    session === null ||
    session.id !== run.sessionId ||
    !session.capabilities.steer ||
    (attachments.length > 0 && session.capabilities.steerAttachments !== true)
  ) {
    throw new Rejected("steer-unsupported");
  }
  // The agent hears the note after the words: it answers where the person reads (`steeredWith`);
  // in a run another Mate's message started, that the turn's end still goes back to that Mate.
  const told = steeredWith(toldWith(command.text, command.context), mateSenderOf(b.state, run));
  steerInto(b, run, session.id, command.text, attachments, told, command.about);
};

/**
 * The Mate whose ask started the run, by its own name: its person item's, or the run's it
 * continues; none for a run that is no Mate's ask — an answer that woke its asker goes back to
 * nobody.
 */
const mateSenderOf = (state: ConversationState, run: RunRecord): string | undefined => {
  if (run.principal.kind !== "mate") return undefined;
  const seen = new Set<string>();
  for (let at: RunRecord | undefined = run; at !== undefined && !seen.has(at.id);) {
    seen.add(at.id);
    const message = at.personBody?.mateMessage;
    if (message !== undefined)
      return message.kind === "answer" ? undefined : mateMessageSenderName(message.from);
    at = at.joins === null ? undefined : state.runs[at.joins];
  }
  return "another Mate";
};

/**
 * The person's message into the run's turn: its item, steered, and the effect that sends it. The
 * item keeps `text`, what the person typed; the agent is sent `told`, the context in front of it.
 */
export const steerInto = (
  b: StepBuilder,
  run: RunRecord,
  sessionId: SessionId,
  text: string,
  attachments: ReadonlyArray<PersonAttachment>,
  told: string = text,
  about?: MessageAbout,
): EffectId => {
  const item = deriveItemId(run.id, run.nextItemOrdinal);
  b.emit({
    _tag: "ItemOpened",
    runId: run.id,
    itemId: item,
    key: null,
    by: { kind: "person", principal: b.envelope.principal },
    body: {
      kind: "person",
      text,
      attachments: [...attachments],
      sendId: b.envelope.commandId,
      ...(about === undefined ? {} : { about }),
      delivery: { state: "steered", at: b.now },
    },
  });
  const effect = b.effect("provider.steer", item, 1, run.id, {
    runId: run.id,
    sessionId,
    itemId: item,
    text: told,
    ...(attachments.length === 0 ? {} : { attachments: [...attachments] }),
    // Admitted for the instance of the session the words go into, which may still be the earlier one.
    instanceId: b.state.session?.instanceId ?? b.state.agent?.instanceId ?? null,
    principal: b.envelope.principal,
  });
  b.result = { ...b.result, runId: run.id, itemId: item };
  return effect;
};
