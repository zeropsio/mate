/**
 * What stands at the foot of a conversation that is not open yet — a Mate's opening view, its own
 * page while its link is made — before its agents' sign-in says who writes there
 * (`conversationFooter` over an unknown answer): the composer where this browser last knew the
 * conversation as the viewer's, someone else's strip where it last knew it as theirs, else the
 * composer's room held empty. The conversation's own footer takes the same place once it opens.
 */
import {
  conversationFooter,
  type ConversationFooter,
} from "@t3tools/client-runtime/zerops/conversationWriter";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { rememberedWriter } from "~/zerops/writerMemory";
import { REMEMBERED_READ_ONLY } from "../ChatView.logic";
import { ComposerRoomHeld, ComposerStandInDock } from "../chat/ComposerStandIn";
import { ZeropsReadOnlyConversationFooter } from "./ZeropsReadOnlyConversationFooter";

/**
 * The footer a not-yet-open conversation stands in with: its own remembered answer — a page that
 * knows no conversation yet passes the Mate's main one, the one it opens on.
 */
export function standInFooter(conversation: ScopedThreadRef | null): ConversationFooter {
  return conversationFooter(
    { kind: "unknown" },
    conversation === null ? undefined : rememberedWriter(conversation),
  );
}

export function ConversationFooterStandIn({
  footer,
  composer,
}: {
  readonly footer: ConversationFooter;
  /** The composer standing in (`ComposerStandIn`), drawn only where the footer is the viewer's. */
  readonly composer: ReactNode;
}) {
  switch (footer) {
    case "composer":
      return composer;
    case "read-only":
      return (
        <ComposerStandInDock>
          {/* Only remembered: its sign-in comes with the read answer, in the conversation. */}
          <ZeropsReadOnlyConversationFooter
            pendingApprovals={[]}
            pendingUserInputs={[]}
            readOnly={REMEMBERED_READ_ONLY}
          />
        </ComposerStandInDock>
      );
    case "held":
      return (
        <ComposerStandInDock held>
          <ComposerRoomHeld />
        </ComposerStandInDock>
      );
  }
}
