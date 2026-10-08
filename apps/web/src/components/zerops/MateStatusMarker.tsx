import { usageLimitWords } from "../../zerops/noticeWords";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { CircleAlertIcon, CircleHelpIcon, LogInIcon, PauseIcon } from "lucide-react";
import type { MateStatus } from "../../zerops/mateStatus.logic";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

/** The same short status beside the menu preview and the conversation name. */
export function MateStatusMarker({
  status,
  timestampFormat,
  mateName = "The Mate",
}: {
  readonly mateName?: string | undefined;
  readonly status: MateStatus;
  readonly timestampFormat: TimestampFormat;
}) {
  const Icon =
    status.kind === "broken"
      ? CircleAlertIcon
      : status.kind === "sign-in"
        ? LogInIcon
        : status.kind === "answer"
          ? CircleHelpIcon
          : PauseIcon;
  const label =
    status.kind === "limit"
      ? "Limit"
      : status.kind === "sign-in"
        ? "Sign in"
        : status.kind === "answer"
          ? "Needs an answer"
          : "Needs attention";
  const cause =
    status.kind === "limit"
      ? usageLimitWords(
          status.provider ?? "coding agent",
          status.until === undefined
            ? undefined
            : formatUpcomingTimestamp(status.until, timestampFormat),
          mateName,
        )
      : `${mateName}: ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 text-xs font-medium",
              status.severity === "danger" ? "text-error" : "text-status-attention-text",
            )}
            data-mate-status={status.kind}
            aria-label={cause}
            role="status"
          />
        }
      >
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">
          {label}
          {status.until === undefined
            ? null
            : ` · until ${formatUpcomingTimestamp(status.until, timestampFormat)}`}
        </span>
      </TooltipTrigger>
      <TooltipPopup>{cause}</TooltipPopup>
    </Tooltip>
  );
}
