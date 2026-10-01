/**
 * A Mate's stand-up: the ask that finishes a new Mate's setup.
 *
 * Adding a Mate to a project deploys the project's recipe with its services
 * empty (`startWithoutCode`) and writes `mate:standup:<userId>` on the Mate's
 * project, naming the person who pressed Add. Their empty conversation with
 * the Mate says what will happen — "Sign Fen in to start. Once it's signed in,
 * Fen stands up development on Acme Docs." (`mateArrival.ts`) — and the moment
 * they have signed an agent in, their own client sends "Stand up development
 * of the project." as them, through the composer's own send, and clears the tag
 * once the conversation holds it (the owner, 2026-09-29). The conversation
 * draws that ask as a quiet line, not as their bubble (`mateStandUpAskLine`).
 *
 * Why the client and not the server: the message is the person's, and only
 * their session may start a turn on the agent they signed in (D6); the tag is
 * written as them, which the Mate's own key cannot do. A tab closed between
 * the sign-in and the send loses nothing: the tag still stands and the
 * conversation is still empty, so the next open of it sends.
 *
 * Exactly once, across everything that could send it twice:
 * - one client, one session: an in-memory guard per environment
 *   (`useMateStandUp`);
 * - a reload, before or after the tag is cleared: only a conversation read
 *   live from its Mate and found empty is sent into, never a cached one;
 * - several clients of the same person (two browsers on one Mate): each
 *   sends the identical command, its ids derived from the conversation
 *   (`mateStandUpSendIds`), and the server takes a command id once — its
 *   receipts (`OrchestrationEngine`).
 *
 * Pure: the decision, the ids and the words; the hook acts on them.
 */
import { CommandId, MessageId } from "@t3tools/contracts";
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { classifyZeropsAgentAuth } from "@t3tools/shared/zeropsAgentAuth";

import type { ComposerSendIds } from "../composerDraftStore";
import { INLINE_PICTURE_PLACEHOLDER } from "../lib/composerPictures";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "../lib/terminalContext";
import type { ZeropsMateIdentity } from "./mateIdentities";
import { resolveAgentAuthorizer, type LocalAgentSigners } from "./useZeropsAgentSigner";

/** The ask, word for word (the owner, 2026-09-29). */
export const MATE_STAND_UP_MESSAGE = "Stand up development of the project.";

/** The one way back after a send that did not go through. */
export const MATE_STAND_UP_RETRY_LABEL = "Try again";

/** Who asked for the stand-up, as the Mate's project carries it (`mate:standup:`). */
export type MateStandUpMarker = { readonly by: string } | undefined;

/**
 * The Mate's main conversation as read live from its Mate: nothing sent in it yet, something
 * sent, or not read yet — a cached copy is never read as empty.
 */
export type MateStandUpConversation = "empty" | "started" | "unknown";

export interface MateStandUpInput {
  readonly marker: MateStandUpMarker;
  /** The Zerops user looking, when known. */
  readonly viewer: string | undefined;
  readonly conversation: MateStandUpConversation;
  /** The composer can send as this person: an agent is signed in and theirs to run. */
  readonly signedIn: boolean;
  /** This session has already sent the stand-up in this environment. */
  readonly sentThisSession: boolean;
  /** A send is on its way in this conversation. */
  readonly sendInFlight: boolean;
}

export type MateStandUpDecision = "send" | "wait" | "nothing";

function askedOf(marker: MateStandUpMarker, viewer: string | undefined): boolean {
  return marker !== undefined && viewer !== undefined && viewer.length > 0 && marker.by === viewer;
}

/**
 * Whether the stand-up holds the composer back: while the person who asked it waits on it, the
 * conversation's one message is the stand-up's headline, and nothing may be typed over it (the
 * owner, 2026-09-29: "textarea should be hidden"). A conversation known to be under way, or a
 * stand-up that did not go through, gives the composer back.
 */
export function mateStandUpHoldsComposer(input: {
  readonly marker: MateStandUpMarker;
  readonly viewer: string | undefined;
  readonly conversation: MateStandUpConversation;
  readonly failed: boolean;
}): boolean {
  return askedOf(input.marker, input.viewer) && input.conversation !== "started" && !input.failed;
}

/**
 * Whether an empty conversation with a Mate holds its composer back: while the stand-up waits on
 * its person, and wherever no agent is signed in at all — nothing typed there could be acted on,
 * and the stage's sign-in is the one thing to do (the owner, of a composer under an unsigned
 * Mate: "this state shouldn't exist").
 */
export function mateArrivalHoldsComposer(input: {
  readonly standUpHolds: boolean;
  /** No agent of the Mate is signed in (`zeropsAgentSignInRequired`). */
  readonly signInRequired: boolean;
  /** The conversation holds no message yet. */
  readonly empty: boolean;
}): boolean {
  return input.standUpHolds || (input.signInRequired && input.empty);
}

/**
 * Whether to send the stand-up now, wait for it, or do nothing: only for the person who asked it,
 * into their Mate's main conversation still empty, once they can send, once.
 */
export function mateStandUpDecision(input: MateStandUpInput): MateStandUpDecision {
  if (!askedOf(input.marker, input.viewer)) return "nothing";
  if (input.conversation === "started" || input.sentThisSession) return "nothing";
  if (input.conversation === "unknown" || !input.signedIn || input.sendInFlight) return "wait";
  return "send";
}

/** Whether the ask is answered, so its tag goes: the conversation holds a message. */
export function mateStandUpCleared(input: {
  readonly marker: MateStandUpMarker;
  readonly viewer: string | undefined;
  readonly conversation: MateStandUpConversation;
}): boolean {
  return askedOf(input.marker, input.viewer) && input.conversation === "started";
}

/**
 * The ids the stand-up is sent with, derived from the conversation and the attempt: every client
 * of the person sending attempt `n` into the same conversation sends the same command. A try
 * again is the next attempt, so a command the server refused is never the one sent again.
 */
export function mateStandUpSendIds(threadId: string, attempt: number): ComposerSendIds {
  const id = `mate-standup-${threadId}-${String(attempt)}`;
  return { commandId: CommandId.make(id), messageId: MessageId.make(id) };
}

/**
 * Whether one of the Mate's agents is signed in and this person's to run: recorded as theirs, or
 * written by this client and not read back yet, or their own sign-in that just succeeded with its
 * record on its way; a token belongs to the project and runs for anybody.
 */
export function mateStandUpSignedIn(
  snapshot: ZeropsAgentAuthSnapshot,
  viewer: string,
  localSigners: LocalAgentSigners,
): boolean {
  return snapshot.agents.some((agent) => {
    const kind = classifyZeropsAgentAuth(agent).kind;
    if (kind !== "authorized" && kind !== "registering") return false;
    if (agent.flagToken) return true;
    // Recorded, or written here: the login's own check still counts only once it succeeded, so
    // the ask never leaves while the code is being checked.
    const signer = resolveAgentAuthorizer(agent.agentId, agent, localSigners, undefined)?.subject;
    if (signer !== undefined) return signer === viewer;
    return agent.login?.phase === "succeeded" && agent.login.startedBy === viewer;
  });
}

/** Where the person's sign-in stands, for the empty conversation. */
export type MateStandUpSignIn = "unknown" | "required" | "signed-in" | "someone-else";

/** What the empty conversation says while a stand-up is its viewer's to start. */
export type MateStandUpPhase = "sign-in" | "standing-up" | "failed";

/**
 * The empty conversation's state, or `null` where it asks today's question: a Mate nobody asked
 * it of, a colleague looking (the ask is its person's, sent from their sign-in), or another of the
 * Mate's chats (the stand-up goes to the main one).
 */
export function mateStandUpPhase(input: {
  readonly marker: MateStandUpMarker;
  readonly viewer: string | undefined;
  /** This conversation is the Mate's main one. */
  readonly main: boolean;
  readonly signIn: MateStandUpSignIn;
  /** What this session's send came to: none yet, on its way, or not through. */
  readonly attempt: "none" | "sending" | "failed";
}): MateStandUpPhase | null {
  if (!askedOf(input.marker, input.viewer) || !input.main) return null;
  if (input.attempt === "failed") return "failed";
  if (input.attempt === "sending" || input.signIn === "signed-in") return "standing-up";
  return "sign-in";
}

/**
 * The stand-up's ask as its conversation draws it: a quiet line in nobody's voice, never a bubble
 * in the person's words — the ask is the product's, sent for them by their sign-in. Its person
 * reads it as theirs; anybody else reading the conversation, as asked.
 */
export function mateStandUpAskLine(
  mate: Pick<ZeropsMateIdentity, "name" | "project">,
  asker: "you" | "someone",
): string {
  const of = mate.project === undefined ? "the project" : mate.project;
  return asker === "you"
    ? `You asked ${mate.name} to stand up development of ${of}`
    : `${mate.name} was asked to stand up development of ${of}`;
}

/** What a composer's prompt carries besides its words: a picture's or a terminal's place. */
const INLINE_PLACES = new Set([INLINE_PICTURE_PLACEHOLDER, INLINE_TERMINAL_CONTEXT_PLACEHOLDER]);

/**
 * A composer's prompt without the stand-up's ask, where its words are the ask and nothing else:
 * the places of its pictures and terminal lines stay, in order. `undefined` where the person wrote
 * anything of their own — then it is their draft, left as it is.
 */
export function promptWithoutStandUpAsk(prompt: string): string | undefined {
  const chars = [...prompt];
  const words = chars.filter((char) => !INLINE_PLACES.has(char)).join("");
  if (!isMateStandUpAsk(words)) return undefined;
  return chars.filter((char) => INLINE_PLACES.has(char)).join("");
}

/** Whether a message of the Mate's main conversation is the stand-up's ask: its exact words. */
export const isMateStandUpAsk = (text: string): boolean => text.trim() === MATE_STAND_UP_MESSAGE;
