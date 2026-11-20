import { BotIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { use, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { MateFace } from "../zerops/primitives";
import { Spinner } from "../ui/spinner";
import { TimelineRowCtx } from "./timelineContext";

/** What kind of thing a bubble is, in the muted ink: the mark it wears in the Mate's column. */
export function DidMark({ icon: Icon }: { readonly icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * A step's mark: its Mate's own face at work while it runs, its kind's once it is done (the
 * owner, 2026-10-12: "the active row should always have the mate avatar do the job, it should
 * change to the icon only after it's done") — the kind's arriving by a short fade.
 */
export function StepMark({
  icon,
  running,
}: {
  readonly icon: LucideIcon;
  readonly running: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const [ran, setRan] = useState(running);
  if (running && !ran) setRan(true);
  if (running)
    return ctx.speaker.helper ? (
      <HelperFace />
    ) : (
      <MateFace shape={ctx.speaker.shape} size={20} state="working" tint={ctx.speaker.tint} />
    );
  return (
    <span className={ran ? "run-mark-done" : "contents"}>
      <DidMark icon={icon} />
    </span>
  );
}

/**
 * A call running in the working row, at its line's end: a spinner, the one
 * thing in the card that turns. Its time is the run's, on the card's head (K3).
 */
export function RunsNow() {
  return (
    <span className="flex h-[1lh] shrink-0 items-center ps-2" data-runs-now>
      <Spinner aria-hidden="true" role="presentation" size="xs" tone="muted" />
    </span>
  );
}

/**
 * Whether a failure still stands, or stands quiet: a later step undid it, or
 * its run ended well (K9, `recoveredFailures`).
 */
export type Failure = "broken" | "undone";

/**
 * A failure's mark, in place of its kind's: red while it is still broken,
 * quiet once a later step undid it or its run ended well — red always means
 * still broken (K9).
 */
export function FailedMark({ failure }: { readonly failure: Failure }) {
  return (
    <TriangleAlertIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        failure === "broken" ? "text-status-failed-text" : "text-muted-foreground",
      )}
    />
  );
}

/**
 * The Mate's column, beside a bubble: 28 px, the width of its face at the
 * chat's foot, 8 px off the bubbles — one grid for everything in the card
 * (K1). A bubble's mark stands in it centred on the bubble's first line.
 */
export const MARK_COLUMN = "w-7 shrink-0";
export const MARK_GAP = "gap-2";

/** Which first line a mark stands beside: the words', a call's or a thought's. */
export type MarkLine = "words" | "call" | "thought";

/** Each first line's top and height: the Mate's words 8 px under their bubble's top, a row's at its top. */
const MARK_LINE: Record<MarkLine, string> = {
  words: "pt-2 text-prose leading-5",
  call: "text-prose leading-5",
  thought: "text-line leading-5",
};

/**
 * A bubble's mark, where the Mate's column meets its first line: under the
 * bubble's top, one line of its words tall.
 */
export function Mark({
  line = "words",
  children,
}: {
  readonly line?: MarkLine | undefined;
  readonly children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(MARK_COLUMN, "flex justify-center", MARK_LINE[line])}
      data-run-mark=""
    >
      <span className="flex h-[1lh] items-center">{children}</span>
    </span>
  );
}

/** A helper's mark where the Mate's face stands in its own run: it works under the Mate. */
export function HelperFace() {
  return (
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
      <BotIcon className="size-4 text-muted-foreground" />
    </span>
  );
}
