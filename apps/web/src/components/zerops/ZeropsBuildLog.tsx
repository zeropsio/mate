/**
 * A deploy's build log, under the step that runs the build: while it runs,
 * its newest lines — a glance at what the build is doing — and one link to
 * the whole log, which opens in a dialog of its own: every line, scrollable,
 * following the newest while it is read at the bottom. The log itself is
 * never inline: a fixed tail could not be scrolled where it stood,
 * stood apart from its step and was context nobody reading the conversation
 * needs (the owner, 2026-09-26: "it should be opened in like a live dialog or
 * something instead of inline" — "or if you want some mini version inline it
 * should be under the actual step").
 *
 * Presentational only (R2): the caller (`useOperationCard.ts`) owns fetching
 * the lines and whether the dialog is open.
 */
import { ChevronRightIcon } from "lucide-react";
import { useLayoutEffect, useRef, type JSX } from "react";

import { foldBuildLogLines } from "@t3tools/client-runtime/zerops/activity/buildLog";

import { cn } from "~/lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";

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
  /** Whether the whole log's dialog is open. */
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Whose build it is, for the dialog's title. */
  readonly subject?: string | undefined;
}

/** zcp's `mapSeverityToNumeric`: 0 (emergency) through 3 (error) are the tones worth flagging red. */
const FAILED_SEVERITY_MAX = 3;

/** The newest lines shown under the build step while it runs. */
const GLANCE_ROWS = 2;

const lineCount = (count: number): string | undefined =>
  count === 0 ? undefined : `${count.toLocaleString("en-US")} ${count === 1 ? "line" : "lines"}`;

export function ZeropsBuildLog({
  lines,
  onToggle,
  open,
  status,
  subject,
}: ZeropsBuildLogProps): JSX.Element {
  const count = lineCount(lines.length);
  const glance = status === "live" ? foldBuildLogLines(lines).slice(-GLANCE_ROWS) : [];
  return (
    <div className="mt-1" data-zerops-build-log data-zerops-build-log-status={status}>
      {glance.length > 0 ? (
        <ol
          aria-label="The build's newest lines"
          className="font-mono text-muted-foreground text-xs leading-5"
          data-zerops-build-log-glance
        >
          {glance.map((row) => (
            <li
              className={cn(
                "flex min-w-0 gap-1.5",
                row.severity <= FAILED_SEVERITY_MAX && "text-destructive-foreground",
              )}
              data-zerops-build-log-line
              data-zerops-build-log-severity={row.severity}
              key={row.id}
            >
              <span className="min-w-0 truncate">{row.text}</span>
              {row.count > 1 ? (
                <span className="shrink-0" data-zerops-build-log-repeat>
                  ×{row.count}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <button
        aria-haspopup="dialog"
        className="group/log inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
        data-zerops-build-log-toggle
        onClick={onToggle}
        type="button"
      >
        <span className="text-foreground">Build log</span>
        {count !== undefined ? (
          <span className="tabular-nums" data-zerops-build-log-count>
            {count}
          </span>
        ) : null}
        <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
      </button>
      <Dialog
        onOpenChange={(next) => {
          if (!next) onToggle();
        }}
        open={open}
      >
        <DialogPopup className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {subject === undefined ? "Build log" : `${subject} · build log`}
            </DialogTitle>
            <DialogDescription>
              {[count, status === "live" ? "live" : null].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <BuildLogLines lines={lines} live={status === "live"} />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

/**
 * Every line of the log, in full and wrapped, scrollable; while the build
 * runs and the reader is at the bottom, it follows the newest line.
 */
export function BuildLogLines({
  lines,
  live,
}: {
  readonly lines: ReadonlyArray<ZeropsBuildLogLine>;
  readonly live: boolean;
}): JSX.Element {
  const scrollerRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    // A line arriving is a row added: held at the newest while followed.
    const pin = () => {
      if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    pin();
    const observer = new MutationObserver(pin);
    observer.observe(scroller, { childList: true });
    return () => observer.disconnect();
  }, []);
  return (
    <ol
      ref={scrollerRef}
      aria-label="Build log"
      aria-live={live ? "polite" : undefined}
      className="h-120 overflow-y-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-xs leading-5"
      data-zerops-build-log-body
      onScroll={(event) => {
        const scroller = event.currentTarget;
        followingRef.current =
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4;
      }}
    >
      {lines.map((line) => (
        <li
          className={cn(
            "whitespace-pre-wrap break-words",
            line.severity <= FAILED_SEVERITY_MAX && "text-destructive-foreground",
          )}
          data-zerops-build-log-line
          data-zerops-build-log-severity={line.severity}
          key={line.id}
        >
          {line.text}
        </li>
      ))}
    </ol>
  );
}
