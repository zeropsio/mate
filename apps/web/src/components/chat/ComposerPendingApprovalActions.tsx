import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const APPROVAL_ACTION_CLASS_NAME = "font-normal";
const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  return (
    <>
      {options.map((option) => {
        const actionTone =
          option.decision === "accept"
            ? "primary"
            : option.decision === "acceptForSession"
              ? "secondary"
              : "quiet";
        const variant =
          actionTone === "primary"
            ? "pill"
            : actionTone === "secondary"
              ? "secondary"
              : "ghost-muted";

        return (
          <Button
            key={option.decision}
            size="sm"
            variant={variant}
            className={`${APPROVAL_ACTION_CLASS_NAME} h-auto min-h-7 max-w-full px-2.5 py-1.5`}
            data-approval-decision={option.decision}
            data-approval-action-tone={actionTone}
            disabled={isResponding}
            onClick={() => void onRespondToApproval(requestId, option.decision)}
          >
            <span className="max-w-48 whitespace-normal break-words text-center">
              {option.label}
            </span>
          </Button>
        );
      })}
    </>
  );
});
