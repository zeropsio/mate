import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import { memo } from "react";
import { EllipsisIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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
  // The row keeps the decisions a reader weighs: approve, the standing
  // approvals, and decline. Anything else (cancel, provider extras) waits
  // behind the overflow menu.
  const rowOptions = options.filter(isRowDecision);
  const moreOptions = options.filter((option) => !isRowDecision(option));

  return (
    <>
      {rowOptions.map((option) => {
        const actionTone =
          option.decision === "accept"
            ? "primary"
            : option.decision === "acceptForSession" || option.decision === "acceptAlways"
              ? "secondary"
              : "quiet";
        const variant =
          actionTone === "primary"
            ? "pill"
            : actionTone === "secondary"
              ? "secondary"
              : "ghost-muted";

        const button = (
          <Button
            key={option.decision}
            size="sm"
            variant={variant}
            className={`${APPROVAL_ACTION_CLASS_NAME} h-auto min-h-7 max-w-full px-2.5 py-1.5${
              option.warning ? " text-warning" : ""
            }`}
            data-approval-decision={option.decision}
            data-approval-action-tone={actionTone}
            disabled={isResponding}
            aria-description={option.warning}
            onClick={() => void onRespondToApproval(requestId, option.decision)}
          >
            {option.warning ? <TriangleAlertIcon className="size-3 shrink-0" /> : null}
            <span className="max-w-48 whitespace-normal break-words text-center">
              {option.label}
            </span>
          </Button>
        );
        // A provider caution, such as a prompt injection warning on "allow
        // always", rides along as a tooltip so the row stays one line.
        return option.warning ? (
          <Tooltip key={option.decision}>
            <TooltipTrigger render={button} />
            <TooltipPopup side="top" className="max-w-72 text-xs leading-snug">
              {option.warning}
            </TooltipPopup>
          </Tooltip>
        ) : (
          button
        );
      })}
      {moreOptions.length > 0 ? (
        <Menu>
          <MenuTrigger
            disabled={isResponding}
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                className="self-center"
                aria-label="More approval options"
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup side="top" align="end" className="w-56 max-w-[calc(100vw-2rem)]">
            {moreOptions.map((option) => {
              const item = (
                <MenuItem
                  key={option.decision}
                  disabled={isResponding}
                  aria-description={option.warning}
                  data-approval-decision={option.decision}
                  onClick={() => void onRespondToApproval(requestId, option.decision)}
                  variant="ghost"
                  className="mb-1 last:mb-0"
                >
                  {option.warning ? <TriangleAlertIcon className="size-3 text-warning" /> : null}
                  <span className="min-w-0 whitespace-normal wrap-break-word">{option.label}</span>
                </MenuItem>
              );
              return option.warning ? (
                <Tooltip key={option.decision}>
                  <TooltipTrigger render={item} />
                  <TooltipPopup side="top" className="max-w-64 text-xs leading-snug">
                    {option.warning}
                  </TooltipPopup>
                </Tooltip>
              ) : (
                item
              );
            })}
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
});

function isRowDecision(option: ProviderApprovalOption): boolean {
  return (
    option.decision === "accept" ||
    option.decision === "acceptForSession" ||
    option.decision === "acceptAlways" ||
    option.decision === "decline"
  );
}
