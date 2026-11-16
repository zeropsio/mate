import { RotateCcwIcon } from "lucide-react";

import { LineMark } from "~/components/chat/ConversationRows";
import { InlineButton } from "~/components/ui/button";

/**
 * A crew seam (PRD §4.5, design-system *Seams*): one quiet line across the
 * conversation where something about the crewmate changed — "Started fresh
 * by you — previous conversation ↗". Drawn like a day line; a link in it acts
 * in the action blue.
 */
export function CrewSeamLine({
  text,
  link,
}: {
  readonly text: string;
  readonly link?: { readonly label: string; readonly onOpen: () => void } | undefined;
}) {
  return (
    <div
      className="flex items-center gap-3 text-xs text-muted-foreground"
      data-crew-seam
      {...(link === undefined ? { "aria-label": text, role: "separator" } : {})}
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="flex shrink-0 items-baseline gap-1">
        <span>{text}</span>
        {link === undefined ? null : (
          <>
            <span aria-hidden="true">—</span>
            <InlineButton onClick={link.onOpen}>{link.label} ↗</InlineButton>
          </>
        )}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Where a crewmate's conversation went on in a new session, among the conversation's rows: an
 * event of the conversation, its mark on the text edge and its words after it, as a condensed
 * context is said — not a seam across the column, which is a day's line, so a restart never reads
 * as a date. Its words wrap: they are why it happened.
 */
export function CrewRestartLine({
  text,
  link,
}: {
  readonly text: string;
  readonly link?: { readonly label: string; readonly onOpen: () => void } | undefined;
}) {
  return (
    <div
      className="flex min-h-7 min-w-0 items-center text-line text-muted-foreground"
      data-crew-seam="stint"
      role="note"
    >
      <LineMark>
        <RotateCcwIcon className="size-3.5" />
      </LineMark>
      <span className="min-w-0">
        {text}
        {link === undefined ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <InlineButton onClick={link.onOpen}>{link.label} ↗</InlineButton>
          </>
        )}
      </span>
    </div>
  );
}
