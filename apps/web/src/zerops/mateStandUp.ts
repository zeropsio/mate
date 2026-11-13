/**
 * A Mate's stand-up: the ask that finishes a new Mate's setup.
 *
 * Adding a Mate to a project deploys the project's recipe with its services
 * empty (`startWithoutCode`) and records, in the Mate's birth at HQ, the person
 * who pressed Add as the one who asks for its stand-up. Their empty
 * conversation with the Mate says what will happen — "Sign Fen in to start.
 * Once it's signed in, Fen stands up development on Acme Docs." (`mateArrival.ts`)
 * — and once they have signed an agent in, the Mate's own server sends "Stand
 * up development of the project." as them (`ZeropsSetup`). No client sends it.
 * The conversation draws that ask as a quiet line, not as their bubble
 * (`mateStandUpAskLine`).
 *
 * Pure: the words, and what the conversation shows while the stand-up is its
 * person's.
 */
import type { RunRecord, ZeropsAgentAuthSnapshot, ZeropsUserId } from "@t3tools/contracts";
import {
  zeropsOtherAgentReady,
  type OtherAgentFields,
} from "@t3tools/client-runtime/zerops/agentLogin";
import { turnRefusal } from "@t3tools/shared/zeropsAgentAuth";

import type { ZeropsMateIdentity } from "./mateIdentities";

/** The ask, word for word (the owner, 2026-09-29). */
export const MATE_STAND_UP_MESSAGE = "Stand up development of the project.";

/** The one way back after a creation that did not go through. */
export const MATE_STAND_UP_RETRY_LABEL = "Try again";

/** Who asked for the stand-up, as HQ's birth record names them (`ZeropsMembership.standUp`). */
export type MateStandUpMarker = { readonly by: string } | undefined;

/**
 * The Mate's main conversation as read live from its Mate: nothing sent in it yet, something
 * sent, or not read yet — a cached copy is never read as empty.
 */
export type MateStandUpConversation = "empty" | "started" | "unknown";

/**
 * Where the Mate's main conversation stands for its stand-up: started once it holds a message —
 * a copy still being read again included, since messages read are never taken back — and empty
 * only as read live from its Mate. Any other conversation, or none, is not the stand-up's.
 */
export function mateStandUpConversation(input: {
  /** Whether it is the Mate's main conversation; null where there is no server conversation. */
  readonly main: boolean | null;
  /** Its messages as read so far. */
  readonly messageCount: number;
  /** It is read live from its Mate, not a copy being read again. */
  readonly live: boolean;
}): MateStandUpConversation {
  if (input.main !== true) return "unknown";
  if (input.messageCount > 0) return "started";
  return input.live ? "empty" : "unknown";
}

function askedOf(marker: MateStandUpMarker, viewer: string | undefined): boolean {
  return marker !== undefined && viewer !== undefined && viewer.length > 0 && marker.by === viewer;
}

/**
 * Whether a conversation is where its Mate's stand-up waits: the Mate's main conversation, or a
 * draft while the Mate is read to have no conversation yet for the ask to go into. Once one exists
 * the ask goes there, and a draft is a new chat like any other; before the Mate's conversations
 * are read, a draft waits on nothing.
 */
export function mateStandUpAwaitedIn(input: {
  /** The conversation on screen: the Mate's main one, another, or a draft. */
  readonly conversation: "main" | "other" | "draft";
  /** The Mate holds a conversation, as its environment's conversations read so far. */
  readonly mateHasConversation: boolean;
  /** The Mate's conversations have been read at all. */
  readonly conversationsRead: boolean;
}): boolean {
  if (input.conversation === "draft") return input.conversationsRead && !input.mateHasConversation;
  return input.conversation === "main";
}

/**
 * Where a draft that waited on its person's stand-up goes once the ask lands: the Mate's main
 * conversation. Only a draft opened before the Mate had a conversation waited on it, and only
 * with nothing typed in it; a new chat opened beside a conversation that already stood stays.
 */
export function mateStandUpHandOver<Id extends string>(input: {
  readonly marker: MateStandUpMarker;
  readonly viewer: string | undefined;
  /** The draft opened while its Mate was read to have no conversation. */
  readonly openedBeforeConversation: boolean;
  /** Something is typed in the draft: it is the person's, and stays. */
  readonly typed: boolean;
  /** The Mate's main conversation, once it has one. */
  readonly main: { readonly id: Id } | undefined;
}): Id | undefined {
  if (input.main === undefined || !input.openedBeforeConversation || input.typed) return undefined;
  return askedOf(input.marker, input.viewer) ? input.main.id : undefined;
}

/**
 * Whether the stand-up holds the composer back: while the person who asked it waits on it, the
 * conversation's one message is the stand-up's headline, and nothing may be typed over it (the
 * owner, 2026-09-29: "textarea should be hidden"). A conversation known to be under way gives the
 * composer back, as does a failed attempt.
 */
export function mateStandUpHoldsComposer(input: {
  readonly marker: MateStandUpMarker;
  readonly viewer: string | undefined;
  readonly conversation: MateStandUpConversation;
  /** Its server reported a terminal failure: the person can write instead. */
  readonly failed?: boolean;
}): boolean {
  return !input.failed && askedOf(input.marker, input.viewer) && input.conversation !== "started";
}

/**
 * Whether one of the Mate's agents is signed in and this person's to run — the gate the Mate's
 * server admits the stand-up by (`turnRefusal`): the server records them as its signer the moment
 * their sign-in succeeds, never while its code is being checked; a token belongs to the project and
 * runs for anybody.
 */
export function mateStandUpSignedIn(
  snapshot: ZeropsAgentAuthSnapshot,
  viewer: ZeropsUserId,
  providers?: ReadonlyArray<OtherAgentFields>,
): boolean {
  if (zeropsOtherAgentReady(providers)) return true;
  return snapshot.agents.some(
    (agent) =>
      turnRefusal({ agent, signer: agent.authorizedBy?.subject, person: viewer }) === undefined,
  );
}

/** Where the person's sign-in stands, for the empty conversation. */
export type MateStandUpSignIn = "unknown" | "required" | "signed-in" | "someone-else";

/** What the empty conversation says while a stand-up is its viewer's to start. */
export type MateStandUpPhase = "sign-in" | "standing-up";

/**
 * The empty conversation's state, or `null` where it asks today's question: a Mate nobody asked
 * it of, a colleague looking (the ask is its person's, sent from their sign-in), or a conversation
 * the stand-up does not wait in — another of the Mate's chats, or a draft beside its main one.
 */
export function mateStandUpPhase(input: {
  readonly marker: MateStandUpMarker;
  readonly viewer: string | undefined;
  /** The stand-up waits in this conversation (`mateStandUpAwaitedIn`). */
  readonly awaited: boolean;
  readonly signIn: MateStandUpSignIn;
}): MateStandUpPhase | null {
  if (!askedOf(input.marker, input.viewer) || !input.awaited) return null;
  return input.signIn === "signed-in" ? "standing-up" : "sign-in";
}

/**
 * The stand-up's ask as its conversation draws it: a quiet line in nobody's voice, never a bubble
 * in the person's words — the ask is the product's, sent for them once they signed in. Its person
 * reads it as theirs; anybody else reading the conversation, as asked.
 */
export function mateStandUpAskLine(
  mate: Pick<ZeropsMateIdentity, "name" | "project" | "standUp">,
  viewer: string | undefined,
): string {
  const of = mate.project === undefined ? "the project" : mate.project;
  return askedOf(mate.standUp, viewer)
    ? `You asked ${mate.name} to stand up development of ${of}`
    : `${mate.name} was asked to stand up development of ${of}`;
}

/** Whether a message of the Mate's main conversation is the stand-up's ask: its exact words. */
export const isMateStandUpAsk = (text: string): boolean => text.trim() === MATE_STAND_UP_MESSAGE;

/**
 * A setup that never started: the Mate's main conversation holds nothing but its stand-up's runs,
 * each ended failed before its first step (its record holds no items, as `BrokeOff.beforeStart`
 * reads one) — an admission that refused it, a session that never opened. Not a conversation
 * yet: its view is the Mate's arrival, not the timeline.
 */
export interface MateStandUpStopped {
  /** Who it runs for, by bare Zerops user id: the person who added the Mate. */
  readonly by: string;
  /** Its attempts that ended before their first step. */
  readonly failures: number;
  /** A later attempt waits to start: the Mate is standing up. */
  readonly waiting: boolean;
}

const WAITING_RUN_STATES: ReadonlySet<string> = new Set(["queued", "admitted", "sending"]);

/**
 * The conversation's never-started setup, from its runs; null once anything else is in it — the
 * person's words, a run that began, a stand-up that has not failed yet (a first one still on its
 * way stays the timeline's).
 */
export function mateStandUpStopped(
  runs: ReadonlyArray<Pick<RunRecord, "principal" | "end" | "state" | "summary">>,
  personWrote: boolean,
): MateStandUpStopped | null {
  if (personWrote) return null;
  let by: string | undefined;
  let failures = 0;
  let waiting = false;
  for (const run of runs) {
    if (run.principal.kind !== "standup" || run.summary.items > 0) return null;
    by = run.principal.startedBy;
    if (run.end === null) {
      if (!WAITING_RUN_STATES.has(run.state)) return null;
      waiting = true;
    } else if (run.end.kind === "failed") {
      failures += 1;
    } else {
      return null;
    }
  }
  return by === undefined || failures === 0 ? null : { by, failures, waiting };
}

/**
 * Where its person's Try again stands: ready; sending; the Mate starting it (an attempt went, or
 * one waits to start); stopped again before its first step; refused, the Mate holding no failed
 * setup of theirs to start; or not reaching the Mate at all.
 */
export type MateSetupRetryState =
  | "ready"
  | "sending"
  | "starting"
  | "again"
  | "refused"
  | "unreachable";

/** A press of Try again in this view: its answer, and how many attempts had failed at it. */
export interface MateSetupPress {
  readonly answer: "sending" | "went" | "refused" | "unreachable";
  readonly failures: number;
}

/**
 * The Try again as drawn, from the last press in this view and the conversation: an attempt that
 * went shows the Mate starting until its run fails before its first step (another failure
 * counted) or the Mate settles the attempt without one; one waiting to start is starting, whoever
 * pressed, and more than one failure reads as stopped again.
 */
export function mateSetupRetryState(input: {
  readonly press: MateSetupPress | null;
  readonly failures: number;
  readonly waiting: boolean;
  /** A Try again of this Mate's is still in flight or unsettled (`mateActions`). */
  readonly settling: boolean;
}): MateSetupRetryState {
  if (input.waiting) return "starting";
  const { press } = input;
  // Unpressed here, it still says a second failure as one (a reload, another tab's press).
  if (press === null) return input.settling ? "sending" : input.failures > 1 ? "again" : "ready";
  switch (press.answer) {
    case "sending":
      return "sending";
    case "refused":
      return "refused";
    case "unreachable":
      return "unreachable";
    case "went":
      return input.failures > press.failures || !input.settling ? "again" : "starting";
  }
}
