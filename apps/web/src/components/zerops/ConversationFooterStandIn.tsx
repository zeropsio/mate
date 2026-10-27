/**
 * What stands at the foot of a conversation that is not open yet — a Mate's opening view, its own
 * page while its link is made: the composer's room held empty at its draft's height, before who
 * writes there is known (`conversationFooter`). The conversation's own footer takes the same place
 * once it opens.
 */
import { ComposerRoomHeld, ComposerStandInDock } from "../chat/ComposerStandIn";

export function ConversationFooterStandIn({
  draft = "",
}: {
  /** The conversation's draft, which the held room lays out at the composer's height. */
  readonly draft?: string;
}) {
  return (
    <ComposerStandInDock held>
      <ComposerRoomHeld draft={draft} />
    </ComposerStandInDock>
  );
}
