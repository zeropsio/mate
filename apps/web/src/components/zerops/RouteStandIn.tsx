/**
 * A conversation's footer while its route cannot draw the conversation yet — the route gate's
 * stage, the chat layout's pending view, the conversation route's opening view: the composer's
 * room held at its draft's height (`ConversationFooterStandIn`), never a field that may turn out
 * to be someone else's; its box alone where the device remembers a composer here. The
 * conversation's own footer takes its place once it opens.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { readFooterBoxMemory, readFooterMemory } from "~/zerops/mateIdentityMemory";
import { ConversationFooterStandIn } from "./ConversationFooterStandIn";
import { footStanding } from "../chat/footStanding";

export function RouteStandIn({
  threadRef,
  opens = false,
}: {
  readonly threadRef: ScopedThreadRef;
  /**
   * The stage above it only opens the conversation (`stageOpens`). Under a stage with words of its
   * own the room is held unseen, as ever: a box nothing will fill is a dead control.
   */
  readonly opens?: boolean;
}) {
  const draft = useComposerDraftStore((state) => state.getComposerDraft(threadRef)?.prompt ?? "");
  // Where a composer stood at its last visit (`readFooterMemory`), its box stands from the first
  // frame, empty and inert; with nothing remembered its room is held unseen, as ever.
  const threadKey = scopedThreadKey(threadRef);
  const [stood] = useState(() => {
    const remembered = readFooterMemory(threadKey);
    // On a switch the foot holds what stood there (`footStanding`) until this conversation's own
    // is known; where the device remembers this conversation's foot, memory decides what it is.
    const standing = footStanding();
    return {
      box: remembered === "composer" || (remembered === undefined && standing !== undefined),
      // As tall as the box the person is looking at, else as it stood here at the last visit: a
      // question waiting over the field makes it taller than the room alone.
      height: standing ?? readFooterBoxMemory(threadKey),
    };
  });
  return (
    <ConversationFooterStandIn box={stood.height} boxStands={stood.box && opens} draft={draft} />
  );
}
