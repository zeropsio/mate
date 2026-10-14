/**
 * What sits where the composer would, in a conversation on someone else's
 * agent (D6, `resolveZeropsConversationReadOnly`).
 *
 * The viewer reads the conversation and cannot act on the agent: there is no
 * prompt, no picker, no send or stop, and a question or approval the agent is
 * waiting on shows what it asks without a way to answer it. The one thing left
 * to do is the D6 way out — sign the agent in with one's own account.
 *
 * It wears the composer's own parts: the footer body is the composer's main
 * surface inside the glass host that `ChatView` wraps it in, and the pending
 * request stands at its top in the look it has for the person it waits on,
 * whom it names.
 */

import { AGENT_OWNERSHIP_RECOVERY_LABEL } from "@t3tools/client-runtime/zerops/agentSignIn";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { ZeropsConversationReadOnly } from "../ChatView.logic";
import { ComposerAskFace, useComposerAskName } from "../chat/ComposerAsk";
import { ComposerRoomHeld } from "../chat/ComposerStandIn";
import { ComposerPendingApprovalPanel } from "../chat/ComposerPendingApprovalPanel";
import { ComposerPendingUserInputReadOnlyPanel } from "../chat/ComposerPendingUserInputPanel";
import { Button } from "../ui/button";

export function ZeropsReadOnlyConversationFooter({
  readOnly,
  change = null,
  environmentId,
  pendingApprovals,
  pendingUserInputs,
  onSignIn,
}: {
  readonly readOnly: ZeropsConversationReadOnly;
  /**
   * Its change waiting for a review, as the composer's top shows the viewer's own (the owner's pick,
   * S6: "A colleague's Mate shows its change like yours"); what the agent asks stands there first.
   */
  readonly change?: ReactNode;
  /** Where the agent lives: its Mate's face and name ask. */
  readonly environmentId: EnvironmentId;
  readonly pendingApprovals: ReadonlyArray<PendingApproval>;
  readonly pendingUserInputs: PendingUserInput[];
  /** Its one action; absent where the viewer has none — a colleague's Mate is only read along. */
  readonly onSignIn?: (() => void) | undefined;
}) {
  const approval = pendingApprovals[0];
  const face = <ComposerAskFace environmentId={environmentId} />;
  const who = useComposerAskName(environmentId);
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl" data-zerops-read-only-conversation="true">
      {/* The composer's main surface: with a banner attached above, the shell hands its glass and
          outline to this element. */}
      <div data-chat-composer-main-surface="true" className="relative z-10 grid min-w-0">
        {/* Ownership arrives after history: keep the room held for its editor so the timeline's
            measured inset stays put. Larger questions and changes still take their own room. */}
        <div className="invisible col-start-1 row-start-1" aria-hidden>
          <ComposerRoomHeld />
        </div>
        <div className="col-start-1 row-start-1 flex min-w-0 flex-col justify-end">
          {approval !== undefined ? (
            <ComposerPendingApprovalPanel
              approval={approval}
              face={face}
              pendingCount={pendingApprovals.length}
              waitingLabel={readOnly.waitingLabel}
              who={who}
            />
          ) : pendingUserInputs.length > 0 ? (
            <ComposerPendingUserInputReadOnlyPanel
              face={face}
              pendingUserInputs={pendingUserInputs}
              waitingLabel={readOnly.waitingLabel}
              who={who}
            />
          ) : (
            change
          )}
          <div className="flex min-w-0 flex-col items-center gap-3 px-4 py-3 text-center">
            <p className="min-w-0 flex-1 text-foreground/85 text-sm">{readOnly.notice}</p>
            {onSignIn === undefined ? null : (
              <Button size="compact" variant="link" onClick={onSignIn}>
                {AGENT_OWNERSHIP_RECOVERY_LABEL}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
