/**
 * The build-log tail inside a running/settled deploy card's observed region —
 * `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §5.
 * Presentational only (R2): the caller (`useOperationCard.ts`) owns fetching
 * the lines and the open/closed state; this renders them and reports scroll
 * intent back.
 */
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useRef, type JSX, type UIEvent } from "react";

import { cn } from "~/lib/utils";

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

/** How close to the bottom (px) still counts as "pinned" after a scroll. */
const PINNED_THRESHOLD_PX = 24;

export function ZeropsBuildLog({
  lines,
  onToggle,
  open,
  status,
}: ZeropsBuildLogProps): JSX.Element {
  const pinnedRef = useRef(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  function handleBodyRef(node: HTMLDivElement | null): void {
    bodyRef.current = node;
    if (node !== null && status === "live" && pinnedRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const el = event.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PINNED_THRESHOLD_PX;
  }

  return (
    <div data-zerops-build-log data-zerops-build-log-status={status}>
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-foreground uppercase tracking-wide"
        data-zerops-build-log-toggle
        onClick={onToggle}
        type="button"
      >
        <span className="flex items-center gap-1.5">
          <span>Build log</span>
          <span data-zerops-build-log-count>{lines.length}</span>
        </span>
        {open ? (
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
        )}
      </button>
      {open ? (
        <div
          className="max-h-56 overflow-auto whitespace-pre rounded-md bg-background/60 p-2 font-mono text-[11.5px] leading-relaxed"
          data-zerops-build-log-body
          onScroll={handleScroll}
          ref={handleBodyRef}
        >
          {lines.map((line) => (
            <div
              className={cn(
                line.severity <= FAILED_SEVERITY_MAX && "text-[var(--zerops-status-failed)]",
              )}
              data-zerops-build-log-line
              data-zerops-build-log-severity={line.severity}
              key={line.id}
            >
              {line.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
