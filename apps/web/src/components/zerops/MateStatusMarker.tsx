import type { TimestampFormat } from "@t3tools/contracts/settings";
import { CircleAlertIcon, CircleHelpIcon, LogInIcon, PauseIcon } from "lucide-react";
import {
  mateStatusWords,
  type MateStatus,
  type MateStatusAsk,
} from "../../zerops/mateStatus.logic";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

/**
 * The same short status beside the menu preview and the conversation name. With `onOpen` it is a
 * button that leads to what the status waits on (a waiting Mate's ask); without, words alone.
 * `ask` is what the open conversation knows of that ask, for the hover (`MateStatusAsk`).
 */
export function MateStatusMarker({
  status,
  onOpen,
  ask,
  timestampFormat,
  mateName = "The Mate",
}: {
  readonly mateName?: string | undefined;
  readonly onOpen?: (() => void) | undefined;
  readonly ask?: MateStatusAsk | undefined;
  readonly status: MateStatus;
  readonly timestampFormat: TimestampFormat;
}) {
  const Icon =
    status.kind === "broken" || status.kind === "interrupted"
      ? CircleAlertIcon
      : status.kind === "sign-in"
        ? LogInIcon
        : status.kind === "answer"
          ? CircleHelpIcon
          : PauseIcon;
  const { label, cause } = mateStatusWords(status, mateName, timestampFormat, ask);
  const marks = {
    className: cn(
      "inline-flex min-w-0 items-center gap-1.5 text-xs font-medium",
      status.severity === "danger" ? "text-error" : "text-status-attention-text",
      onOpen !== undefined &&
        "cursor-pointer rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
    ),
    "data-agent-admission-summary": status.admission?.key,
    "data-mate-status": status.kind,
    "aria-label": cause,
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          onOpen === undefined ? (
            <span {...marks} role="status" />
          ) : (
            <button {...marks} onClick={onOpen} type="button" />
          )
        }
      >
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        {/* On a phone's header its words would draw over the Mate's name (390 px): the icon stays,
            and its name and tooltip say the rest. */}
        <span className="truncate @max-md/header-actions:hidden">
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
