/**
 * Mate messages: a person's Mates write to each other across projects, through HQ. One Mate asks
 * (`ask`); the asked Mate's run ends and HQ makes its answer (`answer`) from it, back to the asker.
 * Each is worked as a run of the receiving Mate's one conversation, the way a person's message is,
 * and spends that Mate's agent login only when its signer is the person HQ names both Mates' owner.
 *
 * The frames that carry them on the Mate's link are typed in `@t3tools/shared/mateLink`; the
 * contract shared with HQ and zcp is `zeropsio/mate-hq:spec/protocol.md` ("Mate messages").
 *
 * @module mateMessage
 */
import * as Schema from "effect/Schema";

/** The protocol a Mate that takes messages advertises in its overview (`identity.messages`). */
export const MATE_MESSAGES_PROTOCOL = 1;

/** The most of a run's answer an ended ask carries back, in characters, before "…". */
export const MATE_MESSAGE_ANSWER_MAX = 8000;

/** An ask, or the answer HQ made from the asked run's end. */
export const MateMessageKind = Schema.Literals(["ask", "answer"]);
export type MateMessageKind = typeof MateMessageKind.Type;

/** How the run a message started ended; `declined`: the Mate would not work it. */
export const MateMessageEnd = Schema.Literals(["answered", "failed", "stopped", "declined"]);
export type MateMessageEnd = typeof MateMessageEnd.Type;

/** The Mate a message comes from, as HQ names it: `""` where HQ holds no name. */
export const MateMessageFrom = Schema.Struct({
  projectId: Schema.String,
  projectName: Schema.String,
  mateName: Schema.String,
});
export type MateMessageFrom = typeof MateMessageFrom.Type;

/** A message as HQ delivers it on the link (`message` frame). */
export const MateMessage = Schema.Struct({
  id: Schema.String,
  chainId: Schema.String,
  hop: Schema.Int,
  kind: MateMessageKind,
  /** Answers only: the ask's id. */
  inReplyTo: Schema.optionalKey(Schema.String),
  from: MateMessageFrom,
  words: Schema.String,
  attachment: Schema.optionalKey(Schema.Struct({ title: Schema.String, text: Schema.String })),
  /** Answers only: how the asked run ended. */
  end: Schema.optionalKey(MateMessageEnd),
  /** RFC 3339. */
  sentAt: Schema.String,
});
export type MateMessage = typeof MateMessage.Type;

/**
 * What the person-side item of a message's run carries (`ItemBody.person.mateMessage`): drawn as
 * the sending Mate's row, never as the person's words.
 */
export const MateMessageItem = Schema.Struct({
  id: Schema.String,
  kind: MateMessageKind,
  inReplyTo: Schema.optionalKey(Schema.String),
  from: MateMessageFrom,
  end: Schema.optionalKey(MateMessageEnd),
});
export type MateMessageItem = typeof MateMessageItem.Type;

/** The item a message's run opens with: its id, kind, reply, sender and end, never its words. */
export const mateMessageItemOf = (message: MateMessage): MateMessageItem => ({
  id: message.id,
  kind: message.kind,
  ...(message.inReplyTo === undefined ? {} : { inReplyTo: message.inReplyTo }),
  from: message.from,
  ...(message.end === undefined ? {} : { end: message.end }),
});

/** How a message names its sender: its Mate's name, else its project's, else "Another Mate". */
export const mateMessageSenderName = (from: MateMessageFrom): string =>
  from.mateName.trim() || from.projectName.trim() || "Another Mate";

/** Its sender's project, else its Mate's name, else "Another Mate". */
export const mateMessageSenderProject = (from: MateMessageFrom): string =>
  from.projectName.trim() || from.mateName.trim() || "Another Mate";
