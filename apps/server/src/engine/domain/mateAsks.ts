/**
 * The messages a conversation sent other Mates of the person's that no answer met yet: read off
 * its own record as `evolve` folds it, so its row says whom it waits on with no read of its items.
 * A `zerops_message_mate` call that closed with a sent result adds one, at its run and time; the
 * answer to it takes it away, whether its person item opens here or the Zerops side says it was
 * settled elsewhere (`MateAnswerHeard`). An answer heard before its call closed (HQ answers a
 * message it declines at once) is remembered, so the call never adds what is already answered.
 * Pure, and it never throws: a result it cannot read adds nothing.
 *
 * @module engine/domain/mateAsks
 */
import { type ItemBody, mateMessageNamesOf } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The tool a Mate messages another of its person's Mates with (zcp's). */
const MATE_MESSAGE_TOOL = "zerops_message_mate";
/** How many unanswered messages a conversation keeps: the newest. */
const KEPT_AWAITS = 8;
/** How many answered messages it remembers, so a call closing late adds none of them. */
const KEPT_ANSWERED = 32;

/** A message the conversation sent another Mate, by HQ's id, and the Mate it waits on. */
export interface AwaitedAnswer {
  readonly id: string;
  readonly projectId: string;
  /** The Mate's own name, HQ's cut at its project's (`mateMessageNamesOf`). */
  readonly mateName: string;
  /** The ordinal of the run that sent it: a later run of the conversation that ended outlives it. */
  readonly ordinal: number;
  /** When it was sent. */
  readonly at: number;
}

/** What the conversation keeps of its messages to other Mates. */
export interface MateAsks {
  readonly awaits: ReadonlyArray<AwaitedAnswer>;
  /** The messages whose answer it heard, newest last. */
  readonly answered: ReadonlyArray<string>;
}

const SentResult = Schema.Struct({
  message: Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1)),
    to: Schema.Struct({
      projectId: Schema.String,
      projectName: Schema.optionalKey(Schema.String),
      mateName: Schema.String,
    }),
  }),
});
const decodeSentResult = Schema.decodeUnknownOption(SentResult);

/** The message a closed `zerops_message_mate` call sent; none for any other call or a refusal. */
const sentMessageOf = (body: ItemBody): Omit<AwaitedAnswer, "ordinal" | "at"> | undefined => {
  if (body.kind !== "call" || body.state !== "done" || body.result === undefined) return undefined;
  const { toolName, resultText } = body.result;
  if (toolName.replace(/^mcp__[^_]+(?:_[^_]+)*?__/u, "") !== MATE_MESSAGE_TOOL) return undefined;
  if (resultText === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(
    Option.map(decodeSentResult(parsed), ({ message }) => {
      const names = mateMessageNamesOf({
        mateName: message.to.mateName,
        projectName: message.to.projectName ?? "",
      });
      return {
        id: message.id,
        projectId: message.to.projectId,
        mateName: names.mate || names.project || "another Mate",
      };
    }),
  );
};

/** The answer to `id` was heard: it is waited on no more, and remembered. */
export const answerHeard = (asks: MateAsks, id: string): MateAsks => ({
  awaits: asks.awaits.some((awaited) => awaited.id === id)
    ? asks.awaits.filter((awaited) => awaited.id !== id)
    : asks.awaits,
  answered: asks.answered.includes(id)
    ? asks.answered
    : [...asks.answered, id].slice(-KEPT_ANSWERED),
});

/** What the conversation keeps once `body` was said in its run `sent`: an ask added, one answered. */
export const asksAfter = (
  asks: MateAsks,
  body: ItemBody,
  sent: { readonly ordinal: number; readonly at: number },
): MateAsks => {
  if (body.kind === "person") {
    const reply = body.mateMessage?.kind === "answer" ? body.mateMessage.inReplyTo : undefined;
    return reply === undefined ? asks : answerHeard(asks, reply);
  }
  const message = sentMessageOf(body);
  if (message === undefined || asks.answered.includes(message.id)) return asks;
  return {
    ...asks,
    awaits: [
      ...asks.awaits.filter((awaited) => awaited.id !== message.id),
      { ...message, ...sent },
    ].slice(-KEPT_AWAITS),
  };
};
