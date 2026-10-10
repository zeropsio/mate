import type { TimestampFormat } from "@t3tools/contracts/settings";
import { formatDayAwareTimestamp } from "../timestampFormat";
import type { ZeropsAgentActivity } from "./agentActivity";
import { mateFailureWords, usageLimitHistoryWords } from "./noticeWords";

/** Source state is always qualified by its own time, never a reconnect or browser clock. */
export function lastKnownMateWords(
  activity: ZeropsAgentActivity | undefined,
  name: string,
  timestampFormat: TimestampFormat = "locale",
): string | undefined {
  const held = activity?.lastKnown;
  if (activity === undefined || held === undefined) return undefined;
  const words =
    activity.limitHistory !== undefined || held.usageLimited || held.pausedUntil !== undefined
      ? usageLimitHistoryWords(
          activity.limitHistory?.provider ?? held.limitProvider ?? "coding agent",
          null,
          activity.limitHistory?.resetsAt ?? held.pausedUntil ?? null,
          name,
          timestampFormat,
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
              : held.waitsOnHelpers === true
                ? `${name} was waiting for its helpers.`
                : held.kind === "working" ||
                    held.kind === "connecting" ||
                    held.kind === "monitoring"
                  ? `${name} was working.`
                  : held.kind === "done"
                    ? `${name} had finished the work.`
                    : `${name} had no active work.`;
  const preview =
    activity.limitHistory !== undefined ||
    held.usageLimited ||
    held.pausedUntil !== undefined ||
    held.kind === "failed" ||
    held.kind === "input"
      ? undefined
      : activity.snippet;
  return `Last known ${formatDayAwareTimestamp(held.at, timestampFormat)}: ${words}${preview === undefined ? "" : ` ${preview}`}`;
}

/** Only a current offline presence establishes when the Mate stopped answering. */
export function mateUnreachableWords(
  name: string,
  since: string | undefined,
  timestampFormat: TimestampFormat = "locale",
  reconnecting = false,
): string {
  return `${name} ${reconnecting ? "is reconnecting" : "isn't answering"}${since === undefined ? "" : ` since ${formatDayAwareTimestamp(since, timestampFormat)}`}.`;
}
