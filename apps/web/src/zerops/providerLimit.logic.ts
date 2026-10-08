import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";

/** A provider refusal, distinct from allowed or warning admission telemetry. */
export function usageLimitProvider(
  error: string | null | undefined,
  driver?: string | null,
): string | null {
  if (!error) return null;
  const known = Object.entries(PROVIDER_DISPLAY_NAMES).find(([key]) => key === driver)?.[1];
  const matched =
    /^(Claude(?: AI)?|Codex|Grok|OpenCode|Cursor|Antigravity|Coding agent) usage limit reached\b/i.exec(
      error.trim(),
    );
  if (matched)
    return matched[1]!.toLowerCase() === "coding agent"
      ? (known ?? "coding agent")
      : matched[1]!.replace(/ AI$/i, "");
  return /^you[’']ve hit your [\w\s-]*?limit\b/i.test(error.trim())
    ? (known ?? "coding agent")
    : null;
}

export interface UsageLimitNotice {
  /** When the limit resets, when the notice says. */
  readonly resetsAt: string | null;
}

const CLI_LIMIT =
  /you[’']ve hit your [\w\s-]*?limit(?:\s*·\s*resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?)?/i;
const ADAPTER_LIMIT =
  /(?:claude(?: ai)?|codex|grok|opencode|cursor|antigravity|coding agent) usage limit reached/i;
const ADAPTER_WAIT = /resets in (?:(\d+)h)?\s*(?:(\d+)m)?/i;
const EPOCH_SUFFIX = /\|(\d{10})\b/;

/** The zone's offset from UTC at `atMs`, in minutes; null for a zone the runtime does not know. */
function zoneOffsetMinutes(timeZone: string, atMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(new Date(atMs));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
    );
    return Math.round((asUtc - Math.floor(atMs / 60_000) * 60_000) / 60_000);
  } catch {
    return null;
  }
}

/**
 * A usage-limit notice, read from the text Claude writes when a limit stops it
 * ("You've hit your session limit · resets 9:20pm (UTC)") or the Mate server's
 * own row ("Claude usage limit reached. … resets in 32m."). The reset is the
 * first such wall-clock time after the notice was written.
 */
export function readUsageLimitNotice(text: string, createdAt: string): UsageLimitNotice | null {
  const parsed = Date.parse(createdAt);
  const writtenMs = Number.isFinite(parsed) ? parsed : null;
  const cli = CLI_LIMIT.exec(text);
  if (cli && text.trim().length < 240) {
    // A weekly window needs a date. A time of day alone cannot name which day it reopens.
    if (/\b(?:weekly|seven.day|7.day)\b/i.test(cli[0])) return { resetsAt: null };
    if (cli[1] === undefined || writtenMs === null) return { resetsAt: null };
    let hour = Number(cli[1]) % 12;
    if ((cli[3] ?? "").toLowerCase() === "pm") hour += 12;
    if (cli[3] === undefined) hour = Number(cli[1]);
    const minute = Number(cli[2] ?? "0");
    const zone = (cli[4] ?? "UTC").trim();
    const offset = zoneOffsetMinutes(zone === "UTC" ? "UTC" : zone, writtenMs);
    if (offset === null) return { resetsAt: null };
    const zoned = new Date(writtenMs + offset * 60_000);
    let candidate =
      Date.UTC(zoned.getUTCFullYear(), zoned.getUTCMonth(), zoned.getUTCDate(), hour, minute) -
      offset * 60_000;
    if (candidate <= writtenMs) candidate += 24 * 60 * 60_000;
    return { resetsAt: new Date(candidate).toISOString() };
  }
  if (ADAPTER_LIMIT.test(text)) {
    const epoch = EPOCH_SUFFIX.exec(text);
    if (epoch) return { resetsAt: new Date(Number(epoch[1]) * 1000).toISOString() };
    const wait = ADAPTER_WAIT.exec(text);
    if (wait && writtenMs !== null && (wait[1] !== undefined || wait[2] !== undefined)) {
      const waitMs = (Number(wait[1] ?? 0) * 60 + Number(wait[2] ?? 0)) * 60_000;
      return { resetsAt: new Date(writtenMs + waitMs).toISOString() };
    }
    return { resetsAt: null };
  }
  return null;
}

/** A refusal's deadline expires that refusal; it does not assert admission or a resumed turn. */
export function currentProviderLimit(input: {
  readonly pause: { readonly resetsAt: string } | null | undefined;
  readonly lastError: string | null | undefined;
  readonly resetAt?: string | null | undefined;
  readonly lastMessage: string | undefined;
  readonly noticeAt: string | null | undefined;
  readonly nowMs: number;
  readonly providerName?: string | null | undefined;
}) {
  const provider = usageLimitProvider(input.lastError, input.providerName);
  const errorNotice =
    input.lastError && input.noticeAt != null
      ? readUsageLimitNotice(input.lastError, input.noticeAt)
      : null;
  const notice =
    provider !== null && input.noticeAt != null
      ? readUsageLimitNotice(input.lastMessage ?? "", input.noticeAt)
      : null;
  const resetsAt =
    input.pause?.resetsAt ??
    input.resetAt ??
    errorNotice?.resetsAt ??
    notice?.resetsAt ??
    undefined;
  const expired = resetsAt !== undefined && Date.parse(resetsAt) <= input.nowMs;
  const refused = input.pause != null || provider !== null;
  return { provider, expired: refused && expired, current: refused && !expired, resetsAt };
}
