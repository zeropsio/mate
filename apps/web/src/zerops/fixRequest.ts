/**
 * "Ask <your Mate> to fix it": wherever the app shows something broken —
 * production down, a release that failed, a service a run left that stopped,
 * a change that can't merge — it offers the fix. That opens the Mate's
 * conversation with the problem already written into its composer; the person
 * reads it and sends it.
 *
 * The words are built here, once, from what the surface knows: what failed,
 * when, the error, the last lines of its log, and what to do about it. Only
 * the person's own Mates are offered, since nobody writes to a colleague's;
 * with several, the one they used last in that project comes first.
 */
import { useCallback } from "react";

import { useAskMate } from "./useAskMate";

export interface FixProblem {
  /** What is broken, as a sentence: "Production's release v0.1.57 failed in the build step." */
  readonly what: string;
  /** When it broke, ISO: written as a time of day and how long ago. */
  readonly at?: string | undefined;
  /** The error's own words, quoted as they were. */
  readonly error?: string | undefined;
  /** The last lines of the log, as they were, oldest first. */
  readonly logLines?: ReadonlyArray<string> | undefined;
  /** Where those lines come from: "Build log · v0.1.57". */
  readonly logName?: string | undefined;
  /** What the Mate is asked to do: "Find out why, fix it, and release again." */
  readonly ask: string;
}

/** At most this many log lines go into the message; the rest stay in the log. */
export const FIX_REQUEST_LOG_LINES = 30;

const TIME_OF_DAY = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "at 10:41, 12 minutes ago" — or only the time when the age is unknown or future. */
export function fixRequestWhen(at: string, now: Date): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const clock = `at ${TIME_OF_DAY.format(new Date(then))}`;
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 0) return clock;
  if (minutes < 1) return `${clock}, just now`;
  if (minutes < 60) return `${clock}, ${String(minutes)} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${clock}, ${String(hours)} hour${hours === 1 ? "" : "s"} ago`;
  return `${clock}, ${String(Math.floor(hours / 24))} days ago`;
}

/** The message the Mate's composer is opened with. */
export function fixRequestPrompt(problem: FixProblem, now: Date = new Date()): string {
  const what = problem.what.trim().replace(/[.:]$/u, "");
  const when = problem.at === undefined ? "" : fixRequestWhen(problem.at, now);
  const parts = [when.length > 0 ? `${what} ${when}.` : `${what}.`];
  const error = problem.error?.trim();
  if (error !== undefined && error.length > 0) parts.push(`The error: ${error}`);
  const lines = (problem.logLines ?? [])
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => line.length > 0)
    .slice(-FIX_REQUEST_LOG_LINES);
  if (lines.length > 0) {
    const name = problem.logName?.trim();
    const head = name === undefined || name.length === 0 ? "The log's last lines" : name;
    parts.push(`${head}:\n\`\`\`\n${lines.join("\n")}\n\`\`\``);
  }
  parts.push(problem.ask.trim());
  return parts.join("\n\n");
}

export interface FixMate {
  readonly mateProjectId: string;
  /** The person's own Mate: only these are offered. */
  readonly mine: boolean;
  /** When the person last opened its conversation, ISO. */
  readonly lastVisitedAt?: string | undefined;
}

/**
 * Which Mate the fix is offered to: the person's own, the one they used last
 * first. Empty when they have none in the project — the surface then offers
 * nothing rather than someone else's Mate.
 */
export function fixMateChoice<T extends FixMate>(mates: ReadonlyArray<T>): ReadonlyArray<T> {
  const visited = (mate: T) => {
    const at = mate.lastVisitedAt === undefined ? Number.NaN : Date.parse(mate.lastVisitedAt);
    return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
  };
  return mates.filter((mate) => mate.mine).toSorted((a, b) => visited(b) - visited(a));
}

/**
 * Opens the Mate's conversation with the problem written into its composer,
 * not sent: the person reads what goes and presses Send themselves.
 */
export function useAskMateToFix(): (mateProjectId: string, problem: FixProblem) => void {
  const askMate = useAskMate();
  return useCallback(
    (mateProjectId, problem) => {
      askMate(mateProjectId, fixRequestPrompt(problem), { send: false });
    },
    [askMate],
  );
}
