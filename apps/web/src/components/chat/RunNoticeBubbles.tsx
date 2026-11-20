import type { TimestampFormat } from "@t3tools/contracts/settings";
import { releaseEndedWords } from "@t3tools/client-runtime/zerops";
import { use } from "react";
import { cn } from "~/lib/utils";
import { Bubble, META, rises } from "./RunBubble";
import { DisclosureButton, Headline, OutputBlock, useDisclosure } from "./RunDisclosure";
import { type WorkLogEntry } from "../../session-logic";
import { type ConversationEvent } from "./MessagesTimeline.logic";
import { waitedWords } from "./runCard.logic";
import { TimelineRowCtx } from "./timelineContext";

// ---------------------------------------------------------------------------
// What stopped it, and what merely happened
// ---------------------------------------------------------------------------

/**
 * An engine notice keeps its severity, with its real reason available below its words.
 */
export function NoticeBubble({
  entry,
  kind,
}: {
  readonly entry: WorkLogEntry;
  readonly kind: "error" | "warning";
}) {
  const disclosure = useDisclosure();
  const { label, detail } = entry;
  const more = detail !== undefined && detail.trim() !== label.trim() ? detail.trim() : null;
  const line = (
    <Headline opens={more !== null}>
      <span className={kind === "warning" ? "text-warning-foreground" : "text-status-failed-text"}>
        {label}
      </span>
    </Headline>
  );
  return (
    <Bubble kind={kind} tone="tool">
      {more === null ? (
        <div>{line}</div>
      ) : (
        <DisclosureButton
          label={`${label}. ${disclosure.open ? "Hide" : "Show"} the whole ${kind}`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {line}
        </DisclosureButton>
      )}
      {disclosure.open && more !== null ? (
        <div
          className={cn("pt-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <OutputBlock text={more} />
        </div>
      ) : null}
    </Bubble>
  );
}

/** Something that happened in a run, in words: what, then a word more. */
function recordEventWords(
  event: ConversationEvent,
  speaker: string,
  timestampFormat: TimestampFormat = "locale",
): { readonly words: string; readonly detail: string | null } {
  switch (event.type) {
    // Where its card waited for the usage limit and went on (B5): "· 12:31 – 1:05 PM".
    case "waited": {
      const [words, detail] = waitedWords(event.from, event.to, timestampFormat).split(" · ");
      return { words: words!, detail: detail ?? null };
    }
    case "landed":
      return {
        words: `${event.event.repository} #${event.event.number} landed`,
        detail: event.event.title,
      };
    case "release":
      return { words: releaseEndedWords(event.event), detail: null };
    case "compaction":
      return {
        words: "Context condensed",
        detail: `${speaker} kept a summary of the conversation so far`,
      };
    case "resumed":
      return {
        words: "The usage limit reset",
        detail: `${speaker} picked up where the work stopped`,
      };
    case "command":
      return {
        words: `You ran /${event.command.name}`,
        detail: event.command.args || null,
      };
    case "woke": {
      const what =
        event.title === null
          ? `${event.tasks} ${event.helpers ? "helpers" : "background jobs"}`
          : event.tasks === 1
            ? event.title
            : `${event.title} and ${event.tasks - 1} more`;
      return {
        words: `${what} ${(event.lost ?? 0) > 0 ? "didn't report back" : event.failed > 0 ? "failed" : "finished"}`,
        detail: `${speaker} went on`,
      };
    }
  }
}

/** What merely happened: no one's bubble — a caption between hairlines, across the chat. */
export function EventCaption({ event }: { readonly event: ConversationEvent }) {
  const ctx = use(TimelineRowCtx);
  const { words, detail } = recordEventWords(event, ctx.speaker.name, ctx.timestampFormat);
  return (
    <div className={cn("flex min-w-0 items-center gap-3", META)} data-chat-kind="event">
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border/70" />
      <span className="min-w-0 truncate text-muted-foreground">
        <span className="text-foreground/80">{words}</span>
        {detail !== null ? ` · ${detail}` : null}
      </span>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border/70" />
    </div>
  );
}
