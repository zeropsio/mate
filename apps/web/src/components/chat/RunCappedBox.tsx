import {
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { afterLayout } from "~/lib/afterLayout";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { watchCrossings } from "~/lib/restingIntersections";
import { cn } from "~/lib/utils";
import { FOLD_EASING } from "./runFeedFold";
import { wordsStood } from "./wordsLanding";
import { followScrollTo } from "~/lib/followScroll";
import { InSlotContext, useCarried } from "./runCardContext";

/** Whether a box stands at its end: within two pixels of it. */
function cappedAtEnd(box: HTMLElement): boolean {
  return box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
}

/**
 * One item's box: at most four of the card's lines, what the person opened under a call twelve,
 * the Mate's words as tall as the run's scroll — or by its own lines: in the working row a
 * command's code six, a thought five; in the log a thought two and a command's code one. In the
 * working row what runs past scrolls inside it, a fade at an edge saying there is more past it;
 * in the log nothing scrolls inside it, its foot fades where more runs past (never under a box
 * whose lines its item cuts: its last line is whole, "more" over it), and opened it is whole.
 *
 * A thought in the log counts its two lines as lines (`line-clamp-2`), never as a height: its
 * paragraphs stand apart by a gap no line is, and two lines' height cut the second paragraph's
 * first line through its middle, "more" floating beside the half of it.
 */
function capClassName(box: {
  readonly detail: boolean;
  readonly words: boolean;
  readonly lines: "thought" | "code" | undefined;
  readonly log: boolean;
  readonly whole: boolean;
}): string {
  return cn(
    "min-w-0 [overflow-anchor:none] [scrollbar-width:none]",
    box.log ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto",
    box.whole
      ? "max-h-none"
      : box.lines === "code"
        ? box.log
          ? "max-h-[1lh]"
          : "max-h-[6lh]"
        : box.lines === "thought"
          ? box.log
            ? "line-clamp-2"
            : "max-h-[5lh]"
          : box.detail
            ? "max-h-60"
            : box.words
              ? "max-h-[min(440px,52svh)]"
              : "max-h-20",
    box.log
      ? box.lines === undefined &&
          "data-more-below:[mask-image:linear-gradient(to_top,transparent,currentColor_14px)]"
      : "data-more-above:[mask-image:linear-gradient(to_bottom,transparent,currentColor_14px)] data-more-below:[mask-image:linear-gradient(to_top,transparent,currentColor_14px)] [&[data-more-above][data-more-below]]:[mask-image:linear-gradient(to_bottom,transparent,currentColor_14px,currentColor_calc(100%-14px),transparent)]",
  );
}

/** A fade at each edge of a box that has more past it (`capClassName`). */
function markCappedEdges(box: HTMLElement): void {
  if (typeof box.toggleAttribute !== "function") return;
  // Read whole before either is written: a fade written between two reads
  // made the second restyle the page first.
  const above = box.scrollTop > 1;
  const below = !cappedAtEnd(box) && box.scrollHeight > box.clientHeight + 1;
  box.toggleAttribute("data-more-above", above);
  box.toggleAttribute("data-more-below", below);
}

interface CappedBoxProps {
  readonly follows?: boolean;
  /** What the person opened under a call: twelve lines. */
  readonly detail?: boolean;
  /**
   * The Mate's words to the person: as tall as the run's scroll, so a long
   * answer is read while it is written, never through a four-line slit.
   */
  readonly words?: boolean;
  /**
   * What it holds, where that sets its lines (the board, 2026-11-10): a
   * thought two lines in the log and five in the working row, a command's
   * code six in the working row.
   */
  readonly lines?: "thought" | "code";
  /** In the slot, the message its words are: where they stood is told as the box leaves. */
  readonly stood?: string;
  /** Which of its line's boxes it is, where the line has several. */
  readonly part?: string;
  /**
   * In the log: all of it, its item opened. What a call printed (`detail`)
   * stands whole there — it is drawn only once its call is opened.
   */
  readonly open?: boolean;
  /** In the log: whether what it holds runs past the cap, so its item offers the rest. */
  readonly onCut?: (cut: boolean) => void;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * One item's box, capped at its lines (`lines`, else four of the card's). In the working row what runs past the cap scrolls inside
 * it (`SlotBox`) — what the Mate does now is read with its body; in the log
 * nothing scrolls inside it (`LogBox`) and it is shorter — what happened is
 * skimmed (the board, 2026-11-10).
 */
export function CappedBox(props: CappedBoxProps) {
  return use(InSlotContext) ? <SlotBox {...props} /> : <LogBox {...props} />;
}

/**
 * An item's box in the log: it never scrolls (the owner, 2026-10-05: "it
 * should show the start and then on expand it should show everything, no
 * scroll inside in either case"). A scroll there caught the wheel of a person
 * skimming the card, and a box cut at four lines with its scrollbar hidden
 * said nothing of what ran past. Closed, it shows the head of what it holds —
 * the head names it, the newest words were for while it ran — a fade at its
 * foot where more runs past; opened by its item, all of it. One that stood at
 * its end in the working row lands at its head, its words fading in: rolled
 * back there, a thought showed its end, its middle and its start in 220 ms,
 * and read as three texts (2026-11-10). One the cap cut nothing of is the
 * same words in both, and does not move at all.
 */
function LogBox({
  detail = false,
  words = false,
  lines,
  part,
  open,
  onCut,
  className,
  children,
}: CappedBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const whole = open ?? detail;
  // Whether it stood at its end in the slot: carried from there, taken once.
  const [stoodAtEnd, setStoodAtEnd] = useCarried(
    part ?? (detail ? "detail-end" : "capped-end"),
    () => false,
  );
  // Whether what it holds runs past the cap: measured while it stands closed
  // and kept while it is open — one drawn open was cut, or it would not open.
  const [cut, setCut] = useState(whole);
  const wholeRef = useRef(whole);
  // Its height as last measured closed: where a person's open eases from.
  const closedHeightRef = useRef<number | null>(null);
  const measureRef = useRef(() => {});
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (box === null || content === null) return;
    const measure = () => {
      if (wholeRef.current) return;
      // Read off the box, never its content: a line clamp ends its content where it ends.
      const next = box.scrollHeight > box.clientHeight + 1;
      closedHeightRef.current = box.offsetHeight;
      // Its fade at once, before the frame paints; the draw that says so follows.
      if (typeof box.toggleAttribute === "function") box.toggleAttribute("data-more-below", next);
      setCut(next);
    };
    measureRef.current = measure;
    // Measured once the page is laid out, as its observer first reports it:
    // read as it mounts, each box of a history drawing its lines forced the
    // page's layout in the middle of the draw.
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const resized = new ResizeObserver(measure);
    resized.observe(content);
    return () => resized.disconnect();
  }, []);
  useLayoutEffect(() => {
    // Opened after it mounted: a person's press. One drawn whole as it mounts stands still.
    const opened = whole && !wholeRef.current;
    wholeRef.current = whole;
    // Closed again: what runs past the cap is measured anew, once laid out.
    if (!whole) {
      afterLayout(() => measureRef.current());
      return;
    }
    // It eases open from the height it showed closed, as a call's detail rises in: the
    // words being read stay where they stood, the rest comes into sight below them.
    const box = boxRef.current;
    const start = closedHeightRef.current;
    if (!opened || box === null || start === null || typeof box.animate !== "function") return;
    if (prefersReducedMotion()) return;
    const end = box.offsetHeight;
    if (end - start < 1) return;
    box.animate([{ height: `${start}px` }, { height: `${end}px` }], {
      duration: OPEN_EASE_MS,
      easing: FOLD_EASING,
    });
  }, [whole]);
  const tellCut = useEffectEvent((next: boolean) => onCut?.(next));
  useEffect(() => tellCut(cut), [cut]);
  // Once, as it lands: the carried end is spent.
  const settleAtHead = useEffectEvent(() => {
    if (!stoodAtEnd) return;
    setStoodAtEnd(false);
    const box = boxRef.current;
    const content = contentRef.current;
    if (box === null || content === null || typeof content.animate !== "function") return;
    const past = box.scrollHeight - box.clientHeight;
    if (past < 1 || prefersReducedMotion()) return;
    content.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: HEAD_SETTLE_MS,
      easing: FOLD_EASING,
    });
  });
  useLayoutEffect(() => settleAtHead(), []);
  return (
    <div
      ref={boxRef}
      className={cn(capClassName({ detail, words, lines, log: true, whole }), className)}
      data-more-below={cut && !whole ? "" : undefined}
    >
      <div ref={contentRef} data-capped-held="">
        {children}
      </div>
    </div>
  );
}

/** How long a box that stood at its end takes to show its head as it lands in the log. */
const HEAD_SETTLE_MS = 150;
/** How long a box a person opens takes to ease to its whole height: a call's detail rising in. */
const OPEN_EASE_MS = 220;

/** A burst of words grows their box by more than this: it glides there. */
const WORDS_LEAP_PX = 48;
/** The glide: a gentler start than the fold's, so its first frame is never a leap of its own. */
const WORDS_GROW_MS = 300;
const WORDS_GROW_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";

/**
 * The Mate's words growing their box by a burst (run 5, C +0:09.6: 125 -> 497 px in one frame):
 * the box glides from the height it shows to its new one on a gentle curve, its newest words at
 * its foot all the way — the scroll it holds stays at its end as it opens. Read as the words
 * arrive, before the frame paints.
 */
function easeWordsGrowth(box: HTMLElement, content: HTMLElement, end: HTMLElement): void {
  const cap = Number.parseFloat(getComputedStyle(box).maxHeight);
  const natural = Math.min(
    content.offsetHeight + end.offsetHeight,
    Number.isFinite(cap) ? cap : Number.POSITIVE_INFINITY,
  );
  const before = wordsHeights.get(box);
  wordsHeights.set(box, natural);
  if (before === undefined || typeof box.animate !== "function" || prefersReducedMotion()) return;
  // Mid-glide it goes on from where it shows.
  const shown = box.getAnimations().length > 0 ? box.getBoundingClientRect().height : before;
  if (natural - shown <= WORDS_LEAP_PX) return;
  box.animate([{ height: `${shown}px` }, { height: `${natural}px` }], {
    duration: WORDS_GROW_MS,
    easing: WORDS_GROW_EASING,
  });
}

/** Each words box's height as last laid out: where a burst's glide starts. */
const wordsHeights = new WeakMap<HTMLElement, number>();

/**
 * An item's box in the working row (run 11, the owner: thinking "grows to a
 * max height, then scrolls inside with a fade"; "running commands and
 * everything should have scrollable max-height"): what runs past the cap
 * scrolls inside it, a fade at an edge saying there is more. While its item
 * streams (`follows`) it keeps the newest words in view, until the person
 * scrolls it; whether it stands at its end is carried by its line's key to
 * the log, which rolls it back to its head.
 */
function SlotBox({
  follows = false,
  detail = false,
  words = false,
  lines,
  stood,
  part,
  className,
  children,
}: CappedBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Whether it stands at its end, carried from the slot to the history.
  const [atEnd, setAtEnd] = useCarried(
    part ?? (detail ? "detail-end" : "capped-end"),
    () => follows,
  );
  const stickRef = useRef(atEnd);
  // Where it last scrolled itself: a scroll that lands there is its own,
  // any other the person's — even in the same frame as its own.
  const ownTopRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    const end = endRef.current;
    if (box === null || content === null || end === null) return;
    const settle = () => {
      if (words) easeWordsGrowth(box, content, end);
      if (stickRef.current) {
        const bottom = box.scrollHeight - box.clientHeight;
        if (Math.abs(box.scrollTop - bottom) > 1) {
          followScrollTo(box, bottom);
          ownTopRef.current = box.scrollTop;
        }
      }
      markCappedEdges(box);
    };
    settle();
    const observers: Array<{ disconnect: () => void }> = [];
    if (typeof ResizeObserver !== "undefined") {
      const resized = new ResizeObserver(settle);
      resized.observe(content);
      observers.push(resized);
    }
    // A node the list puts back stands at its head, saying nothing — no
    // scroll, no resize: its end leaving view is the one sign of it.
    const seen = watchCrossings(
      (entries) => {
        if (!entries.every((entry) => entry.isIntersecting)) settle();
      },
      { root: box },
    );
    if (seen !== undefined) {
      seen.observe(end);
      observers.push(seen);
    }
    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, [words]);
  // Standing at its foot, it tells each frame where its last line is: the answer it becomes lands
  // there. Read as painted, never in the commit that takes it away — that commit may already have
  // swapped its words and clamped its scroll to their head. In every frame, and only while the
  // Mate's words stand here: the row the answer becomes asks whether they stood as it is first
  // drawn, before any commit could be read ahead of (`AsPainted`).
  useEffect(() => {
    const box = boxRef.current;
    if (stood === undefined || box === null || typeof requestAnimationFrame !== "function") return;
    let frame = requestAnimationFrame(function tell() {
      if (box.isConnected && cappedAtEnd(box)) {
        const head =
          box.closest("[data-run-chat]")?.querySelector<HTMLElement>(":scope > [data-run-head]") ??
          null;
        wordsStood(stood, {
          bottom: box.getBoundingClientRect().bottom,
          whole: box.scrollHeight <= box.clientHeight + 1,
          head: head === null ? null : { element: head, top: head.getBoundingClientRect().top },
        });
      }
      frame = requestAnimationFrame(tell);
    });
    return () => cancelAnimationFrame(frame);
  }, [stood]);
  // An item that starts streaming follows from then, until the person scrolls it.
  useLayoutEffect(() => {
    if (follows) stickRef.current = true;
  }, [follows]);
  // Words drawn in this commit glide their box open in the same task, before anything reads it.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    const end = endRef.current;
    if (words && box !== null && content !== null && end !== null) {
      easeWordsGrowth(box, content, end);
    }
  });
  return (
    <div
      ref={boxRef}
      className={cn(capClassName({ detail, words, lines, log: false, whole: false }), className)}
      onScroll={() => {
        const box = boxRef.current;
        if (box === null) return;
        // Read before its fades are written: a read after them restyled the page.
        const top = box.scrollTop;
        const end = cappedAtEnd(box);
        markCappedEdges(box);
        const own = ownTopRef.current;
        ownTopRef.current = null;
        if (own !== null && Math.abs(top - own) <= 1) return;
        stickRef.current = end;
        if (end !== atEnd) setAtEnd(end);
      }}
    >
      <div ref={contentRef}>{children}</div>
      <div ref={endRef} aria-hidden className="h-px" />
    </div>
  );
}
