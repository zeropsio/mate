import type { TimestampFormat } from "@t3tools/contracts/settings";
import { formatDayAwareTimestamp } from "../timestampFormat";
import type { ZeropsAgentActivity } from "./agentActivity";
import { mateFailureWords, usageLimitWords } from "./noticeWords";

/** Source state is always qualified by its own time, never a reconnect or browser clock. */
export function lastKnownMateWords(
  activity: ZeropsAgentActivity | undefined,
  name: string,
  timestampFormat: TimestampFormat = "locale",
): string | undefined {
  const held = activity?.lastKnown;
  if (activity === undefined || held === undefined) return undefined;
  const words =
    held.usageLimited || held.pausedUntil !== undefined
      ? usageLimitWords(
          held.limitProvider ?? "coding agent",
          held.pausedUntil === undefined
            ? undefined
            : formatDayAwareTimestamp(held.pausedUntil, timestampFormat),
          name,
        )
      : held.kind === "failed"
        ? held.errorLine === undefined
          ? `${name}'s work failed.`
          : mateFailureWords(held.errorLine, undefined, name)
        : held.kind === "approval"
          ? `${name} was waiting for approval.`
          : held.kind === "input"
            ? activity.question === undefined
              ? `${name} was waiting for an answer.`
              : `${name} was waiting for an answer: ${activity.question}`
            : held.kind === "planReady"
              ? `${name} had a plan ready for review.`
              : held.kind === "working" || held.kind === "connecting" || held.kind === "monitoring"
                ? `${name} was working.`
                : held.kind === "done"
                  ? `${name} had finished the work.`
                  : `${name} had no active work.`;
  return `Last known ${formatDayAwareTimestamp(held.at, timestampFormat)}: ${words}`;
}
