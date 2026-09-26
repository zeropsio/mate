/**
 * The conversation's own rows — the line for each stretch of the Mate's work,
 * the receipt on a message it has not read yet, the quiet seams between days,
 * events, errors, a usage-limit pause and an incident.
 *
 * One grammar: the Mate's side of the column has a gutter, and a row's mark
 * (a live dot, an event's icon, a failure) hangs in it, so every row's words
 * start on the same edge as the answer's. Routine is grey and small; only a
 * pause is amber and only a failure is red.
 *
 * Presentational: every word comes from the row. Every row here has its final
 * height from its first frame; only words and fixed-size marks change in place.
 */
import type { MateTintId } from "@t3tools/shared/brand";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  ClockIcon,
  GitMergeIcon,
  Minimize2Icon,
  PauseIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { MateFace } from "../zerops/primitives";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatWorkDuration, type IncidentModel } from "./conversation.logic";
import type { ConversationEvent, MessagesTimelineRow } from "./MessagesTimeline.logic";

type WorkLineRow = Extract<MessagesTimelineRow, { kind: "work-line" }>;

/** Who the conversation is with: a Mate's colour, or the neutral one for a thread without a Mate. */
export interface ConversationSpeaker {
  readonly name: string;
  readonly tint: MateTintId;
}

/** A row's mark, hung in the gutter left of the column's text edge. */
function GutterMark({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("absolute -start-5 flex w-5 justify-center", className)}
      data-gutter-mark
    >
      {children}
    </span>
  );
}

function elapsedSince(since: string): string {
  const startedMs = Date.parse(since);
  return formatWorkDuration(Number.isFinite(startedMs) ? Date.now() - startedMs : 0);
}

/** A duration that counts up by itself: its text node updates, the row never re-renders. */
export function ElapsedSince({ since }: { readonly since: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = elapsedSince(since);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);
  return (
    <span ref={ref} className="tabular-nums">
      {elapsedSince(since)}
    </span>
  );
}

function spanText(startedAt: string, endedAt: string | null): string {
  const startMs = Date.parse(startedAt);
  const endMs = endedAt === null ? Date.now() : Date.parse(endedAt);
  return formatWorkDuration(
    Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : 0,
  );
}

/**
 * The line for one stretch of the Mate's work. Settled, it is one quiet
 * phrase — "Worked for 2m 57s", "Thought for 16s" — and a chevron; one click
 * opens everything the stretch did under it, thinking included. Live, a dot
 * in the gutter and what the Mate is on right now; its words are the speech
 * at the stretch's end. The line never changes height.
 */
export function WorkLine({
  row,
  activityLabel,
  compacting,
  timestampFormat,
  onToggle,
}: {
  readonly row: WorkLineRow;
  /** Live: what runs right now, in words. */
  readonly activityLabel: string | null;
  readonly compacting: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly onToggle: () => void;
}) {
  const live = row.live;
  // A stretch that did nothing but think says so, and nothing more.
  const thoughtOnly = !live && row.note === null && row.fallback === null;
  const verb = live
    ? "Working for"
    : row.face === "stopped"
      ? "Stopped after"
      : thoughtOnly
        ? "Thought for"
        : "Worked for";
  // Live, the line names what runs; the Mate's words are its speech's.
  const now = live
    ? compacting
      ? "Condensing the context"
      : (activityLabel ?? (row.note === null ? "Reading your message" : null))
    : null;
  const words = (
    <>
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0 tabular-nums" data-work-line-clock />}>
          {verb}{" "}
          {live ? <ElapsedSince since={row.startedAt} /> : spanText(row.startedAt, row.endedAt)}
        </TooltipTrigger>
        <TooltipPopup>
          {formatChatTimestampTooltip(row.startedAt, timestampFormat)}
          {row.endedAt ? ` – ${formatDayAwareTimestamp(row.endedAt, timestampFormat)}` : ""}
        </TooltipPopup>
      </Tooltip>
      {now !== null ? (
        <>
          <span aria-hidden="true" className="shrink-0 opacity-60">
            ·
          </span>
          <span className="min-w-0 truncate" data-work-line-note>
            {now}
          </span>
        </>
      ) : null}
      {row.hasLog ? (
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 opacity-70 transition-transform duration-150",
            row.open && "rotate-90",
          )}
        />
      ) : null}
    </>
  );
  const className =
    "inline-flex min-h-7 max-w-full min-w-0 items-center gap-1.5 text-left text-line text-muted-foreground";
  return (
    <div className="relative flex min-h-7 min-w-0 items-center" data-work-line={row.face}>
      {live ? (
        <GutterMark>
          <span className="size-1.5 animate-status-pulse rounded-full bg-status-busy motion-reduce:animate-none" />
        </GutterMark>
      ) : null}
      {row.hasLog ? (
        <button
          type="button"
          aria-expanded={row.open}
          aria-label={`${verb} ${spanText(row.startedAt, row.endedAt)}${now ? `: ${now}` : ""}. ${row.open ? "Hide" : "Show"} what it did`}
          className={cn(
            className,
            "cursor-pointer rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
          )}
          data-scroll-anchor-ignore
          onClick={onToggle}
        >
          {words}
        </button>
      ) : (
        <div className={className} role={live ? "status" : undefined}>
          {words}
        </div>
      )}
    </div>
  );
}

/**
 * The Mate's words the person answered: its face in the gutter and the words
 * in full in a bubble beside it — the mirror of the person's bubbles on the
 * right — left where they were said.
 */
export function MateSpeech({
  speaker,
  children,
}: {
  readonly speaker: ConversationSpeaker;
  readonly children: ReactNode;
}) {
  return (
    <div className="relative flex min-w-0" data-mate-speech="said">
      <GutterMark className="top-1">
        <MateFace size="sm" state="idle" tint={speaker.tint} />
      </GutterMark>
      <div className="min-w-0 max-w-full rounded-2xl rounded-ss-sm bg-muted px-3.5 py-2 text-foreground">
        {children}
      </div>
    </div>
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

/** An event's line: its icon in the gutter, its words on the text edge, its time on hover. */
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
      className="relative flex min-h-7 min-w-0 items-center text-line text-muted-foreground"
      data-conversation-event
    >
      <GutterMark>{icon}</GutterMark>
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
        </EventShell>
      );
    }
  }
}

/**
 * What stopped the turn, in the failure tone: the icon in the gutter, the
 * words on the text edge. Only a turn-ending error reaches here — a step that
 * failed on the way stays in the log it belongs to.
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
      className="relative min-h-7 min-w-0 py-1 text-line text-status-failed-text"
      data-conversation-error
      role="alert"
    >
      <GutterMark className="top-1.5">
        <CircleAlertIcon className="size-3.5" />
      </GutterMark>
      <p className="min-w-0">{label}</p>
      {extra ? <p className="min-w-0 text-muted-foreground">{extra}</p> : null}
    </div>
  );
}

function untilText(resetsAt: string, nowMs: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(resetsAt) - nowMs) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "in a minute" : `in ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}

/**
 * A usage limit as one pause — amber while it holds, quiet once the Mate
 * picked up again — however many attempts the limit refused.
 */
/** The server's own reading of a pause, when it keeps one: the reset and the thread's switch. */
export interface ServerUsagePause {
  readonly resetsAt: string;
  readonly autoResume: boolean;
}

export function PauseBlock({
  row,
  speaker,
  nowMs,
  timestampFormat,
  serverPause,
  onAutoResumeChange,
}: {
  readonly row: Extract<MessagesTimelineRow, { kind: "pause" }>;
  readonly speaker: ConversationSpeaker;
  readonly nowMs: number;
  readonly timestampFormat: TimestampFormat;
  /** Present only on the pause that holds the thread now, on a server that keeps one. */
  readonly serverPause: ServerUsagePause | null;
  readonly onAutoResumeChange: ((enabled: boolean) => void) | null;
}) {
  const resumed = row.resumedAt !== null;
  const resetsAt = serverPause?.resetsAt ?? row.resetsAt;
  const reset = resetsAt === null ? null : Date.parse(resetsAt);
  const passed = reset !== null && reset <= nowMs;
  const autoResume = serverPause?.autoResume ?? false;
  const detail = resumed
    ? `${speaker.name} picked up again at ${formatDayAwareTimestamp(row.resumedAt!, timestampFormat)}.`
    : resetsAt === null
      ? "The limit resets later; the work continues from where it stopped."
      : passed
        ? autoResume
          ? `The limit reset at ${formatDayAwareTimestamp(resetsAt, timestampFormat)}; ${speaker.name} is picking up where the work stopped.`
          : `The limit reset at ${formatDayAwareTimestamp(resetsAt, timestampFormat)}. Send a message to pick up where the work stopped.`
        : autoResume
          ? `Resets at ${formatDayAwareTimestamp(resetsAt, timestampFormat)}, ${untilText(resetsAt, nowMs)}; ${speaker.name} picks up where the work stopped by itself.`
          : `Resets at ${formatDayAwareTimestamp(resetsAt, timestampFormat)}, ${untilText(resetsAt, nowMs)}. Send a message then to pick up where the work stopped.`;
  return (
    <div
      className={cn(
        "grid gap-1 rounded-xl border px-3.5 py-2.5",
        resumed
          ? "border-border bg-card"
          : "border-status-attention/40 bg-status-attention-surface",
      )}
      data-conversation-pause={resumed ? "resumed" : "paused"}
      role="status"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <PauseIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            resumed ? "text-muted-foreground" : "text-status-attention",
          )}
        />
        <span
          className={cn("font-medium", resumed ? "text-foreground" : "text-status-attention-text")}
        >
          Paused
        </span>
        <span className="text-muted-foreground">Claude usage limit</span>
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
              before it reset.
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <p className="ps-7 text-line text-muted-foreground">{detail}</p>
      {!resumed && serverPause !== null && onAutoResumeChange !== null ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 ps-7 text-line text-foreground">
          <Switch
            checked={serverPause.autoResume}
            onCheckedChange={(checked) => onAutoResumeChange(checked)}
          />
          Resume by itself at the reset
        </label>
      ) : null}
    </div>
  );
}

const INCIDENT_TONE = {
  attention: { dot: "bg-status-attention", text: "text-status-attention-text" },
  ok: { dot: "bg-status-ok", text: "text-muted-foreground" },
  failed: { dot: "bg-status-failed", text: "text-status-failed-text" },
} as const;

/** A service that stopped answering, as one line: its history at its start, its state at its end. */
export function IncidentLine({ incident }: { readonly incident: IncidentModel }) {
  const tone = INCIDENT_TONE[incident.tone];
  return (
    <div
      className="relative flex min-h-7 min-w-0 items-center gap-1.5 text-line"
      data-conversation-incident={incident.tone}
      role={incident.tone === "ok" ? undefined : "status"}
    >
      <GutterMark>
        <span className={cn("size-1.5 rounded-full", tone.dot)} />
      </GutterMark>
      <span className="shrink-0 font-medium text-foreground">{incident.hostname}</span>
      <span className={cn("min-w-0 truncate", tone.text)}>{incident.phases.join(" · ")}</span>
    </div>
  );
}
