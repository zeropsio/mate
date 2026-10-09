/**
 * What sits where the composer would, in a conversation on someone else's
 * agent (D6, `resolveZeropsConversationReadOnly`).
 *
 * The viewer reads the conversation and cannot act on the agent: there is no
 * prompt, no picker, no send or stop, and a question or approval the agent is
 * waiting on shows what it asks without a way to answer it. The one thing left
 * to do is the D6 way out — sign the agent in with one's own account.
 *
 * It wears the composer's own parts: the pending request sits in the
 * composer's top drawer, and the footer body is the composer's main surface
 * inside the glass host that `ChatView` wraps it in.
 */

import { AGENT_OWNERSHIP_RECOVERY_LABEL } from "@t3tools/client-runtime/zerops/agentOwnership";

import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { ZeropsConversationReadOnly } from "../ChatView.logic";
import { ComposerPendingApprovalPanel } from "../chat/ComposerPendingApprovalPanel";
import { ComposerPendingUserInputReadOnlyPanel } from "../chat/ComposerPendingUserInputPanel";
import { Button } from "../ui/button";

export function ZeropsReadOnlyConversationFooter({
  readOnly,
  pendingApprovals,
  pendingUserInputs,
  onSignIn,
}: {
  readonly readOnly: ZeropsConversationReadOnly;
  readonly pendingApprovals: ReadonlyArray<PendingApproval>;
  readonly pendingUserInputs: PendingUserInput[];
  /** Its one action; absent where the answer is only remembered, until it is read. */
  readonly onSignIn?: (() => void) | undefined;
}) {
  const approval = pendingApprovals[0];
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl" data-zerops-read-only-conversation="true">
      {approval !== undefined ? (
        <div
          className="chat-composer-top-drawer"
          data-chat-composer-top-drawer="true"
          data-variant="warning"
        >
          <div className="flex min-w-0 px-3 py-1.5 sm:px-4">
            <ComposerPendingApprovalPanel
              approval={approval}
              pendingCount={pendingApprovals.length}
              waitingLabel={readOnly.waitingLabel}
            />
          </div>
        </div>
      ) : pendingUserInputs.length > 0 ? (
        <div
          className="chat-composer-top-drawer"
          data-chat-composer-top-drawer="true"
          data-variant="info"
        >
          <ComposerPendingUserInputReadOnlyPanel
            pendingUserInputs={pendingUserInputs}
            waitingLabel={readOnly.waitingLabel}
          />
        </div>
      ) : null}
      {/* The composer's main surface: with a banner or drawer attached above,
          the shell hands its glass and outline to this element. */}
      <div
        data-chat-composer-main-surface="true"
        className="relative z-10 flex min-w-0 flex-col items-center gap-3 px-4 py-3 text-center"
      >
        <p className="min-w-0 flex-1 text-foreground/85 text-sm">{readOnly.notice}</p>
        {onSignIn === undefined ? (
          // The action's row height kept, so the strip is the height it will be once it comes.
          <span aria-hidden="true" className="h-7 w-0 shrink-0 sm:h-6" />
        ) : (
          <Button size="compact" variant="link" onClick={onSignIn}>
            {AGENT_OWNERSHIP_RECOVERY_LABEL}
          </Button>
        )}
      </div>
    </div>
  );
}
