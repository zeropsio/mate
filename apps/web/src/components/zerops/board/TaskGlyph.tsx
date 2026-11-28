/**
 * A task's own mark, where no face carries its state (`rowLead`): one family of 16 px marks drawn
 * in 1.5 px strokes of the ink around them — queued a hollow circle, waiting for others a dashed
 * one, done a filled check, failed a circle crossed out, stopped a circle struck through, closed a
 * hollow circle crossed out. Each says its state to a screen reader by its row's words, so the mark
 * itself is hidden from it.
 */
import { useId } from "react";

import type { TaskGlyph as Glyph } from "../projectAutomation/taskBoard.logic";
import { cn } from "~/lib/utils";

/** The ink each mark is in: done the ok ink, failed the failure's, the rest quiet. */
const INK: Readonly<Record<Glyph, string>> = {
  queued: "text-muted-foreground",
  held: "text-muted-foreground",
  done: "text-status-ok",
  failed: "text-status-failed",
  stopped: "text-muted-foreground",
  closed: "text-muted-foreground",
};

export function TaskGlyph({ glyph }: { readonly glyph: Glyph }) {
  const cut = useId();
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", INK[glyph])}
      data-task-glyph={glyph}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 16 16"
    >
      {glyph === "done" ? (
        <>
          <mask id={cut}>
            <rect fill="white" height="16" width="16" />
            <path d="m5.25 8.25 1.9 1.9 3.6-3.9" stroke="black" strokeWidth={1.6} />
          </mask>
          <circle cx="8" cy="8" fill="currentColor" mask={`url(#${cut})`} r="7" stroke="none" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.25" strokeDasharray={glyph === "held" ? "2.2 2.2" : undefined} />
      )}
      {glyph === "failed" || glyph === "closed" ? <path d="m6 6 4 4m0-4-4 4" /> : null}
      {glyph === "stopped" ? <path d="m4.6 11.4 6.8-6.8" /> : null}
    </svg>
  );
}
