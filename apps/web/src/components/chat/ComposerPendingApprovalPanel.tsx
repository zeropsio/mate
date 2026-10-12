import { memo, type ReactNode } from "react";
import { type PendingApproval } from "../../session-logic";
import { cn } from "~/lib/utils";

import { ComposerAsk, ComposerAskMark } from "./ComposerAsk";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  /** Whom the approval waits on, named where it is someone else's agent; the viewer without one. */
  waitingLabel?: string;
  /** The asking Mate's face (`ComposerAskFace`); a plain agent's mark without one. */
  face?: ReactNode;
  /** Who asks, by name. */
  who?: string;
  /** Its decisions: Approve the one blue button, the rest quiet. */
  actions?: ReactNode;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  waitingLabel,
  face,
  who = "The agent",
  actions,
}: ComposerPendingApprovalPanelProps) {
  // An app-access request is a sentence for a person; commands and paths
  // stay monospaced and unwrapped.
  const Detail = approval.requestKind === "mcp-elicitation" ? "span" : "code";
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access approval"
      : approval.requestKind === "command"
        ? "Command approval"
        : approval.requestKind === "file-read"
          ? "File read approval"
          : approval.requestKind === "permission"
            ? "App permission approval"
            : "File change approval";
  const requestKind =
    approval.requestKind === "mcp-elicitation"
      ? "app-access-approval"
      : approval.requestKind === "command"
        ? "command-approval"
        : approval.requestKind === "file-read"
          ? "file-read-approval"
          : approval.requestKind === "permission"
            ? "app-permission-approval"
            : "file-change-approval";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access request"
      : approval.requestKind === "command"
        ? "Command"
        : approval.requestKind === "file-read"
          ? "File to read"
          : approval.requestKind === "permission"
            ? "Permission request"
            : "File change";

  // What it asks, as the Mate would say it: the face's needs pose says it waits on the person.
  const asks =
    approval.requestKind === "mcp-elicitation"
      ? approval.appName
        ? "asks for access to"
        : "asks for access to an app"
      : approval.requestKind === "command"
        ? "wants to run this command"
        : approval.requestKind === "file-read"
          ? "wants to read this file"
          : approval.requestKind === "permission"
            ? "asks for a permission"
            : "wants to change files";

  return (
    <ComposerAsk
      actions={actions}
      face={face ?? <ComposerAskMark />}
      kind="approval"
      label={fallbackLabel}
      title={
        <>
          {/* The face's needs pose says it waits on the viewer; anyone else is named. */}
          {waitingLabel === undefined ? <span className="sr-only">Waiting for you</span> : null}
          <span data-pending-request-kind={requestKind}>{`${who} ${asks}`}</span>
          {approval.appName ? (
            <>
              {" "}
              <span>{approval.appName}</span>
            </>
          ) : null}
          {pendingCount > 1 ? (
            <span
              className="font-normal text-muted-foreground tabular-nums"
              data-pending-request-progress={`1/${pendingCount}`}
            >
              {` · 1 of ${pendingCount}`}
            </span>
          ) : null}
          {waitingLabel === undefined ? null : (
            <span className="font-normal text-muted-foreground">
              {" · "}
              <span>{waitingLabel}</span>
            </span>
          )}
        </>
      }
    >
      {/* What it would do, the whole width under the sentence: what is approved can be read. */}
      <Detail
        aria-label={detailAriaLabel}
        className={cn(
          "block max-h-20 min-w-0 w-full overflow-auto text-line text-muted-foreground leading-4.5 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5",
          approval.requestKind === "mcp-elicitation"
            ? "whitespace-pre-wrap font-sans wrap-break-word"
            : "whitespace-pre font-mono",
        )}
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.detail || fallbackLabel}
      </Detail>
    </ComposerAsk>
  );
});
