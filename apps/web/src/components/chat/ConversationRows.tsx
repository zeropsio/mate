/**
 * The conversation's own rows — the work line after each of the person's
 * messages, the receipts on those messages, the quiet seams between days,
 * events, errors, a usage-limit pause and an incident — in the one status
 * grammar: routine is quiet, a result is marked, a pause is amber, a failure
 * is red, and the Mate's face carries the state.
 *
 * Presentational: every word comes from the row. Every row here has its final
 * height from its first frame; only words and fixed-size marks change in place.
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ClockIcon,
  GitMergeIcon,
  Minimize2Icon,
  PauseIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { MateFace } from "../zerops/primitives";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatWorkDuration, type IncidentModel, type WorkLineFace } from "./conversation.logic";
import type { ConversationEvent, MessagesTimelineRow } from "./MessagesTimeline.logic";

type WorkLineRow = Extract<MessagesTimelineRow, { kind: "work-line" }>;

/** Who the conversation is with: a Mate's colour, or the neutral one for a thread without a Mate. */
export interface ConversationSpeaker {
  readonly name: string;
  readonly tint: MateTintId;
}

const FACE_STATE: Record<WorkLineFace, MateMarkState> = {
  working: "working",
  idle: "idle",
  produced: "done",
  failed: "surprise",
  paused: "sleep",
  stopped: "closed",
};

const BADGE: Partial<
  Record<
    WorkLineFace,
    { readonly icon: typeof CheckIcon; readonly className: string; readonly label: string }
  >
> = {
  produced: { icon: CheckIcon, className: "bg-status-ok", label: "Produced something" },
  failed: { icon: CircleAlertIcon, className: "bg-status-failed", label: "Something failed" },
  paused: { icon: PauseIcon, className: "bg-status-attention", label: "Paused" },
  stopped: { icon: SquareIcon, className: "bg-status-off", label: "Stopped" },
};

/** The Mate's face wearing a stretch's state, with a small badge for what it came to. */
export function ConversationFace({
  face,
  speaker,
  size = "dot",
}: {
  readonly face: WorkLineFace;
  readonly speaker: ConversationSpeaker;
  readonly size?: "dot" | "sm";
}) {
  const badge = BADGE[face];
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0",
        face === "working" && "animate-status-pulse motion-reduce:animate-none",
      )}
      data-conversation-face={face}
    >
      <MateFace size={size} state={FACE_STATE[face]} tint={speaker.tint} />
      {badge ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-1 -bottom-0.5 flex size-2.5 items-center justify-center rounded-full ring-2 ring-background",
            badge.className,
          )}
        >
          <badge.icon className="size-2 stroke-3 text-background" />
        </span>
      ) : null}
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
 * The line after one of the person's messages: the face in the stretch's
 * state, how long the Mate has worked, and the latest note (live) or the last
 * one the person saw (frozen), with the count of notes behind it. One click
 * opens the log under it; the line itself never changes height.
 */
export function WorkLine({
  row,
  speaker,
  activityLabel,
  compacting,
  timestampFormat,
  onToggle,
}: {
  readonly row: WorkLineRow;
  readonly speaker: ConversationSpeaker;
  /** Live: what runs right now, in words. */
  readonly activityLabel: string | null;
  readonly compacting: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly onToggle: () => void;
}) {
  const live = row.live;
  const liveWords = compacting ? "Condensing the context" : activityLabel;
  const text = row.note ?? row.fallback ?? liveWords ?? (live ? "Reading your message" : "");
  const side = live ? (row.note !== null ? liveWords : null) : null;
  const verb = row.face === "paused" && !live ? "Paused after" : live ? "Working" : "Worked";
  const span = (
    <Tooltip>
      <TooltipTrigger
        render={<span className="shrink-0 font-medium text-foreground" data-work-line-clock />}
      >
        {verb}{" "}
        {live ? <ElapsedSince since={row.startedAt} /> : spanText(row.startedAt, row.endedAt)}
      </TooltipTrigger>
      <TooltipPopup>
        {formatChatTimestampTooltip(row.startedAt, timestampFormat)}
        {row.endedAt ? ` – ${formatDayAwareTimestamp(row.endedAt, timestampFormat)}` : ""}
      </TooltipPopup>
    </Tooltip>
  );
  const body = (
    <>
      <ConversationFace face={row.face} speaker={speaker} />
      {span}
      {text.length > 0 ? (
        <>
          <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">
            ·
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              live ? "text-foreground/85" : "text-muted-foreground",
            )}
            data-work-line-note
          >
            {text}
          </span>
        </>
      ) : (
        <span className="flex-1" />
      )}
      {side ? (
        <span className="max-w-2/5 min-w-0 shrink truncate text-muted-foreground text-xs">
          {side}
        </span>
      ) : null}
      {!live && row.noteCount > 0 ? (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {row.noteCount === 1 ? "1 note" : `${row.noteCount} notes`}
        </span>
      ) : null}
      {row.hasLog ? (
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            row.open && "rotate-90",
          )}
        />
      ) : null}
    </>
  );
  const className =
    "flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-line text-muted-foreground";
  return row.hasLog ? (
    <button
      type="button"
      aria-expanded={row.open}
      aria-label={`${verb} ${spanText(row.startedAt, row.endedAt)}${text ? `: ${text}` : ""}. ${row.open ? "Hide" : "Show"} the log`}
      className={cn(
        className,
        "cursor-pointer transition-colors duration-150 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
      )}
      data-scroll-anchor-ignore
      onClick={onToggle}
    >
      {body}
    </button>
  ) : (
    <div className={className} role={live ? "status" : undefined}>
      {body}
    </div>
  );
}

/** Whether the Mate has read a message: a clock while it waits, the Mate's face once read. */
export function MessageReceipt({
  receipt,
  speaker,
}: {
  readonly receipt: "sent" | "seen";
  readonly speaker: ConversationSpeaker;
}) {
  const label = receipt === "seen" ? `Seen by ${speaker.name}` : "Sent";
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
        {receipt === "seen" ? (
          <MateFace size="dot" state="idle" tint={speaker.tint} />
        ) : (
          <ClockIcon aria-hidden="true" className="size-3 text-muted-foreground" />
        )}
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
      : formatDayAwareTimestamp(row.createdAt, timestampFormat);
  return (
    <div
      aria-label={label}
      className="flex items-center gap-3 text-muted-foreground text-xs"
      data-seam={row.seam}
      role="separator"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0 tabular-nums">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

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
      className="flex min-h-7 min-w-0 items-center gap-2 px-1 text-line text-muted-foreground"
      data-conversation-event
    >
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="shrink-0 text-xs tabular-nums">
        {formatDayAwareTimestamp(at, timestampFormat)}
      </span>
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

/** An error the Mate could not work past, in the failure tone. */
export function ErrorLine({
  label,
  detail,
}: {
  readonly label: string;
  readonly detail?: string | undefined;
}) {
  return (
    <div
      className="flex min-h-7 min-w-0 items-start gap-2 rounded-md bg-status-failed-surface px-2 py-1 text-line text-status-failed-text"
      data-conversation-error
      role="alert"
    >
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {label}
        {detail ? <span className="block text-muted-foreground text-xs">{detail}</span> : null}
      </span>
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
export function PauseBlock({
  row,
  speaker,
  nowMs,
  timestampFormat,
}: {
  readonly row: Extract<MessagesTimelineRow, { kind: "pause" }>;
  readonly speaker: ConversationSpeaker;
  readonly nowMs: number;
  readonly timestampFormat: TimestampFormat;
}) {
  const resumed = row.resumedAt !== null;
  const reset = row.resetsAt === null ? null : Date.parse(row.resetsAt);
  const passed = reset !== null && reset <= nowMs;
  const detail = resumed
    ? `${speaker.name} picked up again at ${formatDayAwareTimestamp(row.resumedAt!, timestampFormat)}.`
    : row.resetsAt === null
      ? "The limit resets later; the work continues from where it stopped."
      : passed
        ? `The limit reset at ${formatDayAwareTimestamp(row.resetsAt, timestampFormat)}. Send a message to pick up where it stopped.`
        : `Resets at ${formatDayAwareTimestamp(row.resetsAt, timestampFormat)}, ${untilText(row.resetsAt, nowMs)}. The work continues from where it stopped.`;
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
        <ConversationFace face="paused" speaker={speaker} size="sm" />
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
      className="flex min-h-7 min-w-0 items-center gap-2 px-1 text-line"
      data-conversation-incident={incident.tone}
      role={incident.tone === "ok" ? undefined : "status"}
    >
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
        <span className={cn("size-2 rounded-full", tone.dot)} />
      </span>
      <span className="shrink-0 rounded-md bg-accent px-1.5 text-foreground text-xs leading-5">
        {incident.hostname}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", tone.text)}>
        {incident.phases.join(" · ")}
      </span>
    </div>
  );
}
