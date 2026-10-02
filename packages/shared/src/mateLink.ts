/**
 * The link between a Mate server and its HQ (SPEC §3.4): one outbound WebSocket the Mate server
 * keeps open to HQ, opened with its Mate credential. JSON, one message per frame, each side
 * validating what it reads with these schemas.
 *
 * - **Up**, the Mate's summary for the menu: its main chat (the thread `resolvePrimaryConversation`
 *   picks, as every client does), how many of its chats run or wait, and who signed each of its agent
 *   logins in. Bounded: every text is cut to {@link MATE_LINK_TEXT_MAX} characters, a frame to
 *   {@link MATE_LINK_FRAME_MAX} bytes, and a Mate sends at most one summary per
 *   {@link MATE_SUMMARY_EVERY_MS}.
 * - **Down**, the Mate's own state in HQ: its record and its birth (who asked for its stand-up,
 *   whether its project is closed off).
 *
 * HQ pings every 20 s and the Mate answers; either side reconnects or closes on silence.
 *
 * @module mateLink
 */
import * as Schema from "effect/Schema";

export const MATE_LINK_TEXT_MAX = 280;
export const MATE_LINK_FRAME_MAX = 16 * 1024;
export const MATE_SUMMARY_EVERY_MS = 500;

const Text = Schema.String.check(Schema.isMaxLength(MATE_LINK_TEXT_MAX));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

/** `resolveThreadStatus`'s kinds (`threadStatus.ts`), as a summary carries them. */
export const MateChatStatus = Schema.Literals([
  "approval",
  "input",
  "failed",
  "connecting",
  "working",
  "planReady",
  "monitoring",
  "done",
  "woke",
  "idle",
]);

export const MateMainChat = Schema.Struct({
  threadId: Schema.String,
  status: MateChatStatus,
  /** The person's last request. */
  lastRequest: Schema.NullOr(Text),
  /** The agent's last words. */
  lastWords: Schema.NullOr(Text),
  /** When the last turn was asked for, ISO. */
  lastTurnAt: Schema.NullOr(Schema.String),
  /** The question the agent waits on the person for. */
  waitingQuestion: Schema.NullOr(Text),
  /** The first line of the last error. */
  firstError: Schema.NullOr(Text),
  /** What the agent does right now, while a turn runs. */
  liveStep: Schema.NullOr(Text),
});
export type MateMainChat = typeof MateMainChat.Type;

export const MateSummary = Schema.Struct({
  main: Schema.NullOr(MateMainChat),
  /** Chats with a turn running. */
  running: Count,
  /** Chats waiting on the person: a question or an approval. */
  waiting: Count,
  /** Who signed each agent login in, by login key (`claude-code`, `codex`, …): a Zerops user id. */
  signers: Schema.Record(Schema.String, Schema.String),
});
export type MateSummary = typeof MateSummary.Type;

/** The Mate as HQ holds it: its record and its birth. */
export const MateState = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
  face: Schema.String,
  /** The person who asked for the Mate's stand-up, or none yet. */
  standupRequestedBy: Schema.NullOr(Schema.String),
  /** Whether the Mate's project is closed off: its runtimes may be imported. */
  closedOff: Schema.Boolean,
});
export type MateState = typeof MateState.Type;

export const MateLinkUp = Schema.Union([
  Schema.Struct({ type: Schema.Literal("pong") }),
  Schema.Struct({ type: Schema.Literal("summary"), summary: MateSummary }),
]);
export type MateLinkUp = typeof MateLinkUp.Type;

export const MateLinkDown = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ping") }),
  Schema.Struct({ type: Schema.Literal("state"), mate: MateState }),
]);
export type MateLinkDown = typeof MateLinkDown.Type;

/** Cuts a text to what a summary carries. */
export const linkText = (text: string): string =>
  text.length <= MATE_LINK_TEXT_MAX ? text : `${text.slice(0, MATE_LINK_TEXT_MAX - 1)}…`;
