import { PROVIDER_DISPLAY_NAMES, type ConversationRow } from "@t3tools/contracts";
import type { OverviewMain } from "@t3tools/shared/mateLink";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

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
function readUsageLimitNotice(text: string, createdAt: string): UsageLimitNotice | null {
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
  /** Absent on legacy HQ frames; null is authoritative recovery. */
  readonly refusal?: OverviewMain["refusal"];
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
  if (source.refusal !== undefined) {
    if (source.refusal === null) return NO_MATE_LIMIT;
    return {
      kind:
        source.refusal.resetsAt !== null && Date.parse(source.refusal.resetsAt) <= nowMs
          ? "expired"
          : "limited",
      ...source.refusal,
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

/** A provider refusal, distinct from allowed or warning admission telemetry. */
function usageLimitProvider(
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

/** A legacy diagnostic's refusal, normalized only here. */
export function projectLimitError(error: string | null | undefined, driver?: string | null) {
  const provider = usageLimitProvider(error, driver);
  return provider === null ? null : { provider };
}

/** The evidence consumed by both hosted history and admission; no presentation types required. */
export interface LimitHistoryEntry {
  readonly kind: string;
  readonly createdAt: string;
  readonly message?: {
    readonly role: string;
    readonly text: string;
    readonly createdAt: string;
  };
  readonly entry?: {
    readonly tone?: string;
    readonly label: string;
    readonly detail?: string;
    readonly turnEnd?: string;
    /** Whose limit refused the turn, as the turn's own end names it. */
    readonly limitProvider?: string;
    /** The window that refused the turn ("7-day"), as the turn's own end names it. */
    readonly limitWindow?: string;
    readonly usageLimit?: { readonly resetsAt: string | null; readonly provider?: string | null };
  };
}

export interface HistoricalLimit extends UsageLimitNotice {
  readonly provider: string | null;
  readonly createdAt: string;
  /** The window that refused ("7-day"), when its record names one. */
  readonly window?: string;
}

/** An entry's refusal remains a historical fact after recovery or expiry. */
export function projectLimitEntry(
  entry: LimitHistoryEntry,
  driver?: string | null,
): HistoricalLimit | null {
  const work = entry.kind === "work" ? entry.entry : undefined;
  if (work?.usageLimit !== undefined) {
    return {
      resetsAt: work.usageLimit.resetsAt,
      provider: work.usageLimit.provider ?? usageLimitProvider(work.detail ?? work.label, driver),
      createdAt: entry.createdAt,
    };
  }
  if (work !== undefined && work.tone !== "error") return null;
  const text =
    work !== undefined
      ? `${work.detail ?? ""} ${work.label}`.trim()
      : entry.kind === "message" && entry.message?.role === "assistant"
        ? entry.message.text
        : null;
  if (text === null) return null;
  const notice = readUsageLimitNotice(text, entry.createdAt);
  if (notice === null && work?.turnEnd !== "usage-limit") return null;
  return {
    resetsAt: notice?.resetsAt ?? null,
    provider: work?.limitProvider ?? usageLimitProvider(text, driver),
    createdAt: entry.createdAt,
    ...(work?.limitWindow === undefined ? {} : { window: work.limitWindow }),
  };
}

/** Error rows suppressed by the historical pause, regardless of the provider driver. */
export function isUsageLimitError(entry: LimitHistoryEntry): boolean {
  return (
    entry.kind === "work" && entry.entry?.tone === "error" && projectLimitEntry(entry) !== null
  );
}

/** Refusal selection, recovery, and refusal-only content have one owner for every history surface. */
export function projectLimitHistory(input: {
  readonly entries: ReadonlyArray<LimitHistoryEntry>;
  readonly answer: LimitHistoryEntry | null;
  readonly live: boolean;
  readonly waiting: boolean;
  readonly driver?: string | null | undefined;
}) {
  const { entries, live, driver } = input;
  const answer = live || input.waiting ? null : input.answer;
  const terminalLimit = input.answer === null ? null : projectLimitEntry(input.answer, driver);
  const answerLimit = answer === null ? null : terminalLimit;
  let structured: HistoricalLimit | null = null;
  let error: HistoricalLimit | null = null;
  let record: HistoricalLimit | null = null;
  let onlyRefusals = true;
  for (const entry of entries) {
    const evidence = entry === input.answer ? terminalLimit : projectLimitEntry(entry, driver);
    if (entry.kind === "work" && evidence !== null) {
      if (entry.entry?.usageLimit !== undefined) structured = evidence;
      if (entry.entry?.tone === "error") error = evidence;
      record = evidence;
    }
    if (
      !(
        entry === answer ||
        entry.kind === "turn-plan" ||
        (entry.kind === "message" &&
          (entry.message?.role !== "assistant" || !entry.message.text.trim())) ||
        evidence !== null
      )
    )
      onlyRefusals = false;
  }
  // A normal answer is recovery; a provider deadline outranks legacy rounded notice text.
  const selected =
    (answer === null || answerLimit !== null ? structured : null) ??
    answerLimit ??
    (live ? null : error);
  // The record is placed where the provider refused, even when its answer supplied the deadline.
  const limit =
    selected === null
      ? null
      : {
          ...selected,
          provider: record === null ? selected.provider : record.provider,
          createdAt: record?.createdAt ?? selected.createdAt,
          ...((record?.window ?? selected.window) === undefined
            ? {}
            : { window: record?.window ?? selected.window }),
        };
  return {
    limit,
    limitOnly: limit !== null && onlyRefusals,
    answerIsRefusal: answerLimit !== null,
    hasRefusal: error !== null || terminalLimit !== null,
  };
}

/** The latest assistant refusal with no subsequent work; retained historical dock evidence. */
export function projectLatestUsagePause(
  entries: ReadonlyArray<LimitHistoryEntry>,
): UsageLimitNotice | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "change-landed" || entry.kind === "turn-plan") continue;
    if (entry.kind !== "message") return null;
    if (entry.message?.role === "user" || entry.message?.role === "reasoning") continue;
    const limit = projectLimitEntry(entry);
    return limit === null ? null : { resetsAt: limit.resetsAt };
  }
  return null;
}

/** Rejected provider telemetry is refusal evidence; allowed overage and warnings never are. */
export function projectActivityLimit(summary: string, detail: unknown) {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return null;
  const fields = detail as Record<string, unknown>;
  const provider = usageLimitProvider(summary);
  if (
    provider === null ||
    fields.status !== "rejected" ||
    fields.overageStatus === "allowed" ||
    fields.overageStatus === "allowed_warning" ||
    fields.isUsingOverage === true ||
    fields.overageInUse === true
  )
    return null;
  const reset =
    typeof fields.resetsAt === "number" ? DateTime.make(fields.resetsAt * 1000) : Option.none();
  return {
    provider,
    resetsAt: Option.getOrNull(Option.map(reset, DateTime.formatIso)),
  };
}
