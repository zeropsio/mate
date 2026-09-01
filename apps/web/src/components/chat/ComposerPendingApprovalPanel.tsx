import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { StatusDot } from "../zerops/primitives";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access approval"
      : approval.requestKind === "command"
        ? "Command approval"
        : approval.requestKind === "file-read"
          ? "File read approval"
          : "File change approval";
  const requestKind =
    approval.requestKind === "mcp-elicitation"
      ? "app-access-approval"
      : approval.requestKind === "command"
        ? "command-approval"
        : approval.requestKind === "file-read"
          ? "file-read-approval"
          : "file-change-approval";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access request"
      : approval.requestKind === "command"
        ? "Command"
        : approval.requestKind === "file-read"
          ? "File to read"
          : "File change";

  return (
    <div
      aria-label={fallbackLabel}
      className={cn("flex min-w-0 flex-1 basis-64 flex-col items-stretch gap-1.5", className)}
      role="group"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StatusDot label="WAITING FOR YOU" pulse={false} tone="attention" />
        <span
          className="text-xs font-medium text-foreground/85"
          data-pending-request-kind={requestKind}
        >
          {fallbackLabel}
        </span>
        {approval.appName ? (
          <span className="max-w-32 shrink truncate text-[11px] font-medium text-foreground">
            {approval.appName}
          </span>
        ) : null}
        {pendingCount > 1 ? (
          <span
            className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums"
            data-pending-request-progress={`1/${pendingCount}`}
          >
            1/{pendingCount}
          </span>
        ) : null}
      </div>
      <code
        aria-label={detailAriaLabel}
        className="block max-h-20 min-w-0 w-full overflow-auto whitespace-pre font-mono text-[11px] text-foreground/85 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5"
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.detail || fallbackLabel}
      </code>
    </div>
  );
});
