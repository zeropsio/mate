/**
 * A conversation's footer while its route cannot draw the conversation yet — the route gate's
 * stage, the chat layout's pending view, the conversation route's opening view: the composer's
 * room held at its draft's height (`ConversationFooterStandIn`), never a field that may turn out
 * to be someone else's. The conversation's own footer takes its place once it opens.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore } from "~/composerDraftStore";
import { ConversationFooterStandIn } from "./ConversationFooterStandIn";

export function RouteStandIn({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const draft = useComposerDraftStore((state) => state.getComposerDraft(threadRef)?.prompt ?? "");
  return <ConversationFooterStandIn draft={draft} />;
}
