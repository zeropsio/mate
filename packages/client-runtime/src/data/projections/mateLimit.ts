import type { ConversationRow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { usageLimitProvider } from "@t3tools/shared/threadStatus";

export interface UsageLimitNotice {
  /** When the limit resets, when the notice says. */
  readonly resetsAt: string | null;
}

const CLI_LIMIT =
  /you[’']ve hit your [\w\s-]*?limit(?:\s*·\s*resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?)?/i;
const ADAPTER_LIMIT =
  /(?:claude(?: ai)?|codex|grok|opencode|cursor|antigravity|coding agent) usage limit reached/i;
const ADAPTER_WAIT = /resets in (?:(\d+)h)?\s*(?:(\d+)m)?/i;
const EPOCH_SUFFIX = /\|(\d{10}(?:\.\d+)?)\b/;

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
    }).formatToParts(atMs);
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
    const zoned = DateTime.toParts(DateTime.makeUnsafe(writtenMs + offset * 60_000));
    let candidate =
      Date.UTC(zoned.year, zoned.month - 1, zoned.day, hour, minute) - offset * 60_000;
    if (candidate <= writtenMs) candidate += 24 * 60 * 60_000;
    return { resetsAt: DateTime.formatIso(DateTime.makeUnsafe(candidate)) };
  }
  if (ADAPTER_LIMIT.test(text)) {
    const epoch = EPOCH_SUFFIX.exec(text);
    if (epoch)
      return {
        resetsAt: DateTime.formatIso(DateTime.makeUnsafe(Math.round(Number(epoch[1]) * 1000))),
      };
    const wait = ADAPTER_WAIT.exec(text);
    if (wait && writtenMs !== null && (wait[1] !== undefined || wait[2] !== undefined)) {
      const waitMs = (Number(wait[1] ?? 0) * 60 + Number(wait[2] ?? 0)) * 60_000;
      return { resetsAt: DateTime.formatIso(DateTime.makeUnsafe(writtenMs + waitMs)) };
    }
    return { resetsAt: null };
  }
  return null;
}

export interface MateLimitSource {
  /** The engine row supersedes retained V1 scheduling/session fields. */
  readonly engineRow?: ConversationRow;
  readonly latestTurn: {
    readonly turnId: string;
    readonly state: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  } | null;
  readonly session: {
    readonly lastError?: string | null | undefined;
    readonly providerName?: string | null | undefined;
    readonly usageLimitResetAt?: string | null | undefined;
    readonly updatedAt?: string | undefined;
  } | null;
  readonly usagePause?:
    | { readonly resetsAt: string; readonly pausedAt?: string | undefined }
    | null
    | undefined;
  readonly latestMessagePreview?:
    | { readonly role: string; readonly text: string }
    | null
    | undefined;
}
export type MateLimit =
  | { readonly kind: "none" }
  | {
      readonly kind: "limited" | "expired";
      readonly turnId: string | null;
      readonly provider: string;
      readonly resetsAt: string | null;
    };
export const NO_MATE_LIMIT: MateLimit = { kind: "none" };

/** A refusal belongs to its attempt. A later admitted turn cannot inherit its scheduling pause. */
export function projectMateLimit(source: MateLimitSource | null, nowMs: number): MateLimit {
  if (source === null) return NO_MATE_LIMIT;
  const row = source.engineRow;
  if (row !== undefined) {
    if (row.state.kind !== "paused") return NO_MATE_LIMIT;
    const resetsAt =
      row.state.resetsAt === null
        ? null
        : DateTime.formatIso(DateTime.makeUnsafe(row.state.resetsAt));
    return {
      kind: resetsAt !== null && Date.parse(resetsAt) <= nowMs ? "expired" : "limited",
      turnId: row.latestRun?.id ?? source.latestTurn?.turnId ?? null,
      provider:
        usageLimitProvider("Coding agent usage limit reached", row.agent?.driver) ?? "coding agent",
      resetsAt,
    };
  }
  const turn = source.latestTurn;
  const startedAt = turn?.startedAt;
  const pause = source.usagePause;
  const error = source.session?.lastError;
  const provider = usageLimitProvider(error, source.session?.providerName);
  const earlierPause =
    pause?.pausedAt != null &&
    startedAt != null &&
    Date.parse(pause.pausedAt) < Date.parse(startedAt);
  const earlierError =
    source.session?.updatedAt != null &&
    startedAt != null &&
    Date.parse(source.session.updatedAt) < Date.parse(startedAt);
  const currentPause = pause != null && !earlierPause;
  const currentError =
    provider !== null && !earlierError && (!earlierPause || source.session?.updatedAt != null);
  if (!currentPause && !currentError) return NO_MATE_LIMIT;
  const noticeAt = turn?.completedAt ?? turn?.startedAt;
  const errorNotice = error ? readUsageLimitNotice(error, noticeAt ?? "") : null;
  const preview = source.latestMessagePreview;
  const notice =
    provider !== null && preview?.role === "assistant" && noticeAt
      ? readUsageLimitNotice(preview.text, noticeAt)
      : null;
  const resetsAt =
    (currentPause ? pause?.resetsAt : null) ??
    source.session?.usageLimitResetAt ??
    errorNotice?.resetsAt ??
    notice?.resetsAt ??
    null;
  return {
    kind: resetsAt !== null && Date.parse(resetsAt) <= nowMs ? "expired" : "limited",
    turnId: turn?.turnId ?? null,
    provider:
      provider ??
      usageLimitProvider("Coding agent usage limit reached", source.session?.providerName) ??
      "coding agent",
    resetsAt,
  };
}
