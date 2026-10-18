/**
 * Sends what a surface asked this composer to send (`requestSend`).
 *
 * A surface elsewhere has already asked the person and been told to send, or
 * the send is the person's own next step (a Mate's stand-up after its sign-in).
 * Every hand-over to a Mate used to stop at composing and wait for a keystroke
 * (spec §5.4); a confirm dialog moves that decision earlier. The send itself
 * stays the composer's — `send` is its own — because only it knows the model
 * selection, the runtime mode and the attachments a turn needs.
 *
 * Taken once, while its conversation is the one shown: the words go into the
 * composer at once, and the send after paint, so the composer holds them
 * before the turn reads them. The take changes the very store this reads, so
 * the view re-renders at once; that re-render must not cancel the send it
 * scheduled — cancelling it there, in an effect's cleanup, left every request
 * written and never sent. Only a conversation no longer shown keeps a taken
 * send from going, and then it is asked again, for that conversation's next
 * open.
 *
 * A conversation whose agent takes no turn now — it waits for a sign-in, say —
 * keeps the words in its composer instead, and whoever asked hears so and why
 * (`sendOutcomeOf`): an approved message never reads as sent when it was not.
 * While the conversation still reads whether its agent takes a turn, a request
 * waits; so it does while its composer cannot send yet (`ready`: the
 * conversation loading or connecting, its composer not mounted, another send
 * in flight), since the composer's send would drop it unsaid.
 *
 * Whoever asked hears it went only from the send's own answer. A send the
 * composer declines, or one that breaks, leaves its words there and says so;
 * one it was not yet ready for is filed again and taken once that
 * conversation's readiness changes, never retried in a loop. A queued one is
 * told when it leaves the queue (`tellSendOutcome`). Filing a request writes
 * its words into the composer, so the person may send or change them by hand
 * first: then the request is dropped, never sent a second time. A request no
 * conversation takes within `REQUESTED_SEND_WAIT_MS` is withdrawn, its words
 * left waiting in the composer, and its asker told so.
 */
import type { MessageId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";

import {
  useComposerDraftStore,
  type ComposerSendIds,
  type ComposerThreadTarget,
} from "../composerDraftStore";

/** Whether this conversation's agent takes a turn now (`agentAdmission`). */
export type ComposerAdmits =
  | { readonly kind: "reading" }
  | { readonly kind: "sends" }
  | { readonly kind: "holds"; readonly why: string };

/**
 * A conversation's admission as its composer's requests read it: sent where its agent takes a
 * turn; held where the conversation says why it does not (a sign-in it waits for, or a colleague's
 * Mate); otherwise still reading — or held a moment, as a stand-up holds it — so a request waits.
 */
export function composerAdmits(
  admission: { readonly canSend: boolean; readonly sendBlockReason: string | null },
  readOnly: string | null,
): ComposerAdmits {
  if (admission.canSend) return { kind: "sends" };
  const why = admission.sendBlockReason ?? readOnly;
  return why === null ? { kind: "reading" } : { kind: "holds", why };
}

/**
 * What became of a requested send: it went out; its words wait in the composer, and why; or the
 * person took them over there — sent or changed them by hand — before it went.
 */
export type ComposerSendOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "waits"; readonly why: string }
  | { readonly kind: "taken-over" };

/**
 * What the composer's send made of a request: its outcome; queued behind the running turn, told
 * when it leaves the queue; or not ready for it yet.
 */
export type ComposerSendResult =
  | ComposerSendOutcome
  | { readonly kind: "queued" }
  | { readonly kind: "not-ready" };

/** How long a request may wait for its conversation to take it before its asker hears it waits. */
export const REQUESTED_SEND_WAIT_MS = 60_000;

const NOT_TAKEN = "Its conversation was not ready to send it.";
const BROKE = "It did not go out.";

interface Awaiting {
  readonly resolve: (outcome: ComposerSendOutcome) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  /** Past its wait: a send not ready for it is told so instead of filed again. */
  expired: boolean;
}

const awaiting = new Map<MessageId, Awaiting>();

/**
 * What becomes of the requested send carrying `messageId`; asked before the request is filed. A
 * request still filed after `REQUESTED_SEND_WAIT_MS` is withdrawn and told its words wait; one
 * taken by then is told by its send.
 */
export function sendOutcomeOf(messageId: MessageId): Promise<ComposerSendOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const entry = awaiting.get(messageId);
      if (entry === undefined) return;
      entry.expired = true;
      if (useComposerDraftStore.getState().withdrawSendRequest(messageId))
        tellSendOutcome(messageId, { kind: "waits", why: NOT_TAKEN });
    }, REQUESTED_SEND_WAIT_MS);
    awaiting.set(messageId, { resolve, timer, expired: false });
  });
}

/** Tells whoever asked for the send carrying `messageId` what became of it; once, if anyone asked. */
export function tellSendOutcome(messageId: MessageId, outcome: ComposerSendOutcome): void {
  const entry = awaiting.get(messageId);
  if (entry === undefined) return;
  awaiting.delete(messageId);
  clearTimeout(entry.timer);
  entry.resolve(outcome);
}

function tellOutcome(ids: ComposerSendIds | undefined, outcome: ComposerSendOutcome): void {
  if (ids !== undefined) tellSendOutcome(ids.messageId, outcome);
}

const subscribe = useComposerDraftStore.subscribe;
const readRequestKeys = () =>
  Object.keys(useComposerDraftStore.getState().sendRequestsByThreadKey).join(",");
const noRequestKeys = () => "";

export function useComposerSendRequests(input: {
  /** The conversation this composer writes into; `null` while none is live. */
  readonly target: ComposerThreadTarget | null;
  /** `target` as a key: a send taken for one conversation never goes out in another. */
  readonly targetKey: string | null;
  /** Whether its agent takes a turn now: a request waits while this reads, and is held where not. */
  readonly admits: ComposerAdmits;
  /** Whether the composer can send now; a request its agent would take waits while it cannot. */
  readonly ready: boolean;
  /** Writes the request's words where the composer's send reads them. */
  readonly write: (prompt: string) => void;
  /** The composer's own send, with the ids the request carries: what it made of them. */
  readonly send: (ids: ComposerSendIds | undefined) => Promise<ComposerSendResult>;
}): void {
  const { target, targetKey } = input;
  const admitting = input.admits.kind;
  const heldBecause = input.admits.kind === "holds" ? input.admits.why : null;
  const { ready } = input;
  const requestKeys = useSyncExternalStore(subscribe, readRequestKeys, noRequestKeys);
  const write = useEffectEvent(input.write);
  const send = useEffectEvent(input.send);
  // The conversation shown now, read when a scheduled send is due; null once none is.
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    shownKey.current = targetKey;
    return () => {
      shownKey.current = null;
    };
  }, [targetKey]);
  // Each change of `ready` is a new readiness. A send the composer was not ready for, though
  // `ready` said it was, is taken again only in a later readiness of that same conversation.
  const readiness = useRef({ ready, count: 0 });
  const unready = useRef<{ readonly key: string; readonly count: number } | null>(null);
  useEffect(() => {
    if (readiness.current.ready !== ready)
      readiness.current = { ready, count: readiness.current.count + 1 };
    // Nothing asked anywhere, no conversation to send it in, or not yet known whether it takes one.
    if (requestKeys === "" || target === null || targetKey === null || admitting === "reading")
      return;
    // Its agent takes the turn, but its composer cannot send it yet.
    const heldBack =
      unready.current?.key === targetKey && unready.current.count === readiness.current.count;
    if (heldBecause === null && (!ready || heldBack)) return;
    const store = useComposerDraftStore.getState();
    const request = store.takeSendRequest(target);
    if (request === null || request.prompt.trim().length === 0) return;
    // Filed, its words went into the composer; the person sent or changed them by hand since.
    if (store.getComposerDraft(target)?.prompt.trim() !== request.prompt.trim()) {
      tellOutcome(request.ids, { kind: "taken-over" });
      return;
    }
    write(request.prompt);
    if (heldBecause !== null) {
      tellOutcome(request.ids, { kind: "waits", why: heldBecause });
      return;
    }
    const takenIn = { key: targetKey, count: readiness.current.count };
    const fileAgain = () => {
      const messageId = request.ids?.messageId;
      if (messageId !== undefined && awaiting.get(messageId)?.expired === true)
        return tellSendOutcome(messageId, { kind: "waits", why: NOT_TAKEN });
      useComposerDraftStore.getState().requestSend(target, request.prompt, request.ids);
    };
    setTimeout(() => {
      if (shownKey.current !== targetKey) return fileAgain();
      send(request.ids).then(
        (result) => {
          if (result.kind === "queued") return;
          if (result.kind !== "not-ready") return tellOutcome(request.ids, result);
          unready.current = takenIn;
          fileAgain();
        },
        () => tellOutcome(request.ids, { kind: "waits", why: BROKE }),
      );
    }, 0);
  }, [requestKeys, target, targetKey, admitting, heldBecause, ready]);
}
