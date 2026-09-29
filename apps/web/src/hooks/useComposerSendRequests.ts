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
 */
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";

import {
  useComposerDraftStore,
  type ComposerSendIds,
  type ComposerThreadTarget,
} from "../composerDraftStore";

const subscribe = useComposerDraftStore.subscribe;
const readRequestKeys = () =>
  Object.keys(useComposerDraftStore.getState().sendRequestsByThreadKey).join(",");
const noRequestKeys = () => "";

export function useComposerSendRequests(input: {
  /** The conversation this composer writes into; `null` while none is live. */
  readonly target: ComposerThreadTarget | null;
  /** `target` as a key: a send taken for one conversation never goes out in another. */
  readonly targetKey: string | null;
  /** Writes the request's words where the composer's send reads them. */
  readonly write: (prompt: string) => void;
  /** The composer's own send, with the ids the request carries. */
  readonly send: (ids: ComposerSendIds | undefined) => void;
}): void {
  const { target, targetKey } = input;
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
    // Nothing asked anywhere, or no conversation to send it in.
    if (requestKeys === "" || target === null || targetKey === null) return;
    const request = useComposerDraftStore.getState().takeSendRequest(target);
    if (request === null || request.prompt.trim().length === 0) return;
    write(request.prompt);
    setTimeout(() => {
      if (shownKey.current === targetKey) send(request.ids);
      else useComposerDraftStore.getState().requestSend(target, request.prompt, request.ids);
    }, 0);
  }, [requestKeys, target, targetKey]);
}
