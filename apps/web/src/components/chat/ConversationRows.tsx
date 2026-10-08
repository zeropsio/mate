import { MateStatusMarker } from "../zerops/MateStatusMarker";
/**
 * The conversation's own rows — the line for each stretch of the Mate's work,
 * the receipt on a message it has not read yet, the quiet seams between days,
 * events, errors, a usage-limit pause and an incident.
 *
 * One grammar: a row stands on the text edge the answer starts on, its mark
 * (an event's icon, a failure, a pause) first and its words after it, so
 * every row's words share one edge. Routine is grey and small; only a pause
 * is amber and only a failure is red.
 *
 * Presentational: every word comes from the row. Every row here has its final
 * height from its first frame; only words and fixed-size marks change in place.
 */
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  CircleAlertIcon,
  ClockIcon,
  GitMergeIcon,
  Minimize2Icon,
  PauseIcon,
  SendIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { subscribeSecond } from "~/lib/secondTicker";
import { cn } from "~/lib/utils";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { usageLimitWords, usageLimitHistoryWords } from "../../zerops/noticeWords";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatWorkDuration } from "./conversation.logic";
import type { ConversationEvent, MessagesTimelineRow } from "./MessagesTimeline.logic";

/** Who the conversation is with: a Mate's colour, or the neutral one for a thread without a Mate. */
export interface ConversationSpeaker {
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked for the Mate; a crewmate, or nobody, wears its tint's own. */
  readonly shape?: MateShapeId | undefined;
  /** A helper's own run (`HelperCard`): it works under the Mate, and wears no face of its own. */
  readonly helper?: boolean | undefined;
}

/**
 * A row's mark, leading its words on the text edge: 20 px, the column an
 * answer's list bullets hang in, so the words after it start where a list
 * item's and a callout's do. It used to hang in a gutter left of that edge,
 * which put it outside the column the composer draws — and, inside a card,
 * past the card's own border.
 */
export function LineMark({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("flex w-5 shrink-0", className)} data-line-mark>
      {children}
    </span>
  );
}

function elapsedSince(since: string, leftOutMs: number, standingSince: string | null): string {
  const startedMs = Date.parse(since);
  const nowMs = standingSince === null ? Date.now() : Date.parse(standingSince);
  return formatWorkDuration(
    Number.isFinite(startedMs) && Number.isFinite(nowMs)
      ? Math.max(0, nowMs - startedMs - leftOutMs)
      : 0,
  );
}

/**
 * A duration that counts up by itself: its text node updates, the row never
 * re-renders. It leaves out `leftOutMs`, and stands still from
 * `standingSince` — the Mate's clock while it waits on the person.
 */
export function ElapsedSince({
  since,
  leftOutMs = 0,
  standingSince = null,
}: {
  readonly since: string;
  readonly leftOutMs?: number;
  readonly standingSince?: string | null;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = elapsedSince(since, leftOutMs, standingSince);
    };
    update();
    // The one second clock (`subscribeSecond`): every counting duration writes in the same pass.
    return subscribeSecond(update);
  }, [since, leftOutMs, standingSince]);
  return (
    <span ref={ref} className="tabular-nums">
      {elapsedSince(since, leftOutMs, standingSince)}
    </span>
  );
}

/**
 * A message the Mate has not read yet: a small clock beside it, gone once the
 * Mate reads it. A read message carries nothing — reading is the normal case.
 */
export function MessageReceipt({
  receipt,
  speaker,
}: {
  readonly receipt: "sent" | "seen";
  readonly speaker: ConversationSpeaker;
}) {
  if (receipt === "seen") return null;
  const label = `Not read yet — ${speaker.name} reads it at its next step`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={label}
            className="inline-flex size-4 items-center justify-center"
            data-message-receipt={receipt}
            role="img"
          />
        }
      >
        <ClockIcon aria-hidden="true" className="size-3 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipPopup side="left">{label}</TooltipPopup>
    </Tooltip>
  );
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});
const DATE_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Today", "Yesterday", "Wednesday, Sep 24", "Sep 24, 2025". */
export function dayLabel(iso: string, nowMs: number = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date(nowMs);
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return WEEKDAY.format(date);
  return date.getFullYear() === now.getFullYear()
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)
    : DATE_WITH_YEAR.format(date);
}

/** Where a day begins, or where the conversation went quiet for a while. */
export function Seam({
  row,
  timestampFormat,
}: {
  readonly row: Extract<MessagesTimelineRow, { kind: "seam" }>;
  readonly timestampFormat: TimestampFormat;
}) {
  const label =
    row.seam === "day"
      ? dayLabel(row.createdAt)
      : row.seam === "new"
        ? `New since ${formatDayAwareTimestamp(row.createdAt, timestampFormat)}`
        : formatDayAwareTimestamp(row.createdAt, timestampFormat);
  const fresh = row.seam === "new";
  return (
    <div
      aria-label={label}
      className={cn(
        "flex items-center gap-3 text-xs",
        fresh ? "font-medium text-info-foreground" : "text-muted-foreground",
      )}
      data-seam={row.seam}
      role="separator"
    >
      <span className={cn("h-px flex-1", fresh ? "bg-info/40" : "bg-border")} />
      <span className="shrink-0 tabular-nums">{label}</span>
      <span className={cn("h-px flex-1", fresh ? "bg-info/40" : "bg-border")} />
    </div>
  );
}

/** An event's line: its icon on the text edge, its words after it, its time on hover. */
function EventShell({
  icon,
  children,
  at,
  timestampFormat,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly at: string;
  readonly timestampFormat: TimestampFormat;
}) {
  return (
    <div
      className="flex min-h-7 min-w-0 items-center text-line text-muted-foreground"
      data-conversation-event
    >
      <LineMark>{icon}</LineMark>
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate" />}>{children}</TooltipTrigger>
        <TooltipPopup side="top">{formatChatTimestampTooltip(at, timestampFormat)}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** Something that happened in the conversation, not something the Mate wrote. */
export function EventLine({
  event,
  at,
  speaker,
  timestampFormat,
}: {
  readonly event: ConversationEvent;
  readonly at: string;
  readonly speaker: ConversationSpeaker;
  readonly timestampFormat: TimestampFormat;
}) {
  switch (event.type) {
    case "landed":
      return (
        <EventShell
          at={at}
          icon={<GitMergeIcon className="size-3.5 text-status-ok" />}
          timestampFormat={timestampFormat}
        >
          <span className="font-medium text-foreground">
            {event.event.repository} #{event.event.number}
          </span>{" "}
          landed · {event.event.title}
        </EventShell>
      );
    case "compaction":
      return (
        <EventShell
          at={at}
          icon={<Minimize2Icon className="size-3.5" />}
          timestampFormat={timestampFormat}
        >
          Context condensed — {speaker.name} kept a summary of the conversation so far
        </EventShell>
      );
    case "resumed":
      return (
        <EventShell
          at={at}
          icon={<PauseIcon className="size-3.5 text-status-attention" />}
          timestampFormat={timestampFormat}
        >
          The usage limit reset — {speaker.name} picked up where the work stopped
        </EventShell>
      );
    case "command": {
      const { command } = event;
      const condensing = command.name === "compact" && !event.done;
      const words =
        command.name === "compact"
          ? event.done
            ? `Context condensed — ${speaker.name} kept a summary of the conversation so far`
            : "Condensing the context"
          : `You ran /${command.name}${command.args ? ` ${command.args}` : ""}`;
      return (
        <EventShell
          at={at}
          icon={
            command.name === "compact" ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <TerminalIcon className="size-3.5" />
            )
          }
          timestampFormat={timestampFormat}
        >
          {words}
          {condensing ? (
            // It runs for minutes: its clock, the work line's, is its sign of
            // life. Done, the line says what it came to and nothing more.
            <>
              {" · "}
              <ElapsedSince since={at} />
            </>
          ) : null}
        </EventShell>
      );
    }
  }
}

/**
 * The ask a Mate's first sign-in sends for its person — "You asked Wren to stand up development
 * of Beviro" — as a quiet line on the text edge, never a bubble in the person's words: the words
 * are the product's, sent for them. Its time on hover, as every event's.
 */
export function StandUpAskLine({
  words,
  at,
  timestampFormat,
}: {
  readonly words: string;
  readonly at: string;
  readonly timestampFormat: TimestampFormat;
}) {
  return (
    <div className="px-4.25" data-mate-standup-ask>
      <EventShell
        at={at}
        icon={<SendIcon className="size-3.5" />}
        timestampFormat={timestampFormat}
      >
        {words}
      </EventShell>
    </div>
  );
}

/**
 * What stopped the turn, in the failure tone: its icon on the text edge, its
 * words after it. Only a turn-ending error reaches here — a step that failed
 * on the way stays in the log it belongs to.
 */
export function ErrorLine({
  label,
  detail,
}: {
  readonly label: string;
  readonly detail?: string | undefined;
}) {
  const extra = detail !== undefined && detail.trim() !== label.trim() ? detail : null;
  return (
    <div
      className="flex min-h-7 min-w-0 items-start py-1 text-line text-foreground"
      data-conversation-error
      role="alert"
    >
      <LineMark className="h-5 items-center">
        <CircleAlertIcon className="size-3.5 text-status-failed-text" />
      </LineMark>
      <div className="min-w-0">
        <p className="min-w-0">{label}</p>
        {extra ? <p className="min-w-0 text-muted-foreground">{extra}</p> : null}
      </div>
    </div>
  );
}

/** A moment as a sentence says it: "at 10:25 PM", "yesterday at 10:25 PM", "on Sep 24 at 9:14 PM". */
function spokenMoment(iso: string, timestampFormat: TimestampFormat): string {
  const stamp = formatDayAwareTimestamp(iso, timestampFormat);
  if (stamp.startsWith("Yesterday ")) return `yesterday at ${stamp.slice("Yesterday ".length)}`;
  const dated = stamp.match(/^([A-Z][a-z]{2} \d{1,2}(?:, \d{4})?) (.+)$/);
  return dated ? `on ${dated[1]} at ${dated[2]}` : `at ${stamp}`;
}

/** The server's own reading of a pause, when it keeps one: the reset and the thread's switch. */
export interface ServerUsagePause {
  readonly resetsAt: string;
  readonly autoResume: boolean;
}

/**
 * A usage limit as one calm pause, quiet once the Mate
 * picked up again — however many attempts the limit refused. Both are one
 * block: its mark and words in one size, and what it says under its words.
 */
export function PauseBlock({
  row,
  speaker,
  nowMs,
  timestampFormat,
  serverPause,
  onAutoResumeChange,
  onContinue = null,
}: {
  readonly row: Extract<MessagesTimelineRow, { kind: "pause" }>;
  readonly speaker: ConversationSpeaker;
  readonly nowMs: number;
  readonly timestampFormat: TimestampFormat;
  /** Present only on the pause that holds the thread now, on a server that keeps one. */
  readonly serverPause: ServerUsagePause | null;
  readonly onAutoResumeChange: ((enabled: boolean) => void) | null;
  readonly onContinue?: (() => void) | null;
}) {
  const resumed = row.resumedAt !== null;
  const resetsAt = serverPause?.resetsAt ?? row.resetsAt;
  const reset = resetsAt === null ? null : Date.parse(resetsAt);
  const passed = reset !== null && reset <= nowMs;
  const autoResume = serverPause?.autoResume ?? false;
  const history = resumed || passed;
  const detail = resumed
    ? `${speaker.name} picked up again ${spokenMoment(row.resumedAt!, timestampFormat)}.`
    : resetsAt === null
      ? "The coding agent hasn't given a reset time yet."
      : passed
        ? `Reset time passed. Continue to try again.`
        : serverPause === null
          ? `Available again at ${formatDayAwareTimestamp(resetsAt, timestampFormat)}.`
          : autoResume
            ? `${speaker.name} will try again automatically at ${formatDayAwareTimestamp(resetsAt, timestampFormat)}.`
            : `Available again at ${formatDayAwareTimestamp(resetsAt, timestampFormat)}. Automatic continuation is off.`;
  return (
    <div
      className={cn(
        // Resumed, the same block goes quiet — history, not a state to act
        // on: a line like an event's, its mark on the text edge — and keeps
        // its height: newer rows may already sit under it.
        "relative grid gap-1 rounded-xl border py-2.5",
        history
          ? "border-x-0 border-transparent text-muted-foreground"
          : "border-border bg-muted/35 px-3.5",
      )}
      data-conversation-pause={resumed ? "resumed" : passed ? "expired" : "paused"}
      role="status"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-line" data-pause-head>
        {/* Its words keep their gap, so its mark gives the gap back: 14 + 6 px. */}
        <LineMark className="w-3.5">
          <PauseIcon
            className={cn("size-3.5", history ? "text-muted-foreground" : "text-status-attention")}
          />
        </LineMark>
        <span className="font-medium">
          {history
            ? usageLimitHistoryWords(
                row.provider ?? "coding agent",
                row.createdAt,
                resetsAt,
                speaker.name,
                timestampFormat,
              )
            : row.provider === undefined
              ? usageLimitWords("coding agent", undefined, speaker.name)
              : usageLimitWords(row.provider, undefined, speaker.name)}
        </span>
        {history ? null : (
          <MateStatusMarker
            mateName={speaker.name}
            status={{
              kind: "limit",
              severity: "attention",
              until: resetsAt ?? undefined,
              provider: row.provider,
            }}
            timestampFormat={timestampFormat}
          />
        )}
        {row.held > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="ms-auto shrink-0 text-muted-foreground text-xs tabular-nums" />
              }
            >
              {row.held === 1 ? "1 more attempt" : `${row.held} more attempts`}
            </TooltipTrigger>
            <TooltipPopup>
              The limit refused {row.held === 1 ? "one more attempt" : `${row.held} more attempts`}{" "}
              during this pause.
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {/* Under its words: past the mark's w-4 and the head's gap-1.5. */}
      <p className="ps-5 text-line text-muted-foreground" data-pause-detail>
        {detail}
      </p>
      {!resumed && onContinue !== null ? (
        <div className="ps-5">
          <Button size="sm" variant="ghost" onClick={onContinue}>
            Continue
          </Button>
        </div>
      ) : null}
      {!history && serverPause !== null && onAutoResumeChange !== null ? (
        <label
          className="flex w-fit cursor-pointer items-center gap-2 ps-5 text-line text-foreground"
          data-pause-switch
        >
          <Switch
            checked={serverPause.autoResume}
            onCheckedChange={(checked) => onAutoResumeChange(checked)}
          />
          Continue automatically
        </label>
      ) : null}
    </div>
  );
}
