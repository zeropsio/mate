import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { type LegendListRef } from "@legendapp/list/react";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { type useTimelineMotion } from "./useTimelineMotion";
import { scrollOwn } from "./timelineEndFollow";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { headStoodJustNow, type WordsStood } from "./wordsLanding";
import { landingHolds } from "./answerLanding.logic";
import { type TimelineRowSharedState } from "./timelineContext";
import { foldTimelineWork } from "./timelineFold";

/** How far a held head goes up for the view to stand at the conversation's end, `room` aside. */
function headUnderEnd(
  landing: { readonly element: HTMLElement; readonly at: number },
  scroller: HTMLElement,
  room: number,
): number {
  const end = scroller.scrollHeight - room - scroller.clientHeight;
  return landing.at - (landing.element.getBoundingClientRect().top - (end - scroller.scrollTop));
}

/** How long the words of an answer travel from where they were read to where they land. */
const WORDS_LAND_MS = 220;
/** How long a card's head is held at least: its fold starts once the list has laid it out. */
const HEAD_HOLD_MS = 300;
/** How long the view takes to the end with an answer that landed under a held head. */
const HEAD_GLIDE_MS = 300;
/** How many frames a held head's card stands at one height before the view sets off. */
const CARD_STILL_FRAMES = 2;

/** How long a long answer takes to unroll upward from where its card stood. */
const ANSWER_UNROLL_MS = 320;
/** Less than this to unroll, it stands at its height at once. */
const UNROLL_FROM_PX = 24;
/** How long an answer is held where its words were read: its card folds, its row is measured. */
const ANSWER_HOLD_MS = 1200;
/** The room under the end while it is held: more than its card's foot and its own meta line. */
const ANSWER_ROOM_PX = 120;

/** An answer lands where its words were read, and the work folding above it takes the view along. */
export function useAnswerLanding({
  listRef,
  motion,
  setLandingRoom,
  askRoom,
  rows,
}: {
  listRef: RefObject<LegendListRef | null>;
  motion: ReturnType<typeof useTimelineMotion>;
  setLandingRoom: Dispatch<SetStateAction<number>>;
  askRoom: number;
  rows: MessagesTimelineRow[];
}) {
  const {
    landingRef,
    followingEndRef,
    endFollowRef,
    outerFoldsRef,
    askRoomRef,
    foldExecutionsRef,
    arrivingRef,
    followRoomRef,
    followEnd,
  } = motion;
  // What it holds back where it stood, in the frame that moved it. An answer that comes with its
  // run's end and goes on under the view takes the held head on to where it stands with the view
  // at the conversation's true end, the room under it aside, as soon as its card stands at its
  // new height: never a pause, then a glide (z1: 180 ms still, then 133 px).
  const holdAnswer = useCallback(() => {
    const landing = landingRef.current;
    const scroller = listRef.current?.getScrollableNode();
    if (landing === null || !scroller || !landing.element.isConnected) return;
    const stands = landing.element.getBoundingClientRect()[landing.edge];
    let at = landing.at;
    if (landing.glides === true) {
      // How far the end stands under the view. The view sets off once the head's card stands at
      // its new height, its work folded: scrolled as they shed it, the list drew the rows under
      // them a frame late (the usage limit's notice 47 px off the card's foot). Its work folding,
      // the fold takes it there (`carried`).
      const under = headUnderEnd(landing, scroller, askRoomRef.current);
      if (under <= 2 || foldExecutionsRef.current.size > 0) landing.glide = undefined;
      else if (landing.glide === undefined && (landing.card?.still ?? 0) >= CARD_STILL_FRAMES)
        landing.glide = performance.now();
      if (landing.glide !== undefined) {
        // Eased in from rest, as the card's own ease came to rest: one travel, never a kick.
        const travelled = Math.min(1, (performance.now() - landing.glide) / HEAD_GLIDE_MS);
        at -= travelled * travelled * (3 - 2 * travelled) * Math.max(0, under);
      }
    }
    const off = stands - at;
    if (Math.abs(off) > 0.5) scrollOwn(scroller, scroller.scrollTop + off);
  }, [listRef]);
  // A landing holds what it holds where it stood until the card has settled around it, then keeps
  // that as the end. Under a held head, what folds under it is taken up by room under the end —
  // never the list clamping its scroll, which moves everything above — and the rows the closing
  // panel would carry down to the end stay where they are (`cardRowsCarried`). Under reduced motion
  // nothing is held: the view stays at the end and the landing is one swap. Held, the card folding
  // at once under its head took the answer 229 px up, and the hold's end brought it back down.
  const land = useCallback(
    (target: {
      readonly element: HTMLElement;
      readonly edge: "top" | "bottom";
      readonly at: number;
      readonly glides?: boolean;
    }) => {
      const scroller = listRef.current?.getScrollableNode();
      if (!scroller || !followingEndRef.current || prefersReducedMotion()) return;
      const held = landingRef.current;
      if (held !== null) cancelAnimationFrame(held.frame);
      held?.words?.travel.finish();
      endFollowRef.current?.stop();
      const landing: NonNullable<typeof landingRef.current> = {
        ...target,
        since: performance.now(),
        frame: 0,
      };
      landingRef.current = landing;
      // Under a held head, a view's height: whatever folds under it — the card, its panel, the
      // slot — the room takes up. Below the view, it costs nothing; once it goes, the view glides
      // only as far as it stood in it.
      setLandingRoom(
        target.edge === "top" ? Math.max(ANSWER_ROOM_PX, scroller.clientHeight) : ANSWER_ROOM_PX,
      );
      const list = scroller.closest<HTMLElement>(".timeline-legend-list") ?? scroller;
      list.toggleAttribute("data-timeline-holds-head", target.edge === "top");
      holdAnswer();
      const step = (now: number) => {
        if (landingRef.current !== landing) return;
        if (landing.glides === true) {
          const height =
            landing.element.closest("[data-timeline-row-id]")?.getBoundingClientRect().height ?? 0;
          landing.card = {
            height,
            still:
              landing.card !== undefined && Math.abs(landing.card.height - height) < 0.5
                ? landing.card.still + 1
                : 0,
          };
        }
        holdAnswer();
        // A held head lets go once its card has folded; an answer's line once its row is measured.
        const settling =
          outerFoldsRef.current.size > 0 ||
          now - landing.since < (landing.edge === "top" ? HEAD_HOLD_MS : ANSWER_HOLD_MS) ||
          (landing.glide !== undefined && now - landing.glide < HEAD_GLIDE_MS);
        if (settling && followingEndRef.current) {
          landing.frame = requestAnimationFrame(step);
          return;
        }
        landingRef.current = null;
        landing.words?.travel.finish();
        list.removeAttribute("data-timeline-holds-head");
        // The room goes once nothing moves what it held, and the view glides out of it on the
        // follow curve (`useAskRoom`) to the conversation's true end. Kept until something came
        // after, the view rested short of its end over an empty foot (the owner, 0.15.44).
        const view = listRef.current?.getScrollableNode();
        setLandingRoom(0);
        // Settled with the conversation's end under the view — a notice, a wake's card landing
        // under the held head — the view glides down to it: never left below (the usage limit's
        // notice stood 12 px under the view).
        const under =
          landing.edge === "top" && view
            ? view.scrollHeight - askRoomRef.current - view.clientHeight - view.scrollTop
            : 0;
        landing.frame = requestAnimationFrame(() => {
          if (!followingEndRef.current) return;
          if (under > 2) endFollowRef.current?.follow();
          else endFollowRef.current?.keep();
        });
      };
      landing.frame = requestAnimationFrame(step);
    },
    [holdAnswer, listRef],
  );
  // The room a landing asked for is drawn in this commit, or a row it brings arrives (the answer
  // a moment after its card settled): what it holds goes back where it stood before the frame
  // paints — the list may have clamped or followed its end in it.
  useLayoutEffect(() => {
    if (landingRef.current !== null) holdAnswer();
  }, [askRoom, rows, holdAnswer]);
  // A run's turn ends under the person's eyes, the words they read whole in its slot: its head
  // stands still, from the commit that ends it.
  const onTurnLands = useCallback(
    (head: HTMLElement, top: number, answerApart: boolean) =>
      land({ element: head, edge: "top", at: top, glides: answerApart }),
    [land],
  );
  // A message the person had queued leaves its row under the running run's card — steered into
  // the run, it lands above the card instead: the card's head stands where it was last painted,
  // and the view glides on to the end once it settles. Never the list clamping at its shrunken
  // end, which moved the conversation by both rows at once (Milo's third stress run: 105 px).
  const queuedRowIdsRef = useRef<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    const queued = new Set(rows.flatMap((row) => (row.kind === "queued-message" ? [row.id] : [])));
    const left = [...queuedRowIdsRef.current].some((id) => !queued.has(id));
    queuedRowIdsRef.current = queued;
    const live = rows.findLast((row) => row.kind === "record" && row.live);
    if (!left || live === undefined || landingRef.current !== null) return;
    const head = listRef.current
      ?.getScrollableNode()
      ?.querySelector<HTMLElement>(
        `[data-timeline-row-id="${CSS.escape(live.id)}"] [data-run-chat] > [data-run-head]`,
      );
    const top = head ? headStoodJustNow(head) : null;
    if (head && top !== null) land({ element: head, edge: "top", at: top });
  }, [land, listRef, rows]);
  // Run 5 (C +0:15.29): the answer whose words the person read at the slot's foot landed from its
  // first line, and the page glided 1033 px after it. Cut by the slot's cap, its last line stands
  // where theirs was: held there while the card folds above it and the list places and measures
  // it, then kept as the end.
  const onAnswerLands = useCallback(
    (words: HTMLElement, stood: WordsStood) => {
      const head = stood.head?.element.isConnected === true ? stood.head : null;
      const holding = landingRef.current;
      if (holding !== null && holding.edge === "top" && holding.element === head?.element) {
        // Its card's head is held: the words land under it, a strip's height under where they were
        // read at most — they travel there from where they stood, never cut (recheck on 0.15.44).
        // Read before the frame paints, once the slot they leave has gone in its own commit.
        const row = words.closest<HTMLElement>("[data-timeline-row-id]");
        if (row === null || typeof row.animate !== "function") return;
        requestAnimationFrame(() => {
          const off =
            words.getBoundingClientRect().bottom -
            (holding.element.getBoundingClientRect().top - holding.at) -
            stood.bottom;
          if (Math.abs(off) <= 2) return;
          // Its work folding under the head, they go there on the fold's curve (`carried`): on
          // their own, they went 7 px up as the fold took them 10 px down to the conversation's
          // end (the owner's 29-step close, 2026-10-19).
          const rides =
            landingRef.current === holding &&
            holding.element.parentElement?.querySelector(":scope > [data-folding]") != null;
          const travel = row.animate([{ translate: `0 ${-off}px` }, { translate: "0 0" }], {
            duration: WORDS_LAND_MS,
            easing: rides ? "linear" : "cubic-bezier(0.23, 1, 0.32, 1)",
          });
          if (!rides) return;
          travel.pause();
          holding.words = { travel, left: 1 };
        });
        return;
      }
      if (landingHolds({ head: head !== null, whole: stood.whole }) === "head" && head !== null) {
        land({ element: head.element, edge: "top", at: head.top });
        return;
      }
      land({ element: words, edge: "bottom", at: stood.bottom });
      // Its last line held where it was read, the answer unrolls upward from the height its card
      // stood at, carrying what stands above along: never its card gone above it in one frame (z2,
      // recheck on 0.15.44: −1,138 px, the head out of the view at once).
      const row = words.closest<HTMLElement>("[data-timeline-row-id]");
      if (landingRef.current === null || row === null || stood.head === null) return;
      if (typeof row.animate !== "function") return;
      // Read within the row and its card as they lay out now, wherever the list has placed them
      // yet: the row's foot under the words, and its card's part still drawn above it — its head,
      // closed — which stands where it stood.
      const box = row.getBoundingClientRect();
      const foot = box.bottom - words.getBoundingClientRect().bottom;
      const kept = stood.head.element.isConnected
        ? box.top - stood.head.element.getBoundingClientRect().top
        : 0;
      const from = stood.bottom + foot - (stood.head.top + Math.max(0, kept));
      if (box.height - from < UNROLL_FROM_PX) return;
      const unrolled = {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      };
      row.animate(
        [
          { ...unrolled, height: `${from}px` },
          { ...unrolled, height: `${box.height}px` },
        ],
        { duration: ANSWER_UNROLL_MS, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
      );
      holdAnswer();
    },
    [holdAnswer, land],
  );
  useEffect(
    () => () => {
      const held = landingRef.current;
      if (held !== null) cancelAnimationFrame(held.frame);
    },
    [],
  );
  const onFoldWork = useCallback<NonNullable<TimelineRowSharedState["onFoldWork"]>>(
    (input) => {
      const release = () => {
        outerFoldsRef.current.delete(release);
        foldExecutionsRef.current.delete(execution);
        followEnd();
      };
      const share = { from: input.from, taken: 0, under: 0 };
      // The held head over the work that folds: its card's own.
      const heldOver = () => {
        const landing = landingRef.current;
        return landing?.edge === "top" && landing.element.parentElement?.contains(input.above)
          ? landing
          : null;
      };
      const execution = foldTimelineWork({
        ...input,
        viewport: () => listRef.current?.getScrollableNode() ?? null,
        rows: () => {
          const viewport = listRef.current?.getScrollableNode();
          const state = listRef.current?.getState();
          if (!viewport || !state) return [];
          // Read mounted holders, including a folding row outside the current buffered range.
          return [...viewport.querySelectorAll<HTMLElement>("[data-timeline-root]")].flatMap(
            (root) => {
              const row = root.parentElement;
              const key = root.dataset.timelineRoot;
              const index = key === undefined ? undefined : state.indexByKey(key);
              return row !== null && index !== undefined
                ? [{ row, position: state.positionAtIndex(index), size: state.sizeAtIndex(index) }]
                : [];
            },
          );
        },
        // What the settle brought is still arriving, or the view eases out of the room under the end.
        waits: () =>
          arrivingRef.current ||
          (landingRef.current === null
            ? followRoomRef.current > 0
            : landingRef.current.edge === "top" && heldOver() === null),
        // Under a held head past its wait, the fold takes room under the end, never the view's place;
        // its own head comes down with it instead (`carried`).
        follows: () => followingEndRef.current && landingRef.current?.edge !== "top",
        // A held head comes down as its work folds under it, from the fold's first frame: the
        // history above comes down, the words under it stay where they were read. Folded under a
        // still head, the work carried those words up and the view's way out of the room brought
        // them back down (a crash-cut run, 298 px); waiting for the hold to end paused the close.
        // Its way to the conversation's end, read once as the fold starts — the list draws a
        // fold's frame's end a frame late — goes along on the fold's curve, never after it: the
        // view went up to the answer, then the fold brought it all back down (the owner's
        // 29-step close, 2026-10-19: 232 px up, 461 px down; streamed, 250 ms still).
        carried: (taken) => {
          const left = share.from - share.taken;
          share.taken += taken;
          const landing = heldOver();
          if (landing === null) return;
          const part = left > 0 ? Math.min(1, taken / left) : 1;
          const way = share.under * part;
          share.under -= way;
          landing.at += taken - way;
          if (landing.words !== undefined) {
            landing.words.left *= 1 - part;
            landing.words.travel.currentTime = (1 - landing.words.left) * WORDS_LAND_MS;
          }
          holdAnswer();
        },
        start: () => {
          outerFoldsRef.current.add(release);
          endFollowRef.current?.stop();
          const landing = heldOver();
          const scroller = listRef.current?.getScrollableNode();
          if (landing !== null && scroller)
            share.under = headUnderEnd(landing, scroller, askRoomRef.current);
        },
        release,
      });
      foldExecutionsRef.current.add(execution);
      return execution.cancel;
    },
    [followEnd, holdAnswer, listRef],
  );
  return { holdAnswer, onTurnLands, onAnswerLands, onFoldWork };
}
