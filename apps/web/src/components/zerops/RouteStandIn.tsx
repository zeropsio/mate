/**
 * A conversation's composer stand-in while its route cannot draw the conversation yet — the route
 * gate's stage, the chat layout's pending view, the conversation route's opening view — typing
 * into the conversation's own draft. Each phase draws its own, so where it was left travels in
 * `standInMemory`: the next one takes the caret, and the focus when it was handed over at once.
 *
 * Only where this browser last knew the conversation as the viewer's: before its agents' sign-in
 * is read, anything else stands in with someone else's strip or the composer's room held
 * (`ConversationFooterStandIn`) — never a field that may turn out to be someone else's.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { standInForConversation } from "~/zerops/mateHandOver";
import { standInToRestore, withStandIn, type StandInMemory } from "~/zerops/standInMemory";
import { ComposerStandIn } from "../chat/ComposerStandIn";
import { composerThreadControlKey, rememberedComposerControl } from "../chat/composerControlMemory";
import { ConversationFooterStandIn, standInFooter } from "./ConversationFooterStandIn";

let memory: StandInMemory = new Map();
const remember = (key: string, patch: Parameters<typeof withStandIn>[2]) => {
  memory = withStandIn(memory, key, patch);
};

export function RouteStandIn({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  return (
    <ConversationFooterStandIn
      composer={<RouteComposerStandIn threadRef={threadRef} />}
      footer={standInFooter(threadRef)}
    />
  );
}

function RouteComposerStandIn({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const key = scopedThreadKey(threadRef);
  const draft = useComposerDraftStore((state) => state.getComposerDraft(threadRef)?.prompt ?? "");
  const [restore] = useState(() => standInToRestore(memory, key, Date.now()));
  // The conversation's control as it last stood, so the toolbar has its look from the first frame.
  const [control] = useState(() => rememberedComposerControl(composerThreadControlKey(key)));
  const [caret, setCaret] = useState(() => restore.caret ?? draft.length);
  const box = useRef<HTMLDivElement>(null);
  // Picked up where the last phase's stand-in went, in the same frame it is drawn.
  useLayoutEffect(() => {
    remember(key, { leftAtMs: null });
    if (!restore.focus) return;
    const field = box.current?.querySelector("textarea");
    if (field === null || field === undefined) return;
    field.focus();
    field.setSelectionRange(caret, caret);
    // Once, as it is drawn: what it restores is read at its first render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => remember(key, { leftAtMs: Date.now() }), [key]);
  // Standing in for its conversation: the conversation takes over with the caret where it was
  // typed (`mateHandOver`).
  const standIn = useRef<ReturnType<typeof standInForConversation> | null>(null);
  useLayoutEffect(() => {
    const standing = standInForConversation(key);
    standIn.current = standing;
    return () => {
      standIn.current = null;
      standing.release(Date.now());
    };
  }, [key]);
  return (
    <div
      className="contents"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          remember(key, { focused: false });
        }
      }}
      onFocus={() => remember(key, { focused: true })}
      ref={box}
    >
      <ComposerStandIn
        control={control ?? null}
        onType={(next) => {
          useComposerDraftStore.getState().setPrompt(threadRef, next.text);
          setCaret(next.caret);
          remember(key, { caret: next.caret });
          standIn.current?.caret(next.caret);
        }}
        typed={{ text: draft, caret: Math.min(caret, draft.length) }}
      />
    </div>
  );
}
