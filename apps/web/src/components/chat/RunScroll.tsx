import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { CallGroup } from "./RunCallRow";
import { ChatRow } from "./RunItemLine";
import { rowByKey, rowInView, selectionTouches, topAmongLines } from "./runSlotGeometry";
import { type HolderRows, glideShifted, historyRows, retopped } from "./runGlide";
import { pageReached, type ScrollPages } from "./engineCardPaging.logic";
import { glideStep, glidesTo, keepsFoot, movesAsPerson } from "./runMotion.logic";
import { easeRooms, forgetScrollTop, noteScrollTop, type Rooms, unclamp } from "./runRoom";
import { followScrollTo } from "~/lib/followScroll";
import {
  chatOpensAt,
  cutEdges,
  followAfter,
  NOTHING_OPENED,
  footTop,
  movedByClamp,
  laidOutPosition,
  type RunScrollEvent,
  type RunScrollFollow,
  reachesEarlier,
  stretchesAside,
  windowAside,
  windowEarlier,
  windowOver,
  logWindow,
  roomAside,
  KEPT_ABOVE_PX,
  SET_ASIDE_PAST_PX,
  type AsideStretch,
  type LogWindow,
  type RunScrollPosition,
  standsAtFoot,
} from "./runCard.logic";
import { useRunScrollResettle } from "./useRunScrollResettle";
import {
  ChatLineContext,
  ChatShownContext,
  DrawnEarlierContext,
  PlopsContext,
  RidesContext,
  RunScrollHoldContext,
} from "./runCardContext";
import {
  type ChatEntry,
  type ChatLine,
  EASED_BOXES,
  gatherCalls,
  type RunMotion,
} from "./runChatLine";

const NO_STRETCHES: ReadonlyArray<AsideStretch> = [];

/** How long a scroll stands still before its move counts as ended, where the browser never says so. */
const SCROLL_QUIET_MS = 150;

/**
 * The run's one scroll (the owner, 2026-09-29: "open with scroll and all
 * events"): every line it said and did, in the order it happened, the newest
 * at its foot. It opens at its foot and follows what arrives while it stands
 * there; once the person scrolls up to read, or opens something in it, it
 * stays where they are until they scroll back down. A long run opens on its
 * newest lines and draws the earlier ones as the person scrolls up to them,
 * the lines in view kept where they stand. A fade at an edge says there is
 * more past it. What arrives after it was first drawn arrived while the
 * person watched, and rises in. It mounts with its first line (`RunChat`).
 */
export function RunScroll({
  label,
  lines,
  readingRef,
  keepRef,
  landing = null,
  eases = false,
  opensAtStart = false,
  roomsRef,
  motionRef,
  pages,
}: {
  readonly label: string;
  readonly lines: ReadonlyArray<ChatLine>;
  /** Told whether the person reads the work: scrolled up in it, or something in it opened. */
  readonly readingRef?: { current: boolean };
  /** Given how to keep it at its foot while it follows, read first (`keep`). */
  readonly keepRef?: { current: ((lands?: boolean) => void) | null };
  /** The lines landing from the live slot this draw: they plop into place, never rise in. */
  readonly landing?: ReadonlyMap<string, number> | null;
  /**
   * Whether its room eases as lines join it, and it glides to its foot: any
   * run, except on a resync or with reduced motion.
   */
  readonly eases?: boolean;
  /**
   * Whether it opens at its first line: a settled run's work opened by "Show
   * work" reads from the start; a live one, or one watched to its end, opens
   * at its foot.
   */
  readonly opensAtStart?: boolean;
  /** Given how its boxes ease, for a line landing in it. */
  readonly roomsRef?: { current: Rooms | null };
  /** Its card's motion: the live slot's ease beside it, and the travels they share. */
  readonly motionRef: { readonly current: RunMotion };
  /**
   * An engine run too long to read whole: the lines past the ones held, read a page at a time
   * as the scroll nears them (`pageReached`).
   */
  readonly pages?: ScrollPages;
}) {
  // Drawn once: from here on, what arrives arrives while the person watches.
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);
  // Where the chat starts: its newest lines when it opens. What arrives after
  // only ever joins at the end, so the window grows and never slides.
  // With it, the lines set aside over the first one drawn, far above the view
  // (`stretchesAside`), and the room they took: kept over the first line
  // drawn, so nothing drawn moves and the scroll is as long. Lines joining or
  // leaving before the first one drawn leave the same lines drawn
  // (`windowOver`).
  const [held, setHeld] = useState<LogWindow>(() =>
    logWindow(lines, opensAtStart ? 0 : chatOpensAt(lines.length), NO_STRETCHES),
  );
  const win = windowOver(held, lines);
  const { from, aside } = win;
  const spacer = useMemo(() => roomAside(aside), [aside]);
  // The rows it draws: its lines from the first one drawn, each run of calls in one card.
  const shown = gatherCalls(
    (from > 0 ? lines.slice(from) : lines).map((line) =>
      plopsIn(landing, line.key) ? { ...line, plops: true } : line,
    ),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const easesRef = useRef(eases);
  useLayoutEffect(() => {
    easesRef.current = eases;
  }, [eases]);
  // Its room easing to its lines (`easeRooms`): made before what keeps it at
  // its foot, so that hears each change with the room already holding the
  // height it showed.
  const roomRef = useRef<Rooms | null>(null);
  // Earlier lines are being drawn above the ones in view, this commit.
  const drawingEarlierRef = useRef(false);
  // When the person last gave it an input: what tells their move from its own motion's.
  const personAtRef = useRef(Number.NEGATIVE_INFINITY);
  const heardPerson = useEffectEvent(() => {
    personAtRef.current = performance.now();
  });
  // A pointer or a finger held on it is their input until it lifts: a
  // drag-select scrolling at its edge, a finger resting on the lines.
  const holdsRef = useRef({ pointer: false, touch: false });
  const heardHold = useEffectEvent((kind: "pointer" | "touch") => {
    heardPerson();
    const holds = holdsRef.current;
    if (holds[kind]) return;
    holds[kind] = true;
    // It lifts with its own end, or with anything that ends a press without
    // one (a context menu, the window losing focus, a drag), or after a
    // while: a lost end never holds it for good.
    const ends = [
      ...(kind === "pointer" ? ["pointerup", "pointercancel"] : ["touchend", "touchcancel"]),
      "contextmenu",
      "blur",
      "dragstart",
    ];
    const lifted = () => {
      clearTimeout(cap);
      holds[kind] = false;
      heardPerson();
      for (const type of ends) window.removeEventListener(type, lifted, true);
    };
    const cap = setTimeout(lifted, HOLD_LONGEST_MS);
    for (const type of ends) window.addEventListener(type, lifted, true);
  });
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const pointer = () => heardHold("pointer");
    const touch = () => heardHold("touch");
    element.addEventListener("keydown", heardPerson, true);
    element.addEventListener("wheel", heardPerson, { capture: true, passive: true });
    element.addEventListener("touchmove", heardPerson, { capture: true, passive: true });
    element.addEventListener("pointerdown", pointer, true);
    element.addEventListener("touchstart", touch, { capture: true, passive: true });
    return () => {
      element.removeEventListener("keydown", heardPerson, true);
      element.removeEventListener("wheel", heardPerson, true);
      element.removeEventListener("touchmove", heardPerson, true);
      element.removeEventListener("pointerdown", pointer, true);
      element.removeEventListener("touchstart", touch, true);
    };
  }, []);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    // It, its lines — so lines leaving or shrinking at its foot let it settle
    // there gradually, never clamp it down at once — and each bubble and card
    // of calls in it, as what they hold changes.
    const motion = motionRef.current;
    const rooms = easeRooms({
      root: element,
      selector: `[data-run-scroll] > ol, ${EASED_BOXES}`,
      // Earlier lines drawn over the ones in view take their room at once:
      // where the person reads is kept by the scroll (`keptRowRef`).
      eases: () => easesRef.current && shownRef.current && !drawingEarlierRef.current,
      // Its own box grows by a travel as a line joins it, uncovering the line
      // at its foot while the slot under it rides its edge. What it holds
      // takes its room at once: a line held at an older height would be cut.
      grows: (box) => box === element,
      travels: motion.travels,
      afterStep: () => motion.keep?.(),
    });
    roomRef.current = rooms;
    if (roomsRef !== undefined) roomsRef.current = rooms;
    return () => {
      rooms.stop();
      forgetScrollTop(element);
      roomRef.current = null;
      if (roomsRef !== undefined) roomsRef.current = null;
    };
  }, [roomsRef, motionRef]);
  // Every commit, before the list's row measures it in its own.
  useLayoutEffect(() => roomRef.current?.flush());
  // It follows its foot until the person moves it up or opens something in
  // it, and again once they move it down onto its foot or close what they
  // opened; where its top last stood tells their move from the page's. It
  // opens at its foot.
  const laterRef = useRef(pages?.later ?? false);
  useLayoutEffect(() => {
    laterRef.current = pages?.later ?? false;
  });
  const followRef = useRef<RunScrollFollow>({
    follows: !opensAtStart,
    stood: opensAtStart ? 0 : Number.POSITIVE_INFINITY,
    opened: NOTHING_OPENED,
    resumes: false,
    reach: null,
    foot: null,
  });
  const follow = useMemo(() => {
    // Its furthest top as it last stood: what a clamp since can take it up by.
    const stoodAt = { max: 0 };
    const heard = (event: RunScrollEvent) => {
      const stood = followRef.current.stood;
      followRef.current = followAfter(followRef.current, event);
      // Its foot is not its run's end while later lines are still to read: what pages in joins
      // under what the person reads, and the scroll never follows it there.
      if (laterRef.current && followRef.current.follows)
        followRef.current = { ...followRef.current, follows: false };
      const element = scrollRef.current;
      if (element !== null && (event.kind === "set" || followRef.current.stood !== stood)) {
        stoodAt.max = element.scrollHeight - element.clientHeight;
      }
      const { follows } = followRef.current;
      // Said on it, as its cut edges are, for what looks at the page.
      scrollRef.current?.toggleAttribute("data-follows", follows);
      if (event.kind !== "set" && readingRef !== undefined) readingRef.current = !follows;
    };
    /** Whether a box holding it eases this moment (`easeRooms`): its height is that ease's. */
    const heldAbove = () =>
      typeof scrollRef.current?.parentElement?.closest === "function" &&
      scrollRef.current.parentElement.closest("[data-room-easing]") !== null;
    /**
     * Whether the live slot beside it eases this moment: its box gives that
     * ease its room, and the browser clamps its top as it does (a phone's
     * slot easing beside a 5 px history moved it 2 px up between two reads;
     * read as the person's, the run stopped following).
     */
    const slotEases = () => motionRef.current.slot?.easing() ?? false;
    /** The page puts its top at `top`, and remembers where the browser took it. */
    const putAt = (element: HTMLElement, top: number) => {
      followScrollTo(element, top);
      noteScrollTop(element);
      heard({ kind: "set", top: element.scrollTop });
    };
    /**
     * Where its foot will stand once its room has eased: a room still growing
     * uncovers what joined, and the scroll stays.
     */
    const footOf = (position: RunScrollPosition) =>
      Math.max(0, footTop(position) - Math.max(0, roomRef.current?.pending() ?? 0));
    // The glide to the foot, while one runs: where it stands (the browser
    // rounds what it is given), and the frame it waits for.
    const gliding = { frame: 0, at: 0, last: 0, foot: 0 };
    /**
     * Glides it to its foot on the room's curve, retargeted each frame as the
     * foot moves on; a move of the person's up stops it (`followAfter`).
     */
    const glide = () => {
      const element = scrollRef.current;
      if (element === null || gliding.frame !== 0) return;
      // Drawn outside a page (a test's renderer), or under reduced motion, it
      // stands there at once.
      if (typeof requestAnimationFrame !== "function" || prefersReducedMotion()) {
        putAt(element, footOf(positionOf(element)));
        return;
      }
      gliding.at = element.scrollTop;
      gliding.last = 0;
      gliding.foot = footOf(positionOf(element));
      // A way longer than a screen is not watched go by: it stands at its foot at once.
      if (!glidesTo(gliding.foot - gliding.at, element.clientHeight)) {
        putAt(element, gliding.foot);
        return;
      }
      const tick = (now: number) => {
        gliding.frame = 0;
        const element = scrollRef.current;
        if (element === null || !followRef.current.follows) return;
        // Moved since by something else: it glides on from there.
        if (Math.abs(element.scrollTop - gliding.at) > 2) gliding.at = element.scrollTop;
        const target = footOf(positionOf(element));
        // The foot's own move since — a height easing as it glides — is
        // taken at once; only the glide's way eases (`glideStep`).
        gliding.at = glideStep({
          at: gliding.at,
          lastFoot: gliding.foot,
          foot: target,
          dtMs: gliding.last === 0 ? 1000 / 60 : now - gliding.last,
        });
        gliding.foot = target;
        gliding.last = now;
        putAt(element, gliding.at);
        markEdges(element);
        if (gliding.at !== target) gliding.frame = requestAnimationFrame(tick);
      };
      gliding.frame = requestAnimationFrame(tick);
    };
    // Its box and its lines as they stood at the last read.
    const sized: { box: number | null; lines: number | null } = { box: null, lines: null };
    /**
     * Where it stands, read: while its room eases or it glides, or as its box
     * or its lines change size, a move with no input of the person's is that
     * motion's or that change's — the browser clamping it — and never their
     * move up.
     */
    const read = (position: RunScrollPosition) => {
      const boxResized = sized.box !== null && Math.abs(position.clientHeight - sized.box) > 0.5;
      const linesResized =
        sized.lines !== null && Math.abs(position.scrollHeight - sized.lines) > 0.5;
      sized.box = position.clientHeight;
      sized.lines = position.scrollHeight;
      const element = scrollRef.current;
      // A motion of the card's own — its glide, its boxes easing, the card
      // around it or the slot beside it — or a resize moves it only as far as
      // the clamp explains, its lines or its box resizing a frame's speed past it (run
      // 12: 6 px taller, the top set 14 px up): further up is the person's,
      // whatever took it there with no input on it (find in page, Tab, a
      // drag-select, a screen reader).
      const explained =
        element !== null &&
        movedByClamp({
          stood: followRef.current.stood,
          top: position.scrollTop,
          stoodMax: stoodAt.max,
          max: element.scrollHeight - element.clientHeight,
          linesResized,
          boxResized,
        });
      const person = movesAsPerson({
        moving:
          explained &&
          (gliding.frame !== 0 ||
            (roomRef.current?.easing() ?? false) ||
            heldAbove() ||
            slotEases()),
        resized: (linesResized || boxResized) && explained,
        msSinceInput:
          holdsRef.current.pointer || holdsRef.current.touch
            ? 0
            : performance.now() - personAtRef.current,
        atFoot: standsAtFoot(position),
        follows: followRef.current.follows,
      });
      if (person) heard({ kind: "scrolled", position });
      else heard({ kind: "set", top: position.scrollTop });
      if (scrollRef.current !== null) noteScrollTop(scrollRef.current);
    };
    // How tall its lines stood at the last keep: lines joining glide it on,
    // its own box changing keeps its foot where it is.
    const laid: { height: number | null } = { height: null };
    /**
     * Read where it stands — a move up not heard yet (a scroll event comes a
     * frame late) is the person's — and, while it follows, keep it at its
     * foot: gliding there as lines join it, at once as its box changes — and
     * at once as a line `lands` from the slot, whose travel glides its lines
     * there (a glide of its own beside it went 14 px in its first frame).
     */
    const keep = (lands = false) => {
      const element = scrollRef.current;
      if (element === null) return;
      // A draw laid out before its boxes held their heights (a row leaving
      // the slot) clamped it, and the rooms put that clamp back only once
      // every set has heard the draw: keeping it, a landing puts it back
      // first — that clamp alone, never a move the page made with no input.
      unclamp(element);
      const position = positionOf(element);
      read(position);
      const grew = laid.height !== null && position.scrollHeight > laid.height + 0.5;
      laid.height = position.scrollHeight;
      const foot = footOf(position);
      const keeps = keepsFoot({
        follows: followRef.current.follows,
        grew,
        below: foot > element.scrollTop + 0.5,
        eases: easesRef.current,
        // Its own boxes, the slot squeezing it as it eases taller, or the
        // card around it uncovering it.
        roomEases: (roomRef.current?.easing() ?? false) || slotEases() || heldAbove(),
        gliding: gliding.frame !== 0,
      });
      if (keeps === "glides" && !lands) glide();
      else if (keeps !== "stays") putAt(element, foot);
      markEdges(element);
    };
    return {
      heard,
      read,
      putAt,
      keep,
      glide,
      /** Whether anything of the card moves it this moment: its glide, a room easing in it, beside it or around it. */
      moving: () =>
        gliding.frame !== 0 || (roomRef.current?.easing() ?? false) || slotEases() || heldAbove(),
      hold: (key: string, opens: boolean) => {
        const element = scrollRef.current;
        // A move of theirs not heard yet is theirs, before the press counts.
        if (element !== null) heard({ kind: "scrolled", position: positionOf(element) });
        heard({ kind: opens ? "opened" : "closed", key });
        if (opens) return;
        // Once a closing kept what they pressed in place, that keeping is
        // the page's move, never read as their move up: closing
        // the last thing they opened, it catches up to its foot; else it
        // stands where the keeping put it.
        queueMicrotask(() => {
          const element = scrollRef.current;
          if (element === null) return;
          if (followRef.current.follows) putAt(element, footTop(positionOf(element)));
          else heard({ kind: "set", top: element.scrollTop });
          markEdges(element);
        });
      },
    };
  }, [readingRef, motionRef]);
  // Its node re-inserted puts it back at 0, silently: following, it stands at
  // its foot again; read above the foot, where the person read.
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const resettle = useRunScrollResettle({
    scrollRef,
    startRef,
    endRef,
    followRef,
    positionOf,
    putAt: follow.putAt,
  });
  useLayoutEffect(() => {
    if (keepRef === undefined) return;
    keepRef.current = follow.keep;
    return () => {
      keepRef.current = null;
    };
  }, [follow, keepRef]);
  // In each frame a box of its card eased, it keeps to its foot before the
  // frame is read again (`afterStep`): its foot rides the slot's top.
  useLayoutEffect(() => {
    const motion = motionRef.current;
    const keep = () => follow.keep();
    motion.keep = keep;
    return () => {
      if (motion.keep === keep) motion.keep = null;
    };
  }, [follow, motionRef]);
  // A drawn row in view, and where it stood among the scroll's lines, before
  // earlier lines were drawn over it: what keeps it there after.
  const keptRowRef = useRef<{ readonly key: string; readonly top: number } | null>(null);
  const drawEarlier = (position: RunScrollPosition) => {
    // Off the page (its work hidden) nothing is near its view.
    if (position.clientHeight === 0) return;
    // How far under the first drawn line the view stands: the room of the lines set aside is not it.
    const above = position.scrollTop - spacer;
    if (!reachesEarlier({ scrollTop: above }, from)) return;
    drawingEarlierRef.current = true;
    keptRowRef.current = rowInView(scrollRef.current, listRef.current);
    // The lines set aside come back first, the newest stretch of them: as tall
    // as they stood, so the scroll is as long. Then the ones never drawn.
    setHeld(windowEarlier(win, lines, above));
  };
  // The view may come to stand over lines set aside with no scroll heard — its
  // box shown again after "Hide work": asked as its box changes size, while
  // it does not follow its foot (following, it is put back there).
  const drawEarlierHere = useEffectEvent(() => {
    const element = scrollRef.current;
    if (element === null || followRef.current.follows) return;
    drawEarlier(positionOf(element));
  });
  // Lines far above the view are set aside (`stretchesAside`): asked as the
  // scroll moves and as its lines or its box change size, answered at once
  // while they do not reach that far. Never while anything of the card moves
  // — a row's place is read — nor a row the person holds: the focus in it, a
  // selection that touches the log.
  const setLinesAside = useEffectEvent(() => {
    const element = scrollRef.current;
    const list = listRef.current;
    if (element === null || list === null || drawingEarlierRef.current) return;
    // Drawn outside a page (a test's renderer), it has no rows to read; off
    // the page (its work hidden), no row has a place.
    if (typeof list.getBoundingClientRect !== "function" || list.children === undefined) return;
    if (element.clientHeight === 0) return;
    const above = element.scrollTop - spacer;
    if (!(above >= KEPT_ABOVE_PX + SET_ASIDE_PAST_PX) || follow.moving()) return;
    if (selectionTouches(list)) return;
    const rows = list.children;
    if (rows.length === 0) return;
    // A row's room starts where its margin does: one that keeps more air over
    // it, or draws into the row before it, takes that with it.
    const startOf = (row: Element) =>
      row.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(row).marginTop) || 0);
    const first = startOf(rows[0]!);
    const focused = document.activeElement;
    const over: Array<{ readonly lines: number; readonly nextTop: number }> = [];
    // The last row always stays; read only as far as rows go.
    for (let index = 0; index < rows.length - 1 && index < shown.length - 1; index += 1) {
      if (focused !== null && rows[index]!.contains(focused)) break;
      const entry = shown[index]!;
      const nextTop = startOf(rows[index + 1]!) - first;
      over.push({ lines: "calls" in entry ? entry.calls.length : 1, nextTop });
      if (nextTop > above - KEPT_ABOVE_PX) break;
    }
    const stretches = stretchesAside(over, above);
    if (stretches.length === 0) return;
    // They take no room they did not take: nothing eases for it.
    drawingEarlierRef.current = true;
    setHeld(windowAside(win, lines, stretches));
  });
  // It opens at its foot — or its start — before the first paint.
  const opensAtStartRef = useRef(opensAtStart);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    follow.putAt(element, opensAtStartRef.current ? 0 : footTop(positionOf(element)));
    markEdges(element);
  }, [follow]);
  // Lines joined or left before the first one drawn: the window over them is
  // held from here on, and the scroll moves up by the room of the lines set
  // aside that are gone, so the drawn ones stand where they stood — from
  // where it last stood, as the browser has clamped it to its shorter lines
  // by the time it is read here.
  useLayoutEffect(() => {
    if (win === held) return;
    setHeld(win);
    const element = scrollRef.current;
    const gone = roomAside(held.aside) - roomAside(win.aside);
    if (element === null || !(gone > 0.5)) return;
    const { stood } = followRef.current;
    follow.putAt(element, Math.max(0, (Number.isFinite(stood) ? stood : element.scrollTop) - gone));
  }, [win, held, follow]);
  // Earlier lines drawn above the ones in view keep those where they stood:
  // the scroll moves by what the row read before moved among its lines, and
  // not at all when the lines set aside came back as tall as they stood — a
  // write cuts the person's own scroll short. A chat too short to scroll
  // draws them at once, as nothing reaches them: never off the page (its work
  // hidden), where it has no height to be short of.
  const drawEarlierYet = useEffectEvent(() => {
    drawingEarlierRef.current = true;
    setHeld(windowEarlier(win, lines, 0));
  });
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const kept = keptRowRef.current;
    keptRowRef.current = null;
    if (element === null) return;
    const row = kept === null ? null : rowByKey(listRef.current, kept.key);
    if (kept !== null && row !== null) {
      const moved = topAmongLines(element, row) - kept.top;
      if (Math.abs(moved) > 0.5) follow.putAt(element, element.scrollTop + moved);
    }
    drawingEarlierRef.current = false;
    if (from > 0 && element.clientHeight > 0 && element.scrollHeight <= element.clientHeight) {
      drawEarlierYet();
    }
    markEdges(element);
  }, [from, follow]);
  // A page of earlier lines read in above the first one drawn keeps that one where it stood: the
  // scroll moves by what came in over it, before the frame paints. Never a glide: nothing moved.
  const firstDrawnRef = useRef<{ readonly key: string; readonly top: number } | null>(null);
  const prependedRef = useRef(false);
  useLayoutEffect(() => {
    prependedRef.current = false;
    const element = scrollRef.current;
    const list = listRef.current;
    if (pages === undefined || element === null || list === null) return;
    const was = firstDrawnRef.current;
    const first = from === 0 ? lines[0] : undefined;
    const topOf = (row: HTMLElement) =>
      row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (was !== null && first !== undefined && first.key !== was.key) {
      const row = rowByKey(list, was.key);
      if (row !== null) {
        prependedRef.current = true;
        const moved = topOf(row) - was.top;
        if (Math.abs(moved) > 0.5) follow.putAt(element, element.scrollTop + moved);
      }
    }
    const row = first === undefined ? null : rowByKey(list, first.key);
    firstDrawnRef.current =
      first === undefined || row === null ? null : { key: first.key, top: topOf(row) };
  });
  // Near an end with lines past it still to read: the next page, before the person reaches it.
  const readPage = (position: RunScrollPosition) => {
    if (pages === undefined) return;
    const reached = pageReached(position, from, pages);
    if (reached !== null) pages.read(reached);
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (pages !== undefined && element !== null) readPage(positionOf(element));
  });
  // A line joining above lines already there, or a call moving past the
  // ones still running (F3, run 9), glides what it moved from where it
  // stood, as a landing does; one joining at the foot makes its room there
  // by the history's ease.
  // Where its rows stood: read at each draw, and again as its lines resize
  // (a height easing moves the rows under it between two draws).
  const drawnRef = useRef<{
    readonly rows: ReadonlyMap<string, HolderRows>;
    readonly lines: ReadonlyArray<ChatLine>;
    readonly from: number;
    readonly landing: ReadonlyMap<string, number> | null;
  } | null>(null);
  // Read again as heights ease and as it scrolls: the rows near its view.
  const redraw = useCallback(() => {
    const scroll = scrollRef.current;
    const drawn = drawnRef.current;
    if (scroll === null || drawn === null || !easesRef.current) return;
    drawnRef.current = { ...drawn, rows: retopped(drawn.rows, scroll) };
  }, []);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null || typeof list.querySelectorAll !== "function" || !easesRef.current) {
      drawnRef.current = null;
      return;
    }
    const drawn = drawnRef.current;
    // The same lines drawn again: its rows are the ones last read.
    if (
      drawn !== null &&
      drawn.from === from &&
      drawn.landing === landing &&
      sameLines(drawn.lines, lines)
    ) {
      return;
    }
    const rows = historyRows(list, drawn?.rows);
    drawnRef.current = { rows, lines, from, landing };
    // A landing glides the history itself, and plops what lands.
    if (drawn === null || drawn.landing !== landing || !shownRef.current) return;
    // Earlier lines drawn over the ones in view keep their place by the scroll.
    glideShifted(
      list,
      drawn.rows,
      rows,
      drawn.from === from && !prependedRef.current,
      motionRef.current.travels.current(),
    );
  });
  // A line arriving, a bubble growing as its words stream, a call opening,
  // the live slot under it growing into its room: a scroll that follows its
  // foot stays at it, moved before the frame paints, so no arrival is ever
  // drawn cut first.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const list = listRef.current;
    if (element === null || list === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      forgetPadding(element);
      // Put back at its start by nobody as its box changed, a reader's place
      // is theirs before anything reads where it stands as a move.
      if (!followRef.current.follows) resettle();
      follow.keep();
      redraw();
      drawEarlierHere();
      setLinesAside();
    });
    observer.observe(list);
    observer.observe(element);
    return () => observer.disconnect();
  }, [follow, redraw, resettle]);
  // Where the browser never says a move ended (Safari before `scrollend`),
  // it ended once the scroll stood still a moment.
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (quietRef.current !== null) clearTimeout(quietRef.current);
    },
    [],
  );
  const endsOnQuiet = () => {
    if (typeof window !== "undefined" && "onscrollend" in window) return;
    if (quietRef.current !== null) clearTimeout(quietRef.current);
    quietRef.current = setTimeout(() => {
      quietRef.current = null;
      follow.heard({ kind: "ended" });
    }, SCROLL_QUIET_MS);
  };
  return (
    <RunScrollHoldContext value={follow.hold}>
      <ChatShownContext value={shownRef}>
        <DrawnEarlierContext value={drawingEarlierRef}>
          <div
            ref={scrollRef}
            aria-label={label}
            // The run's one scroll: everything the run said and did, the newest at its foot, as tall
            // as a run's usual stretch before it scrolls; it keeps the 2 px its lines' outlines
            // paint into and its bar's room (run-card.css), and scrolls up and down only. A fade
            // at an edge says there is more past it, over the lines only: the bar's 16 px gutter
            // stays whole. Focused by keyboard it wears the kit's outline.
            className="-m-0.5 max-h-[min(560px,60svh)] overflow-x-hidden overflow-y-auto p-0.5 [overflow-anchor:none] [scrollbar-gutter:stable] focus-visible:rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-more-above:[mask-image:linear-gradient(to_bottom,transparent,currentColor_24px),linear-gradient(currentColor,currentColor)] data-more-below:[mask-image:linear-gradient(to_top,transparent,currentColor_24px),linear-gradient(currentColor,currentColor)] [&[data-more-above][data-more-below]]:[mask-image:linear-gradient(to_bottom,transparent,currentColor_24px,currentColor_calc(100%-24px),transparent),linear-gradient(currentColor,currentColor)] [&:is([data-more-above],[data-more-below])]:[mask-position:left_top,right_top] [&:is([data-more-above],[data-more-below])]:[mask-repeat:no-repeat] [&:is([data-more-above],[data-more-below])]:[mask-size:calc(100%-16px)_100%,16px_100%]"
            data-run-scroll=""
            onScroll={(event) => {
              // One read of where it stands serves the whole event, and every
              // read comes before its fades are written: a write between two
              // reads restyled and laid out the page again, on every tick.
              const position = positionOf(event.currentTarget);
              const followed = followRef.current.follows;
              follow.read(position);
              redraw();
              const element = scrollRef.current;
              if (element !== null) {
                // Brought back to the foot it set out for, it glides on to
                // where the foot moved on since — at once under reduced
                // motion, which moves it: then it is read anew.
                if (!followed && followRef.current.follows) {
                  follow.glide();
                  markEdges(element);
                } else markEdges(element, position);
              }
              drawEarlier(position);
              readPage(position);
              setLinesAside();
              endsOnQuiet();
            }}
            onScrollEnd={() => follow.heard({ kind: "ended" })}
            role="region"
            tabIndex={0}
          >
            <div ref={startRef} aria-hidden="true" data-run-scroll-start="" />
            <ol
              ref={listRef}
              className="flex min-w-0 flex-col gap-4"
              // The room of the lines set aside over the first one drawn.
              style={spacer > 0 ? { paddingTop: spacer } : undefined}
            >
              {shown.map((entry) =>
                "calls" in entry ? (
                  <CallsCard key={entry.key} entry={entry} />
                ) : (
                  <LogLine key={entry.key} line={entry} />
                ),
              )}
            </ol>
            <div ref={endRef} aria-hidden="true" data-run-scroll-end="" />
          </div>
        </DrawnEarlierContext>
      </ChatShownContext>
    </RunScrollHoldContext>
  );
}

/**
 * A line of the log on its own row. Drawn again only when its line is another
 * (`chatLines` keeps the line of an item that draws the same): the log's
 * other rows stand as they are while one word streams into the working row.
 */
const LogLine = memo(function LogLine({ line }: { readonly line: ChatLine }) {
  return (
    <PlopsContext value={line.plops === true}>
      <ChatRow
        across={line.across === true}
        lineKey={line.key}
        mark={line.mark}
        markLine={line.markLine}
        pairs={line.pairs === true}
        said={line.said === true}
        theirs={line.theirs === true}
      >
        {line.bubble}
      </ChatRow>
    </PlopsContext>
  );
});

/** The longest a pointer or finger held on a run's history counts as input with no end heard. */
const HOLD_LONGEST_MS = 4000;

/** Whether two draws of a run's history hold the same lines, each a call or not alike. */
function sameLines(left: ReadonlyArray<ChatLine>, right: ReadonlyArray<ChatLine>): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line.key === right[index]!.key && line.call === right[index]!.call)
  );
}

/**
 * A card of calls in the history. One that a call starting it lands with
 * plops as that call does, and never rises in on top of the plop. Drawn again
 * only when a call of it is another line, or one joined it (`LogLine`).
 */
const CallsCard = memo(
  function CallsCard({ entry }: { readonly entry: Extract<ChatEntry, { calls: unknown }> }) {
    const plops = entry.calls.some((line) => line.plops === true);
    return (
      <PlopsContext value={plops}>
        <ChatRow across={false} lineKey={entry.key} theirs={false}>
          <CallGroup>
            {entry.calls.map((line) => (
              <ChatLineContext key={line.key} value={line.key}>
                <PlopsContext value={line.plops === true}>
                  <RidesContext value={plops && line.plops !== true}>{line.bubble}</RidesContext>
                </PlopsContext>
              </ChatLineContext>
            ))}
          </CallGroup>
        </ChatRow>
      </PlopsContext>
    );
  },
  (was, now) =>
    was.entry.key === now.entry.key &&
    was.entry.calls.length === now.entry.calls.length &&
    was.entry.calls.every((line, index) => line === now.entry.calls[index]),
);

/** Whether a line lands by a plop: it stood in the slot (a rider rises in on its own). */
function plopsIn(landing: ReadonlyMap<string, number> | null, key: string): boolean {
  const from = landing?.get(key);
  return from !== undefined && Number.isFinite(from);
}

/**
 * Marks the edges the scroll has more past — a fade there says so — straight
 * on the element: a scroll never redraws the chat.
 */
function markEdges(element: HTMLElement, position: RunScrollPosition = positionOf(element)): void {
  const cut = cutEdges(position);
  element.toggleAttribute("data-more-above", cut.above);
  element.toggleAttribute("data-more-below", cut.below);
}

/**
 * Each run scroll's padding, top and bottom together: read once, and again
 * after it resizes (`forgetPadding`). Read through its computed style on
 * every scroll event, it restyled the page first each time.
 */
const paddings = new WeakMap<HTMLElement, number>();

/** The scroll resized: its padding is read anew. */
function forgetPadding(scroll: HTMLElement): void {
  paddings.delete(scroll);
}

function paddingOf(scroll: HTMLElement): number {
  let pad = paddings.get(scroll);
  if (pad === undefined) {
    const style = getComputedStyle(scroll);
    pad =
      (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    paddings.set(scroll, pad);
  }
  return pad;
}

/**
 * Where the run's scroll stands, its foot where its lines end as laid out: a
 * row travelling into its place paints past it (`laidOutPosition`).
 */
function positionOf(scroll: HTMLElement): RunScrollPosition {
  // Its lines' list: after the mark at its start.
  const list = scroll.firstElementChild?.nextElementSibling as HTMLElement | null | undefined;
  // Drawn outside a page (a test's renderer), it is as it says.
  if (list === null || list === undefined || typeof getComputedStyle !== "function") return scroll;
  const pad = paddingOf(scroll);
  return laidOutPosition({
    scrollTop: scroll.scrollTop,
    scrollHeight: scroll.scrollHeight,
    clientHeight: scroll.clientHeight,
    laidHeight: list.offsetHeight + pad,
  });
}
