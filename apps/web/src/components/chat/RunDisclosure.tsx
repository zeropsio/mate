import { use, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { InlineButton } from "../ui/button";
import { Collapsible, CollapsibleTrigger } from "../ui/collapsible";
import { META, ROW } from "./RunBubble";
import { RunShimmer } from "./RunShimmer";
import { keepInPlace, scrollerOf } from "./keepInPlace";
import { CappedBox } from "./RunCappedBox";
import { InSlotContext, ListedContext, useCarried, useHoldReading } from "./runCardContext";

/** A well in the log — a command's code opened, what it printed: the page's own ground, under the tray. */
export const WELL = "rounded-card bg-background/70";

// ---------------------------------------------------------------------------
// What a bubble holds, opened in place
// ---------------------------------------------------------------------------

/** A bubble's detail: open or not, and its switch — the person's reading held while it opens. */
export function useDisclosure(initial = false, part = "open", follows = false, shut = false) {
  const hold = useHoldReading(part);
  const [open, setOpen] = useCarried(part, () => initial, follows, shut);
  // Opened by the person here: only that open moves (a carried, a first or a
  // landing one is simply there).
  const [made, setMade] = useState(false);
  return {
    open,
    made,
    set: (next: boolean) => {
      // Set as it stands, nothing opened or closed.
      if (next === open) return;
      hold(next);
      setMade(true);
      setOpen(next);
    },
    toggle: () => {
      hold(!open);
      setMade(true);
      setOpen(!open);
    },
  };
}

/**
 * The part of a call that opens what it holds: its first line, pressable, and
 * a chevron at the end of it that is always there — at rest too, so what
 * opens is plain before the pointer finds it. Nothing under the pointer paints
 * a band across the line: the call is its whole row, not its first line (the
 * owner, 2026-09-28: "the way result is shown with the expand / collapse
 * suck").
 */
export function DisclosureButton({
  open,
  onToggle,
  label,
  className,
  children,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  if (use(InSlotContext)) {
    return <div className={cn("block w-full min-w-0", className)}>{children}</div>;
  }
  return (
    // A disclosure row is the kit's CollapsibleTrigger; what it opens is drawn by its caller.
    <Collapsible className="contents" open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger
        aria-label={label}
        className={cn(
          "group/disclose block w-full min-w-0 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset",
          className,
        )}
        data-chat-disclose
      >
        {children}
      </CollapsibleTrigger>
    </Collapsible>
  );
}

/**
 * The chevron a call that opens wears after its time: at rest, turned over while open. In the
 * live slot nothing opens, so nothing wears it (Erza, 2026-10-19: a thought's chevron there
 * opened nothing).
 */
export function OpensMark() {
  if (use(InSlotContext)) return null;
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground/55 transition-[color,rotate] duration-150 group-hover/disclose:text-foreground group-aria-expanded/disclose:rotate-180"
    />
  );
}

/**
 * Closes what `pressed` opened, keeping `pressed` where it stands on screen —
 * or, where it is gone once closed, the foot of the bubble it stood in (K12).
 */
function collapseInPlace(pressed: HTMLElement, close: () => void) {
  keepInPlace({
    anchor: pressed,
    fallback: pressed.closest<HTMLElement>("[data-chat-bubble], [data-chat-row]"),
    scroller: scrollerOf(pressed),
    change: () => flushSync(close),
  });
}

/**
 * A line's words in its item's box. In the working row, the box as it
 * streams. In the log, the head of them; past the cap the line is a press
 * onto the whole of them — "more" at the end of its last line — and
 * "Show less" under them closes it again, standing where it was pressed.
 */
export function OpensWhole({
  follows = false,
  words = false,
  lines,
  stood,
  what,
  children,
}: {
  readonly follows?: boolean;
  /** Which lines cap it (`CappedBox`'s `lines`). */
  readonly lines?: "thought";
  /** The Mate's words to the person: the taller box (`CappedBox`'s `words`). */
  readonly words?: boolean;
  /** The message they are (`CappedBox`'s `stood`). */
  readonly stood?: string;
  /** What it holds, for the press's name: "thought", "message", "question". */
  readonly what: string;
  readonly children: ReactNode;
}) {
  const inSlot = use(InSlotContext);
  const disclosure = useDisclosure(false, "open");
  const [cut, setCut] = useState(false);
  if (inSlot)
    return (
      <CappedBox
        follows={follows}
        words={words}
        {...(lines === undefined ? {} : { lines })}
        {...(stood === undefined ? {} : { stood })}
      >
        {children}
      </CappedBox>
    );
  return (
    <>
      <div className="relative min-w-0">
        <CappedBox
          onCut={setCut}
          open={disclosure.open}
          words={words}
          {...(lines === undefined ? {} : { lines })}
        >
          {children}
        </CappedBox>
        {cut && !disclosure.open ? (
          <button
            aria-expanded={false}
            aria-label={`Show all of the ${what}`}
            className="run-item-open absolute inset-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            data-chat-disclose
            onClick={() => disclosure.set(true)}
            type="button"
          >
            <span aria-hidden="true" className={cn(META, "run-item-more")}>
              more
            </span>
          </button>
        ) : null}
      </div>
      {disclosure.open ? (
        <div className={cn(META, "mt-1 not-italic")}>
          <InlineButton
            aria-expanded
            tone="muted"
            // It stands at the foot of what it opened: closing folds what
            // stands above it, and it stays under the pointer (K12).
            onClick={(event) => collapseInPlace(event.currentTarget, () => disclosure.set(false))}
          >
            Show less
          </InlineButton>
        </div>
      ) : null}
    </>
  );
}

/**
 * What a call's detail says, in its own inset on the code's left edge — a
 * command's output, a report, an error: a well under what was run, never
 * text that drifts left of it. In the working row past twelve lines it
 * scrolls inside its box; in the log it stands whole, as it was opened.
 */
export function OutputBlock({
  label = null,
  mono = true,
  part,
  text,
}: {
  readonly label?: string | null;
  readonly mono?: boolean;
  /** Which of its line's outputs it is, where the line has several. */
  readonly part?: string;
  readonly text: string;
}) {
  return (
    <section aria-label={label ?? undefined} className="grid min-w-0 gap-1">
      {label === null ? null : <h4 className={cn(META, "text-muted-foreground")}>{label}</h4>}
      <CappedBox className={WELL} detail {...(part === undefined ? {} : { part })}>
        <pre
          className={cn(
            "min-w-0 whitespace-pre-wrap break-words px-3 py-2 text-foreground/80 select-text",
            META,
            mono ? "font-mono" : "font-sans",
          )}
        >
          {text}
        </pre>
      </CappedBox>
    </section>
  );
}

/**
 * A bubble's first line: its words, and at the right edge its time and the
 * chevron, centred on the first line of words however far they wrap. What kind
 * of thing it is stands in the Mate's column beside it (`Mark`), so the words
 * of every bubble start on one edge. In a card of calls the chevron keeps its
 * slot on every row, so each call's time stands on the card's one edge.
 */
export function Headline({
  children,
  time = null,
  timeTone = "muted",
  opens = false,
  column = false,
  running = false,
  now = null,
}: {
  readonly children: ReactNode;
  /** In the working row, at its line's end: that it runs, and for how long (`RunsNow`). */
  readonly now?: ReactNode;
  readonly time?: ReactNode;
  readonly timeTone?: "muted" | "failed";
  readonly opens?: boolean;
  /** A row of a card of calls: the time and the chevron keep their column. */
  readonly column?: boolean;
  /**
   * The call is running now: a light sweeps across its words, in their own
   * inks, until it returns — the card's "this, now" without a spinner.
   */
  readonly running?: boolean;
}) {
  const listed = use(ListedContext);
  // In the slot a row has no time of its own: it gets it when it lands, and the run's one clock
  // stands on the card's foot.
  if (use(InSlotContext)) {
    return (
      <span className={cn("flex min-w-0 items-start gap-2 font-medium", ROW)}>
        <RunShimmer className="min-w-0 flex-1 break-words" sweeps={running}>
          {children}
        </RunShimmer>
        {now}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex min-w-0 items-start gap-2",
        listed ? cn(META, "text-foreground/80") : ROW,
      )}
    >
      <RunShimmer className="min-w-0 flex-1 break-words" sweeps={running}>
        {children}
      </RunShimmer>
      {time !== null || opens || column ? (
        <span className="flex h-[1lh] shrink-0 items-center gap-1.5 ps-2">
          <span
            className={cn(
              META,
              "tabular-nums",
              timeTone === "failed" ? "text-status-failed-text" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {opens ? <OpensMark /> : column ? <span className="size-3.5 shrink-0" /> : null}
        </span>
      ) : null}
    </span>
  );
}
