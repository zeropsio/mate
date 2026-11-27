/**
 * Mate messages: a person's Mates write to each other across projects, through HQ. One Mate asks
 * (`ask`); the asked Mate's run ends and HQ makes its answer (`answer`) from it, back to the asker.
 * HQ also sends a notice about a change. Each is worked as a run in the receiving Mate's
 * conversation, using its owner's agent login.
 *
 * The frames that carry them on the Mate's link are typed in `@t3tools/shared/mateLink`; the
 * contract shared with HQ and zcp is `zeropsio/mate-hq:spec/protocol.md` ("Mate messages").
 *
 * @module mateMessage
 */
import * as Schema from "effect/Schema";

/** The protocol a Mate that takes messages advertises in its overview (`identity.messages`). */
export const MATE_MESSAGES_PROTOCOL = 2;

/** How long a conversation shows it waits for another Mate's answer at most. */
export const MATE_ANSWER_WAIT_MS = 24 * 60 * 60_000;

/** The most of a run's answer an ended ask carries back, in characters, before "…". */
export const MATE_MESSAGE_ANSWER_MAX = 8000;

const NOTICE = "notice";

/** An ask, its answer, or a notice from HQ. */
export const MateMessageKind = Schema.Literals(["ask", "answer", NOTICE]);
export type MateMessageKind = typeof MateMessageKind.Type;

/** How the run a message started ended; `declined`: the Mate would not work it. */
export const MateMessageEnd = Schema.Literals([
  "answered",
  "failed",
  "stopped",
  "declined",
  "not-admitted",
]);
export type MateMessageEnd = typeof MateMessageEnd.Type;

/** Why a taken check notice could not be worked. */
export const MateMessageNotAdmittedReason = Schema.Literals(["no-agent", "usage-limit"]);
export type MateMessageNotAdmittedReason = typeof MateMessageNotAdmittedReason.Type;

/** The Mate a message comes from, as HQ names it: `""` where HQ holds no name. */
export const MateMessageFrom = Schema.Struct({
  projectId: Schema.String,
  projectName: Schema.String,
  mateName: Schema.String,
});
export type MateMessageFrom = typeof MateMessageFrom.Type;

/**
 * HQ's mark that the person approved sending an ask, named by its approval's id: shown, never acted
 * on; it grants nothing.
 */
export const MateMessageApproval = Schema.Struct({ id: Schema.String });

/** The change HQ's notice concerns. */
export const MateMessageAbout = Schema.Struct({
  appId: Schema.String,
  repo: Schema.String,
  number: Schema.Int,
  branch: Schema.String,
  head: Schema.String,
  failed: Schema.Array(Schema.Literals(["review-build", "github"])),
});

const peerFields = { kind: Schema.Literals(["ask", "answer"]), from: MateMessageFrom };
const noticeFields = {
  kind: Schema.Literal(NOTICE),
  about: MateMessageAbout,
};
const itemFields = {
  id: Schema.String,
  inReplyTo: Schema.optionalKey(Schema.String),
  end: Schema.optionalKey(MateMessageEnd),
  approval: Schema.optionalKey(MateMessageApproval),
};
const messageFields = {
  ...itemFields,
  chainId: Schema.String,
  hop: Schema.Int,
  words: Schema.String,
  attachment: Schema.optionalKey(Schema.Struct({ title: Schema.String, text: Schema.String })),
  sentAt: Schema.String,
};

/** A message as HQ delivers it on the link (`message` frame). */
export const MateMessage = Schema.Union([
  Schema.Struct({ ...messageFields, ...peerFields }),
  Schema.Struct({ ...messageFields, ...noticeFields }),
]);
export type MateMessage = typeof MateMessage.Type;

/**
 * What the person-side item of a message's run carries (`ItemBody.person.mateMessage`): shown as
 * the sending Mate's row or HQ's notice, never as the person's words.
 */
export const MateMessageItem = Schema.Union([
  Schema.Struct({ ...itemFields, ...peerFields }),
  Schema.Struct({
    ...itemFields,
    ...noticeFields,
    notAdmittedReason: Schema.optionalKey(MateMessageNotAdmittedReason),
  }),
]);
export type MateMessageItem = typeof MateMessageItem.Type;

/**
 * The item a message's run opens with: its id and kind, the notice's change or the sender and
 * message details, never its words.
 */
export const mateMessageItemOf = (message: MateMessage): MateMessageItem => {
  if (message.kind === NOTICE) return { id: message.id, kind: message.kind, about: message.about };
  return {
    id: message.id,
    kind: message.kind,
    ...(message.inReplyTo === undefined ? {} : { inReplyTo: message.inReplyTo }),
    from: message.from,
    ...(message.end === undefined ? {} : { end: message.end }),
    ...(message.kind === "ask" && message.approval !== undefined
      ? { approval: { id: message.approval.id } }
      : {}),
  };
};

/**
 * A Mate's own name and its project's, as HQ names them. HQ names a Mate by its project's whole
 * name ("Frontend Legacy - Mavi") and leaves `projectName` empty: the Mate is then what follows
 * the last " - ", its project what comes before. Either is `""` where nothing names it.
 */
export const mateMessageNamesOf = (
  who: Pick<MateMessageFrom, "mateName" | "projectName">,
): { readonly mate: string; readonly project: string } => {
  const mate = who.mateName.trim();
  const project = who.projectName.trim();
  if (project !== "") return { mate, project };
  const cut = mate.lastIndexOf(" - ");
  if (cut <= 0) return { mate, project };
  const own = mate.slice(cut + 3).trim();
  return own === "" ? { mate, project } : { mate: own, project: mate.slice(0, cut).trim() };
};

/** How a message names its sender: its Mate's name, else its project's, else "Another Mate". */
export const mateMessageSenderName = (from: MateMessageFrom): string => {
  const { mate, project } = mateMessageNamesOf(from);
  return mate || project || "Another Mate";
};

/** The heading used wherever a notice's conversation is shown. */
export const mateMessageNoticeHeading = (
  about: Pick<typeof MateMessageAbout.Type, "number" | "failed">,
  title?: string,
): string => {
  const change = title?.trim() || `#${about.number}`;
  const reviewBuild = about.failed.includes("review-build");
  const github = about.failed.includes("github");
  if (reviewBuild && github)
    return `Your app did not build, and GitHub's checks failed, on ${change}`;
  if (reviewBuild) return `Your app did not build with "${change}"`;
  return `GitHub's checks failed on ${change}`;
};
