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
 * waits.
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

/** What became of a requested send: it went out, or its words wait in the composer, and why. */
export type ComposerSendOutcome =
  | { readonly sent: true }
  | { readonly sent: false; readonly why: string };

const awaiting = new Map<MessageId, (outcome: ComposerSendOutcome) => void>();

/** What becomes of the requested send carrying `messageId`; asked before the request is filed. */
export function sendOutcomeOf(messageId: MessageId): Promise<ComposerSendOutcome> {
  return new Promise((resolve) => awaiting.set(messageId, resolve));
}

function tellOutcome(ids: ComposerSendIds | undefined, outcome: ComposerSendOutcome): void {
  if (ids === undefined) return;
  awaiting.get(ids.messageId)?.(outcome);
  awaiting.delete(ids.messageId);
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
  /** Writes the request's words where the composer's send reads them. */
  readonly write: (prompt: string) => void;
  /** The composer's own send, with the ids the request carries. */
  readonly send: (ids: ComposerSendIds | undefined) => void;
}): void {
  const { target, targetKey } = input;
  const admitting = input.admits.kind;
  const heldBecause = input.admits.kind === "holds" ? input.admits.why : null;
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
  useEffect(() => {
    // Nothing asked anywhere, no conversation to send it in, or not yet known whether it takes one.
    if (requestKeys === "" || target === null || targetKey === null || admitting === "reading")
      return;
    const request = useComposerDraftStore.getState().takeSendRequest(target);
    if (request === null || request.prompt.trim().length === 0) return;
    write(request.prompt);
    if (heldBecause !== null) {
      tellOutcome(request.ids, { sent: false, why: heldBecause });
      return;
    }
    setTimeout(() => {
      if (shownKey.current === targetKey) {
        send(request.ids);
        tellOutcome(request.ids, { sent: true });
      } else useComposerDraftStore.getState().requestSend(target, request.prompt, request.ids);
    }, 0);
  }, [requestKeys, target, targetKey, admitting, heldBecause]);
}
