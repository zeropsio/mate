import type { TimestampFormat } from "@t3tools/contracts/settings";
import { formatShortTimestamp } from "../timestampFormat";
import { admissionRefusalWords } from "@t3tools/client-runtime/data";
import { projectLimitError } from "@t3tools/client-runtime/data";

/** A named window as a person says it: "7-day" is "weekly"; a stand-in that names none is null. */
function windowWords(window: string | null | undefined): string | null {
  if (window == null) return null;
  if (/^7-day\b/i.test(window)) return window.replace(/^7-day/i, "weekly");
  return /^\d+-(?:hour|day)\b/i.test(window) ? window : null;
}

/** Whose limit, and which: "the Claude limit", "Claude's weekly limit", "the coding agent's limit". */
function limitName(provider: string, window: string | null | undefined): string {
  const named = windowWords(window);
  if (provider === "coding agent")
    return named === null ? "the coding agent's limit" : `the coding agent's ${named} limit`;
  return named === null ? `the ${provider} limit` : `${provider}'s ${named} limit`;
}

export function usageLimitWords(
  provider: string,
  reset?: string,
  mateName = "The Mate",
  window?: string | null,
): string {
  const name = limitName(provider, window);
  return reset === undefined
    ? `${mateName} hit ${name}.`
    : `${mateName} hit ${name} — can continue at ${reset}.`;
}

/** Expected refusals have one voice across the web menu, conversation and jump box. */
export function mateFailureWords(
  error: string,
  driver?: string | null,
  mateName = "The Mate",
): string {
  const limit = projectLimitError(error);
  if (limit !== null) return usageLimitWords(limit.provider, undefined, mateName);
  return admissionRefusalWords(error, driver, mateName) ?? error;
}

/** A dated refusal is a record, never a claim about admission or work now. */
export function usageLimitHistoryWords(
  provider: string,
  at: string | null,
  resetsAt: string | null,
  mateName: string,
  timestampFormat: TimestampFormat,
  window?: string | null,
): string {
  const date = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
      new Date(iso),
    );
  const reset =
    resetsAt === null
      ? ""
      : `; reset ${formatShortTimestamp(resetsAt, timestampFormat)} ${date(resetsAt)}`;
  return `${mateName} hit ${limitName(provider, window)}${at === null ? "" : ` on ${date(at)}`}${reset}.`;
}
