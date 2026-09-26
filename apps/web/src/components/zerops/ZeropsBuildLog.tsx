/**
 * The build log inside a deploy card's observed region —
 * `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §5.
 * A tail of its last eight rows, the height held from the first frame so a
 * line arriving never moves the card. Each row is one line cut with an
 * ellipsis — the whole line in its tooltip, never a sideways scroll — or a
 * run of lines alike but for one package, folded into its newest line with
 * a count (`foldBuildLogLines`).
 *
 * Presentational only (R2): the caller (`useOperationCard.ts`) owns fetching
 * the lines and the open/closed state.
 */
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { JSX } from "react";

import { foldBuildLogLines } from "@t3tools/client-runtime/zerops/activity/buildLog";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

export interface ZeropsBuildLogLine {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  readonly severity: number;
}

export type ZeropsBuildLogStatus = "idle" | "loading" | "live" | "ended" | "error";

export interface ZeropsBuildLogProps {
  readonly lines: ReadonlyArray<ZeropsBuildLogLine>;
  readonly status: ZeropsBuildLogStatus;
  readonly open: boolean;
  readonly onToggle: () => void;
}

/** zcp's `mapSeverityToNumeric`: 0 (emergency) through 3 (error) are the tones worth flagging red. */
const FAILED_SEVERITY_MAX = 3;

/** The tail's rows — its box is this many lines tall from the first frame. */
const TAIL_ROWS = 8;

const lineCount = (count: number): string | undefined =>
  count === 0 ? undefined : `${count.toLocaleString("en-US")} ${count === 1 ? "line" : "lines"}`;

export function ZeropsBuildLog({
  lines,
  onToggle,
  open,
  status,
}: ZeropsBuildLogProps): JSX.Element {
  const count = lineCount(lines.length);
  const rows = open ? foldBuildLogLines(lines).slice(-TAIL_ROWS) : [];
  return (
    <div data-zerops-build-log data-zerops-build-log-status={status}>
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-muted-foreground text-xs"
        data-zerops-build-log-toggle
        onClick={onToggle}
        type="button"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-foreground">Build log</span>
          {count !== undefined ? (
            <span className="tabular-nums" data-zerops-build-log-count>
              {count}
            </span>
          ) : null}
        </span>
        {open ? (
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
        )}
      </button>
      {open ? (
        <ol
          aria-label="Build log tail"
          className="mt-1 box-content h-40 overflow-hidden rounded-md bg-muted/60 px-2 py-1.5 font-mono text-xs leading-5"
          data-zerops-build-log-body
        >
          {rows.map((row) => (
            <li
              className={cn(
                "flex min-w-0 gap-1.5",
                row.severity <= FAILED_SEVERITY_MAX && "text-destructive-foreground",
              )}
              data-zerops-build-log-line
              data-zerops-build-log-severity={row.severity}
              key={row.id}
            >
              <Tooltip>
                <TooltipTrigger render={<span className="min-w-0 truncate" />}>
                  {row.text}
                </TooltipTrigger>
                <TooltipPopup side="top" variant="code">
                  {row.text}
                </TooltipPopup>
              </Tooltip>
              {row.count > 1 ? (
                <span className="shrink-0 text-muted-foreground" data-zerops-build-log-repeat>
                  ×{row.count}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
