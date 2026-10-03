/**
 * Who writes in a Mate's conversation, as the viewer can tell it now — the one rule the
 * conversation's footer, the composer standing in while it opens, and the ownership banner read.
 *
 * Four answers: **unknown**, **you**, **someone** else, **nobody yet**. Unknown is its own answer
 * and never collapses into another: an agent sign-in feed not read yet, a conversation whose
 * instance is not read yet, a signed-in agent the snapshot does not list, a viewer not known yet —
 * each is unknown, not "nobody's" and not the viewer's. A surface that does not know shows nothing
 * it may take back (no composer, no Send, no "nobody can run it"): the last answer this browser
 * knew, or the room held quietly (`conversationFooter`).
 *
 * How a known answer is decided is not this module's: `resolveAgentOwnership` decides it over the
 * login the conversation spends (`resolveSpentLogin`), and the server decides what runs (D6). This
 * one only says when that answer can be read at all.
 *
 * @module conversationWriter
 */
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";

import { resolveOwnedAgentId, type ZeropsAgentOwnership } from "./agentOwnership.ts";
import type { Known } from "./knowledge/known.ts";
import { resolveSpentLogin } from "./logins.ts";

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
  readonly viewerSubject: string | undefined;
  /** The known answer over the spent login (`resolveAgentOwnership`), read only once it rests on what is known. */
  readonly ownership: ZeropsAgentOwnership;
}

const UNKNOWN: ConversationWriter = { kind: "unknown" };
const YOU: ConversationWriter = { kind: "you" };
const SOMEONE: ConversationWriter = { kind: "someone" };
const NOBODY_YET: ConversationWriter = { kind: "nobody-yet" };

export function resolveConversationWriter(input: ConversationWriterInput): ConversationWriter {
  const { feed } = input;
  // No environment: no Mate, nothing anybody signs in to.
  if (feed === undefined) return YOU;
  if (feed.state === "unread" || feed.state === "reading") return UNKNOWN;
  // The read ended without an answer (an older Mate, a refusal): no signer is known, and the
  // server stays the gate on what runs.
  if (feed.state !== "known") return NOBODY_YET;
  const snapshot = feed.value;
  // Not a Zerops environment: nobody signs anybody in here.
  if (!snapshot.available) return YOU;
  if (input.instanceId === undefined) return UNKNOWN;
  const spent = resolveSpentLogin(input.instanceId, snapshot, input.providers);
  if (spent === undefined) {
    // An agent Mate never signs anybody in to has no signer to wait for; one it does, missing
    // from the snapshot, is not read yet.
    return resolveOwnedAgentId(input.instanceId, input.providers) === undefined ? YOU : UNKNOWN;
  }
  // A token belongs to the project, not to a person.
  if (spent.agent.flagToken) return YOU;
  if (input.viewerSubject === undefined || input.viewerSubject.length === 0) return UNKNOWN;
  switch (input.ownership) {
    case "mine":
      return YOU;
    case "someone-else":
      return SOMEONE;
    case "none":
    case "unrecorded":
    case "record-failed":
    case "unsettled":
      return NOBODY_YET;
  }
}

/** A known answer, as this browser keeps it for the next time it is not known yet. */
export type RememberedWriter = Exclude<ConversationWriter["kind"], "unknown">;

/**
 * What an answer leaves to remember: only one a read snapshot gave. An unknown answer leaves
 * nothing, and so does a read that failed — its "nobody yet" is no answer, and must not overwrite
 * the one this browser knew.
 */
export function rememberableWriter(
  writer: ConversationWriter,
  feed: ConversationWriterInput["feed"],
): RememberedWriter | undefined {
  if (feed?.state !== "known" || writer.kind === "unknown") return undefined;
  return writer.kind;
}

/**
 * What stands in the conversation's footer: the composer, the read-only strip (someone else's
 * agent), or the composer's room held empty — no field, no caret, no words, no buttons.
 *
 * Unknown paints the last known answer where this browser has one, and only the viewer's own
 * paints a composer: a field the person types into must not turn out to be someone else's.
 */
export type ConversationFooter = "composer" | "read-only" | "held";

export function conversationFooter(
  writer: ConversationWriter,
  remembered: RememberedWriter | undefined,
): ConversationFooter {
  switch (writer.kind === "unknown" ? remembered : writer.kind) {
    case "someone":
      return "read-only";
    case "you":
      return "composer";
    case "nobody-yet":
      return writer.kind === "unknown" ? "held" : "composer";
    case undefined:
      return "held";
  }
}
