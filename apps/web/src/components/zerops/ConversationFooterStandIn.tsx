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
import type { EnvironmentId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { rememberedWriter } from "~/zerops/writerMemory";
import { resolveZeropsConversationReadOnly } from "../ChatView.logic";
import { ComposerRoomHeld, ComposerStandInDock } from "../chat/ComposerStandIn";
import { ZeropsReadOnlyConversationFooter } from "./ZeropsReadOnlyConversationFooter";

/** The footer a not-yet-open conversation in `environmentId` stands in with. */
export function standInFooter(environmentId: EnvironmentId | null): ConversationFooter {
  return conversationFooter(
    { kind: "unknown" },
    environmentId === null ? undefined : rememberedWriter(environmentId),
  );
}

/** Someone else's conversation, as its footer will say it — named as it was last known. */
export const REMEMBERED_READ_ONLY = resolveZeropsConversationReadOnly({
  agent: { flagToken: false },
  ownership: "someone-else",
})!;

const nothing = () => undefined;

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
          {/* Its sign-in answers once the conversation is open, as its own footer's does. */}
          <div className="contents" inert>
            <ZeropsReadOnlyConversationFooter
              onSignIn={nothing}
              pendingApprovals={[]}
              pendingUserInputs={[]}
              readOnly={REMEMBERED_READ_ONLY}
            />
          </div>
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
