/**
 * Who writes in a Mate's conversation, as the viewer can tell it now — the one rule the
 * conversation's footer, the composer standing in while it opens, and the ownership banner read.
 *
 * Four answers: **unknown**, **you**, **someone** else, **nobody yet**. Unknown is its own answer
 * and never collapses into another: an agent sign-in feed not read yet, a conversation whose
 * instance is not read yet, a signed-in agent the snapshot does not list, a viewer not known yet —
 * each is unknown, not "nobody's" and not the viewer's. A surface that does not know shows nothing
 * it may take back (no composer, no Send, no "nobody can run it"): HQ's word of the agent's signer,
 * or the room held quietly (`conversationFooter`).
 *
 * How a known answer is decided is not this module's: `resolveAgentOwnership` decides it over the
 * login the conversation spends (`resolveSpentLogin`), and the server decides what runs (D6). This
 * one only says when that answer can be read at all.
 *
 * @module conversationWriter
 */
import type { ZeropsAgentAuthSnapshot, ZeropsUserId } from "@t3tools/contracts";

import type { ZeropsAgentOwnership } from "./agentOwnership.ts";
import type { Known } from "./knowledge/known.ts";

export type ConversationWriter =
  /** Not read yet: nothing that would be taken back is shown. */
  | { readonly kind: "unknown" }
  /** The viewer runs it: their own sign-in, a project's token, or an agent nobody signs in to. */
  | { readonly kind: "you" }
  /** Another project member signed its agent in: the conversation is read, not run. */
  | { readonly kind: "someone" }
  /** Nobody can run it until somebody signs in: no credential, or none recorded for one person. */
  | { readonly kind: "nobody-yet" };

export interface ConversationWriterInput {
  /** The Mate's agent sign-in feed as read; `undefined` with no environment. */
  readonly feed: Known<ZeropsAgentAuthSnapshot> | undefined;
  /** The provider instance the conversation spends; `undefined` while it is not read. */
  readonly instanceId: string | undefined;
  /** The configured instances, to name the agent by the instance's driver. */
  readonly providers: ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>;
  /** The signed-in Zerops user's id; `undefined` while the session is not read. */
  readonly viewerSubject: ZeropsUserId | undefined;
  /** The known answer over the spent login (`resolveAgentOwnership`), read only once it rests on what is known. */
  readonly ownership: ZeropsAgentOwnership;
}

/**
 * Whether the sign-in read has come to its end: a snapshot, or a failure nothing more comes of in
 * this read. What waits on the sign-in to paint its first frame waits on this, not on a snapshot
 * only — a failed read would otherwise hold it to its grace.
 */
export function signInReadSettled(feed: ConversationWriterInput["feed"]): boolean {
  return feed !== undefined && feed.state !== "unread" && feed.state !== "reading";
}

/**
 * What stands in the conversation's footer: the composer, the read-only strip (someone else's
 * agent), or the composer's room held empty — no field, no caret, no words, no buttons.
 *
 * The Mate's own sign-in decides once it is read; before it, HQ's word
 * paints at once; and while neither has said, the room is held — never a composer that may turn
 * out to be someone else's.
 */
type ConversationFooter = "composer" | "read-only" | "held";

export function conversationFooter(
  mate: ConversationWriter,
  hq: ConversationWriter,
): ConversationFooter {
  switch ((mate.kind === "unknown" ? hq : mate).kind) {
    case "someone":
      return "read-only";
    case "you":
    case "nobody-yet":
      return "composer";
    case "unknown":
      return "held";
  }
}
