/**
 * A deploy's build log, under the step that runs the build, once the build
 * has written a line: while it runs, its newest lines — a glance at what the
 * build is doing — and one link to the whole log, which opens in a dialog of
 * its own: every line, scrollable, following the newest while it is read at
 * the bottom. The log itself is
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
  /** A settled build's: the way to its log stands before its lines are read. */
  readonly stands?: boolean;
}

/** zcp's `mapSeverityToNumeric`: 0 (emergency) through 3 (error) are the tones worth flagging red. */
const FAILED_SEVERITY_MAX = 3;

/** What a log with no line to draw says in its dialog: read failed, still reading, or gone. */
export function emptyLogWords(status: ZeropsBuildLogStatus): string {
  switch (status) {
    case "error":
      return "Couldn't read this build's log from Zerops.";
    case "idle":
    case "loading":
      return "Reading this build's log…";
    default:
      return "Zerops keeps no lines of this build's log.";
  }
}

const lineCount = (count: number): string | undefined =>
  count === 0 ? undefined : `${count.toLocaleString("en-US")} ${count === 1 ? "line" : "lines"}`;

export function ZeropsBuildLog({
  lines,
  onToggle,
  open,
  stands = false,
  status,
  subject,
}: ZeropsBuildLogProps): JSX.Element | null {
  // A running build's way to its log stands from the first draw, so its row
  // never moves when the first line lands; a settled one's stands while its
  // lines are read. No room is held for lines under the step (the owner,
  // 2026-10-05: "a premade space for … logs").
  const live = !stands && status !== "ended" && status !== "error";
  if (lines.length === 0 && !stands && !live) return null;
  // Nothing to open until a running build writes its first line.
  const openable = stands || lines.length > 0;
  const count = lineCount(lines.length);
  return (
    <span
      className="inline-flex shrink-0"
      data-zerops-build-log
      data-zerops-build-log-status={status}
    >
      <button
        aria-haspopup="dialog"
        aria-hidden={openable ? undefined : true}
        aria-label={count === undefined ? "Open the build's log" : `Open the build's log, ${count}`}
        className={cn(
          "group/log inline-flex h-5 items-center gap-0.5 text-muted-foreground text-xs transition-colors hover:text-foreground",
          !openable && "invisible",
        )}
        data-zerops-build-log-toggle
        disabled={!openable}
        onClick={onToggle}
        tabIndex={openable ? undefined : -1}
        type="button"
      >
        Log
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
            {lines.length === 0 ? (
              <p className="text-muted-foreground text-sm" data-zerops-build-log-empty>
                {emptyLogWords(status)}
              </p>
            ) : (
              <BuildLogLines lines={lines} live={status === "live"} />
            )}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </span>
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
