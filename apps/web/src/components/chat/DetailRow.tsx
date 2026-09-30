/**
 * A row of a list under a status bar — a helper, a background task, a
 * service a stand-up builds: its state's dot, its name, its state in a word,
 * and its time.
 */
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatWorkDuration } from "./conversation.logic";
import { ElapsedSince } from "./ConversationRows";

const TONE_DOT: Record<ServiceStatusToneId, string> = {
  ok: "bg-status-ok",
  busy: "bg-status-busy",
  attention: "bg-status-attention",
  failed: "bg-status-failed",
  off: "bg-status-off",
};

/** How long it ran: counting while it runs, its length once it ended. */
export function spanOf(startedAt: string, endedAt: string | null): ReactNode {
  return endedAt === null ? (
    <ElapsedSince since={startedAt} />
  ) : (
    formatWorkDuration(Date.parse(endedAt) - Date.parse(startedAt))
  );
}

export function DetailRow({
  tone,
  title,
  word,
  time,
}: {
  readonly tone: ServiceStatusToneId;
  readonly title: string;
  readonly word: string;
  readonly time: ReactNode;
}) {
  return (
    <li className="run-bar">
      <span className="flex justify-center">
        <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-foreground">{title}</span>
        <span className="shrink-0 text-muted-foreground">{word}</span>
      </span>
      <span className="text-muted-foreground tabular-nums">{time}</span>
    </li>
  );
}
