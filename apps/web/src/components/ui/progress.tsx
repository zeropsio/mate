import { CheckIcon, CircleAlertIcon, CircleDashedIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { FailureDetails } from "./failure";
import { progressClock, progressFraction, type ProgressState } from "./progress.logic";

/** Now, once a second while `ticking`: the clock reads the start time on every paint. */
function useSecondClock(ticking: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return nowMs;
}

/** The highest value seen for `key`: the bar never takes a step back, even when its input does. */
function useForwardOnly(value: number, key: string): number {
  const [high, setHigh] = useState({ key, value });
  if (high.key !== key || value > high.value) {
    setHigh({ key, value });
    return value;
  }
  return high.value;
}

export type ProgressView =
  | { readonly state: "running" }
  | {
      readonly state: "done";
      /** What it made, as the line it becomes: "HQ is ready". */
      readonly result: ReactNode;
      /** Where to go next, at the row's end: "Open HQ". */
      readonly action?: ReactNode;
    }
  | {
      readonly state: "failed";
      /** Why it stopped, in the person's words. */
      readonly cause: ReactNode;
      /** The one action that fixes the cause, at the row's end. */
      readonly action?: ReactNode;
      /** The source's own words, folded under Details. */
      readonly details?: ReactNode;
    };

const RUNNING: ProgressView = { state: "running" };

/**
 * A long operation, as one row: the step it is on in words that replace themselves in place (never
 * a growing list), its clock beside an honest estimate that says when it overruns, and a bar that
 * only moves forward. Done, the row becomes its result; stopped, it says why and offers the one
 * action that fixes it — the clock and the bar stay where they stopped.
 */
function Progress({
  steps,
  at,
  view = RUNNING,
  startedAtMs = null,
  endedAtMs = null,
  estimateMs = null,
  nowMs,
  identity = "",
  className,
  label,
}: {
  /** Each step's words while it runs: "Deploying HQ". */
  readonly steps: readonly string[];
  /** The step it is on, from 0. */
  readonly at: number;
  readonly view?: ProgressView;
  /** When it began, from the source's evidence; `null` when unknown — the row then has no clock. */
  readonly startedAtMs?: number | null;
  /** When it ended, done or stopped: the clock stays there. */
  readonly endedAtMs?: number | null;
  /** The measured usual duration of the whole operation. */
  readonly estimateMs?: number | null;
  /** The caller's clock, when it has one; else the row keeps its own, once a second. */
  readonly nowMs?: number;
  /** The operation's identity: a new one starts its bar afresh. */
  readonly identity?: string;
  readonly className?: string;
  /** The operation's name for assistive technology: "Setting up HQ". */
  readonly label: string;
}) {
  const state: ProgressState = view.state;
  // A step once reached stays reached: an input that lags behind never takes the row back.
  const reached = useForwardOnly(at, `${identity}:step`);
  const ownNow = useSecondClock(nowMs === undefined && state === "running");
  const now = nowMs ?? ownNow;
  const ended = state === "running" ? null : (endedAtMs ?? now);
  // An ended row whose end is unknown says no time rather than one it would make up.
  const clock = progressClock({
    startedAtMs: state !== "running" && endedAtMs === null ? null : startedAtMs,
    nowMs: now,
    endedAtMs: ended,
    estimateMs,
  });
  const fraction = useForwardOnly(
    progressFraction({
      at: reached,
      count: steps.length,
      elapsedMs: startedAtMs === null ? null : (ended ?? now) - startedAtMs,
      estimateMs,
      state,
    }),
    identity,
  );
  const step = steps[Math.min(Math.max(0, reached), steps.length - 1)] ?? "";
  const words = view.state === "done" ? view.result : view.state === "failed" ? view.cause : step;
  const action = view.state === "running" ? null : (view.action ?? null);
  const time = [clock.elapsed, clock.note].filter((part) => part !== null).join(" · ");
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-progress-state={state}
      data-slot="progress"
    >
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center",
            state === "running" && "text-primary",
            state === "done" && "text-success",
            state === "failed" && "text-destructive",
          )}
        >
          {state === "done" ? (
            <CheckIcon className="size-4" />
          ) : state === "failed" ? (
            <CircleAlertIcon className="size-4" />
          ) : (
            <CircleDashedIcon className="size-4" />
          )}
        </span>
        <span
          aria-live="polite"
          className="min-w-0 flex-1 text-foreground text-sm"
          data-slot="progress-words"
          role={state === "failed" ? "alert" : "status"}
        >
          {words}
        </span>
        {time === "" ? null : (
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              clock.overrun ? "text-foreground" : "text-muted-foreground",
            )}
            data-slot="progress-time"
          >
            {time}
          </span>
        )}
        {action === null ? null : <span className="shrink-0">{action}</span>}
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(fraction * 100)}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className={cn(
            "h-full w-full origin-left rounded-full transition-transform duration-200 ease-drawer motion-reduce:transition-none",
            state === "failed" ? "bg-destructive" : state === "done" ? "bg-success" : "bg-primary",
          )}
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      {view.state === "failed" && view.details !== undefined && view.details !== null ? (
        <FailureDetails>{view.details}</FailureDetails>
      ) : null}
    </div>
  );
}

export { Progress };
