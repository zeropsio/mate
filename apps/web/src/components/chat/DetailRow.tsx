/**
 * A row of a list under a status bar — a helper, a background task, a
 * service a stand-up builds: its state's dot, its name, its state in a word
 * (a helper at work: what it does now), and its time. A helper's row opens
 * its own card.
 */
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  long = "title",
  onOpen,
}: {
  readonly tone: ServiceStatusToneId;
  readonly title: string;
  readonly word: string;
  readonly time: ReactNode;
  /**
   * Which of the two runs long and gives way, whole on hover: a helper's
   * title, or — a failed service — the reason its word says.
   */
  readonly long?: "title" | "word";
  /** It opens onto its own work elsewhere (a helper's card): the row is its button. */
  readonly onOpen?: (() => void) | undefined;
}) {
  const cells = (
    <>
      <span className="flex justify-center">
        <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn("text-foreground", long === "title" ? "min-w-0 truncate" : "shrink-0")}>
          {title}
        </span>
        {long === "word" ? (
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 truncate text-muted-foreground" />}>
              {word}
            </TooltipTrigger>
            <TooltipPopup className="max-w-md" side="bottom">
              {word}
            </TooltipPopup>
          </Tooltip>
        ) : (
          <span className="shrink-0 text-muted-foreground">{word}</span>
        )}
      </span>
      <span className="text-muted-foreground tabular-nums">{time}</span>
    </>
  );
  return onOpen === undefined ? (
    <li className="run-bar">{cells}</li>
  ) : (
    <li>
      <button
        aria-label={`${title}: ${word}. Open its work`}
        className="run-bar cursor-pointer transition-colors hover:bg-foreground/4"
        onClick={onOpen}
        type="button"
      >
        {cells}
      </button>
    </li>
  );
}
