import { CircleAlertIcon } from "lucide-react";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import { cn } from "~/lib/utils";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { type MateBornLine, mateBornLineText } from "./SidebarMateRow.logic";

/**
 * The row's one line while its Mate is being born (`mateBornLine`): "Coming
 * up" on a clock counting from the press — muted, in tabular figures so its
 * ticks move nothing — or that setting it up stopped, in red. It stands where
 * the sign-in line will, and new words rise into it as the person watches;
 * the clock's ticks never do.
 */
export function MateComingLine({ line }: { readonly line: MateBornLine }) {
  const risen = useChangedSinceShown(line.words, true);
  const nowMs = useSecondTick(line.since !== undefined);
  return (
    <span
      className={cn(
        "truncate menu-line2 tabular-nums",
        line.tone === "attention" ? "text-status-attention-text" : "text-muted-foreground",
        risen && "animate-words-in motion-reduce:animate-none",
      )}
      data-zerops-coming-tone={line.tone}
      data-zerops-surface="sidebar-mate-coming-line"
      key={line.words}
    >
      {line.tone === "attention" ? (
        <CircleAlertIcon aria-hidden="true" className="mr-1 inline size-3" />
      ) : null}
      {mateBornLineText(line, nowMs)}
    </span>
  );
}

/** Now, stepping once a second while `ticking`: a step, never a continuous repaint (R6). */
function useSecondTick(ticking: boolean): number {
  return useSecondsNowMs(ticking);
}
