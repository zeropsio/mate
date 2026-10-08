import type { TimestampFormat } from "@t3tools/contracts/settings";
import { formatShortTimestamp } from "../timestampFormat";
import { admissionRefusalWords } from "@t3tools/client-runtime/data";
import { projectLimitError } from "@t3tools/client-runtime/data";

export function usageLimitWords(provider: string, reset?: string, mateName = "The Mate"): string {
  const name = provider === "coding agent" ? "coding agent's" : provider;
  return reset === undefined
    ? `${mateName} hit the ${name} limit.`
    : `${mateName} hit the ${name} limit — can continue at ${reset}.`;
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
): string {
  const date = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
      new Date(iso),
    );
  const name = provider === "coding agent" ? "coding agent's" : provider;
  const reset =
    resetsAt === null
      ? ""
      : `; reset ${formatShortTimestamp(resetsAt, timestampFormat)} ${date(resetsAt)}`;
  return `${mateName} hit the ${name} limit${at === null ? "" : ` on ${date(at)}`}${reset}.`;
}
