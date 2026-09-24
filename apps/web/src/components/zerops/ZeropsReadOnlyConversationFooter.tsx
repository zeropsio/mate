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
 * composer's top drawer, and the footer body is the composer's glass host that
 * `ChatView` wraps it in.
 */

import { AGENT_OWNERSHIP_RECOVERY_LABEL } from "@t3tools/client-runtime/zerops/agentOwnership";
import { LockIcon } from "lucide-react";

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
  readonly onSignIn: () => void;
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
      <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[22px] px-4 py-3">
        <LockIcon aria-hidden="true" className="size-4 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 text-foreground/85 text-sm">{readOnly.notice}</p>
        <Button size="xs" onClick={onSignIn}>
          {AGENT_OWNERSHIP_RECOVERY_LABEL}
        </Button>
      </div>
    </div>
  );
}
