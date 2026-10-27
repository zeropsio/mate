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
import {
  agentIdForProviderInstance,
  type ZeropsAgentAuthSnapshot,
  type ZeropsAgentId,
} from "@t3tools/contracts";

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

/**
 * Whether the agent an instance runs is told at all: the providers name the instance, or its id is
 * one of the two agents' own. While the environment's providers load, it is not — and an agent not
 * told is unknown, never one nobody signs in to.
 */
const agentTold = (
  instanceId: string,
  providers: ReadonlyArray<{ readonly instanceId: string }>,
): boolean =>
  providers.some((provider) => provider.instanceId === instanceId) ||
  agentIdForProviderInstance(instanceId) !== undefined;

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
    // from the snapshot, is not read yet — and one the providers do not name yet is not told.
    if (!agentTold(input.instanceId, input.providers)) return UNKNOWN;
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
      return NOBODY_YET;
  }
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
 * Who writes in a conversation as HQ's navigation says it, before the Mate's own sign-in is read:
 * the signer HQ records of the agent the conversation spends (`signers` of the Mate's project in
 * HQ's navigation). Only an agent's own login is HQ's to say; a login beside it has its own signer,
 * which only the Mate knows. An agent Mate signs nobody in to is the viewer's to run.
 */
export function hqConversationWriter(input: {
  /** The provider instance the conversation spends; `undefined` while it is not read. */
  readonly instanceId: string | undefined;
  readonly providers: ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>;
  /** Who HQ records signed each agent's own login in; `undefined` while HQ has not said. */
  readonly signers: Readonly<Partial<Record<ZeropsAgentId, string>>> | undefined;
  /** The signed-in Zerops user's id; `undefined` while the session is not read. */
  readonly viewerSubject: string | undefined;
}): ConversationWriter {
  if (input.instanceId === undefined || !agentTold(input.instanceId, input.providers)) {
    return UNKNOWN;
  }
  if (resolveOwnedAgentId(input.instanceId, input.providers) === undefined) return YOU;
  const agent = agentIdForProviderInstance(input.instanceId);
  if (agent === undefined || input.signers === undefined) return UNKNOWN;
  if (input.viewerSubject === undefined || input.viewerSubject.length === 0) return UNKNOWN;
  const signer = input.signers[agent];
  if (signer === undefined) return NOBODY_YET;
  return signer === input.viewerSubject ? YOU : SOMEONE;
}

/**
 * What stands in the conversation's footer: the composer, the read-only strip (someone else's
 * agent), or the composer's room held empty — no field, no caret, no words, no buttons.
 *
 * The Mate's own sign-in decides once it is read; before it, HQ's word (`hqConversationWriter`)
 * paints at once; and while neither has said, the room is held — never a composer that may turn
 * out to be someone else's.
 */
export type ConversationFooter = "composer" | "read-only" | "held";

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
