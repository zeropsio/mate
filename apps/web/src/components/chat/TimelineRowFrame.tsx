import { NO_MATE_LIMIT } from "@t3tools/client-runtime/data";
import { memo, use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { wordsJustStood } from "./wordsLanding";
import {
  ProposedPlanTimelineRow,
  OperationTimelineRow,
  VaultRequestTimelineRow,
  OriginRequestTimelineRow,
  MirrorRequestTimelineRow,
  ProposalTimelineRow,
} from "./TimelineAskRows";
import {
  TaskCardTimelineRow,
  ErrorTimelineRow,
  WorkLineTimelineRow,
  AfterWorkTimelineRow,
  RecordTimelineRow,
  BackgroundTimelineRow,
  EventTimelineRow,
  NoticeTimelineRow,
  CrewCardTimelineRow,
  PageTimelineRow,
  SeamTimelineRow,
} from "./TimelineLineRows";
import {
  QueuedMessageTimelineRow,
  UserTimelineRow,
  AssistantTimelineRow,
} from "./TimelineMessageRows";
import { WorkingTimelineRow, OutcomeTimelineRow } from "./TimelineWorkingRows";
import { WorkGroupSection } from "./TimelineWorkEntries";
import type { MessagesTimelineRow as TimelineRow } from "./MessagesTimeline.logic";
import { isRestartRow, type CardSlice, type RowGap } from "./MessagesTimeline.logic";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { cn } from "~/lib/utils";
import { isMateStandUpAsk } from "~/zerops/mateStandUp";
import { easeRooms } from "./runRoom";
import { TimelineRowCtx } from "./timelineContext";
import { PauseBlock, StandUpAskLine } from "./ConversationRows";
import { CrewSeamActivity } from "../zerops/crew/CrewTaskCard";
import { MateTaskMessageRow } from "../zerops/MateTaskCard";
import { MateAnswerWait, MateMessageRow } from "../zerops/MateMessageRow";

/**
 * The room a row keeps above itself (see `rowGap`), so the ink stands where
 * the rhythm says: a part 24 px under the person's bubble or the card's
 * edge, a turn 64 px under them. The answer's prose adds its own: 3 px of
 * leading above its first line (21 + 3), and under its last line 3 px of
 * leading and its 28 px copy line (33 + 31). A phone's screen is a third of a desk's tall: a turn
 * opens under 48 px there, twice a part's room still, and a seam right under a seam (a day nobody
 * spoke on) under a part's, so a week of silence is a few lines and not a screen of nothing.
 */
const GAP_CLASS: Record<RowGap, string> = {
  none: "",
  tight: "pt-1",
  line: "pt-3",
  block: "pt-5",
  part: "pt-6",
  "part-words": "pt-5.25",
  turn: "pt-12 sm:pt-16",
  "turn-after-words": "pt-4.25 sm:pt-8.25",
  "turn-seam": "pt-6 sm:pt-16",
};

/**
 * Where a row with no card sits across the column. The person's messages hug
 * the right edge, a seam — a day's, a crew's — spans it, and the Mate's work that outlived its
 * turn is a card of its own; everything else the Mate says stands on the
 * composer's text edge — its 1 px frame and 16 px padding — so the answer,
 * an event and the text inside every card start on one line.
 */
function rowInset(row: TimelineRow): string {
  if (row.kind === "message" && row.message.role === "user") return "";
  if (
    row.kind === "queued-message" ||
    row.kind === "seam" ||
    (row.kind === "crew-seam" && !isRestartRow(row)) ||
    row.kind === "after-work" ||
    // Another Mate's message and the wait for its answer are cards, edge to edge with the run's.
    row.kind === "mate-message" ||
    row.kind === "mate-wait"
  ) {
    return "";
  }
  // A line with no card keeps the card's geometry in a frame nobody sees, so
  // opening it draws the card around the line without moving it.
  if (row.kind === "work-line") return "run-tray-ghost";
  // The composer's text edge: 13 px inside its frame on a phone, 17 from sm up.
  return "px-3.25 sm:px-4.25";
}

/**
 * A stretch's card, a slice per row (`MessagesTimelineRow.card`): its line is
 * the top, with the room above it outside the card; each row of its body is
 * a band of the card with its room inside; a row of its own is the bottom
 * edge. One frame, one surface, one inner edge — the composer's.
 */
const CARD_SLICE: Record<CardSlice, string> = {
  top: "run-tray run-tray-top",
  middle: "run-tray run-tray-middle",
  bottom: "run-tray run-tray-bottom",
};
// Where two slices meet, each row's clip snapped away from the joint and the
// page showed through as a hairline (2026-09-29): a slice with another under
// it lays its ground across the joint (`[data-card-slice]` in index.css).

/**
 * The messages that have risen into place once: the list draws a row again
 * whenever it recycles it, and a message scrolled back into sight stays put.
 */
const enteredMessages = new Set<string>();

/**
 * Whether a row, joining the conversation in sight, enters by opening its room: a row of the
 * project's flow (a change landing, a release ending), read from HQ apart from the conversation,
 * and the seam it brings with it (a new day, a quiet hour).
 */
export function opensRoom(row: TimelineRow): boolean {
  if (row.kind === "event") return row.event.type === "landed" || row.event.type === "release";
  return row.kind === "seam" && row.flow === true;
}

/**
 * Whether a row is a message that arrived while the person watched, and has
 * not risen in yet: the person's words from their side, the Mate's up from
 * just below. What the conversation opened onto is simply there.
 */
export function messageEnters(row: TimelineRow, arrivedAfter: number | null): boolean {
  if (arrivedAfter === null || row.kind !== "message") return false;
  if (enteredMessages.has(row.id)) return false;
  // Words the person read in the run's slot land from there: they are not new.
  if (wordsJustStood(row.message.id)) return false;
  return Date.parse(row.createdAt) > arrivedAfter;
}

export const TimelineRowContent = memo(function TimelineRowContent({ row }: { row: TimelineRow }) {
  const gap = GAP_CLASS[row.gap ?? "none"];
  const card = row.card;
  const content = <TimelineRowBody row={row} />;
  const { arrivedAfter, standUpAsk, rooms } = use(TimelineRowCtx);
  const [entering] = useState(() => messageEnters(row, arrivedAfter));
  const [roomOpens] = useState(() => opensRoom(row) && rooms?.joinedInSight(row.id) === true);
  // Landed from the run's slot, it never rose in: drawn again, it still has arrived.
  const [landed] = useState(
    () => row.kind === "message" && !entering && wordsJustStood(row.message.id),
  );
  useEffect(() => {
    if (!entering && !landed) return;
    // The oldest goes first: clearing them all would let every message of
    // the open conversation newer than its opening rise in again.
    if (enteredMessages.size >= 500) {
      const oldest = enteredMessages.values().next();
      if (!oldest.done) enteredMessages.delete(oldest.value);
    }
    enteredMessages.add(row.id);
  }, [entering, landed, row.id]);
  const person =
    row.kind === "message" && row.message.role === "user" && !isStandUpAskRow(row, standUpAsk);
  const ref = useRef<HTMLDivElement>(null);
  const held = useHeldBehindComposer(ref, entering && person);
  // Such a row joining the conversation in sight opens its room from nothing, gap and all, on the
  // travel's curve (`easeRooms`): what stands under it, or the list following its end, moves with
  // it, never a step.
  const roomRef = useRef<HTMLDivElement>(null);
  const rowId = row.id;
  useLayoutEffect(() => {
    const room = roomRef.current;
    if (!roomOpens || room === null) return;
    rooms?.opened(rowId);
    // Once open it hears nothing more: its observers go.
    let stopOnceOpen: (() => void) | null = null;
    const eased = easeRooms({
      root: room,
      selector: ":not(*)",
      eases: () => true,
      rootClips: true,
      grows: () => true,
      afterStep: () => stopOnceOpen?.(),
    });
    stopOnceOpen = () => {
      if (!eased.easing()) eased.stop();
    };
    eased.easeFrom(room, 0);
    stopOnceOpen();
    return () => eased.stop();
  }, [roomOpens, rooms, rowId]);
  // Its entrance plays once: the list moves a row among its siblings by putting it back in the
  // page, which plays a running entrance again (recheck on 0.15.44: every answer rose in twice).
  const [entered, setEntered] = useState(false);
  const drawn = (
    <div
      ref={ref}
      className={cn(
        card === undefined || card === "top" ? gap : null,
        card === undefined ? rowInset(row) : null,
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
        held
          ? "opacity-0"
          : entering &&
              !entered &&
              (person
                ? "origin-bottom-right animate-bubble-in motion-reduce:animate-none"
                : "animate-rise-in motion-reduce:animate-none"),
      )}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntered(true);
      }}
      data-card-slice={card}
      data-card-whole={row.cardWhole ? "" : undefined}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {card === undefined ? (
        content
      ) : (
        <div className={cn(CARD_SLICE[card], card === "middle" ? gap : null)}>{content}</div>
      )}
    </div>
  );
  // Its room holds the row's gap too: a gap is padding, which a height of nothing keeps.
  return roomOpens ? <div ref={roomRef}>{drawn}</div> : drawn;
});

/** The longest a sent message waits out of sight for the list to bring it above the composer. */
const HELD_BEHIND_COMPOSER_MS = 600;

/**
 * Whether a message the person just sent is still held out of sight: the list adds it at its end,
 * under the composer, and glides it up; it is drawn once it stands clear of the composer, never
 * peeking out from behind it (Milo's stress run 4: born 62 px behind the composer for two frames).
 */
function useHeldBehindComposer(
  ref: React.RefObject<HTMLDivElement | null>,
  enters: boolean,
): boolean {
  const [held, setHeld] = useState(enters);
  useLayoutEffect(() => {
    if (!held) return;
    const started = performance.now();
    let frame = 0;
    const clear = () => {
      const node = ref.current;
      const composer = document.querySelector('[data-slot="composer-shell"]');
      if (node === null || composer === null) return true;
      const box = node.getBoundingClientRect();
      const viewport = node.closest("[data-timeline-thread]")?.getBoundingClientRect();
      return (
        box.bottom <= composer.getBoundingClientRect().top + 1 &&
        (viewport === undefined || box.bottom > viewport.top)
      );
    };
    const check = () => {
      if (clear() || performance.now() - started > HELD_BEHIND_COMPOSER_MS) setHeld(false);
      else frame = requestAnimationFrame(check);
    };
    check();
    return () => cancelAnimationFrame(frame);
  }, [held, ref]);
  return held;
}

/** A message that is a Mate's stand-up ask, where the conversation draws it as its quiet line. */
function isStandUpAskRow(row: TimelineRow, standUpAsk: string | null): boolean {
  return (
    standUpAsk !== null &&
    row.kind === "message" &&
    row.message.role === "user" &&
    isMateStandUpAsk(row.message.text)
  );
}

function TimelineRowBody({ row }: { row: TimelineRow }) {
  const ctx = use(TimelineRowCtx);
  const askLine = isStandUpAskRow(row, ctx.standUpAsk);
  return (
    <>
      {askLine && row.kind === "message" && ctx.standUpAsk !== null ? (
        <StandUpAskLine
          at={row.message.createdAt}
          timestampFormat={ctx.timestampFormat}
          words={ctx.standUpAsk}
        />
      ) : null}
      {row.kind === "message" && row.message.role === "user" && !askLine ? (
        <UserTimelineRow row={row} />
      ) : null}
      {row.kind === "message" && row.message.role === "assistant" ? (
        <AssistantTimelineRow row={row} />
      ) : null}
      {row.kind === "work-line" ? <WorkLineTimelineRow row={row} /> : null}
      {row.kind === "record" ? <RecordTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
      {row.kind === "after-work" ? <AfterWorkTimelineRow row={row} /> : null}
      {row.kind === "work" ? (
        <WorkGroupSection
          groupedEntries={row.groupedEntries}
          isExpandedToolGroupEntry={row.isExpandedToolGroupEntry}
        />
      ) : null}
      {row.kind === "operation" ? <OperationTimelineRow row={row} /> : null}
      {row.kind === "event" ? <EventTimelineRow row={row} /> : null}
      {row.kind === "notice" ? <NoticeTimelineRow row={row} /> : null}
      {row.kind === "crew-card" ? <CrewCardTimelineRow row={row} /> : null}
      {/* A task opens its conversation as its card; what is said of it after its Mate took it
          follows as its authors'. Its brief draws no row. */}
      {row.kind === "task-ask" ? (
        <TaskCardTimelineRow source={row.source} taskId={row.taskId} text={row.text} />
      ) : null}
      {row.kind === "task-message" ? <MateTaskMessageRow message={row.message} /> : null}
      {/* Another Mate's message opens the run it started as that Mate's; while this Mate waits for
          an answer to its own, the conversation's end says whose. */}
      {row.kind === "mate-message" ? (
        <MateMessageRow
          item={row.item}
          markdownCwd={ctx.markdownCwd}
          skills={ctx.skills}
          text={row.text}
          threadRef={ctx.threadRef ?? undefined}
        />
      ) : null}
      {row.kind === "mate-wait" ? <MateAnswerWait awaited={row.awaited} /> : null}
      {row.kind === "background" ? <BackgroundTimelineRow row={row} /> : null}
      {row.kind === "error" ? <ErrorTimelineRow row={row} /> : null}
      {row.kind === "pause" ? <PauseTimelineRow row={row} /> : null}
      {row.kind === "outcome" ? <OutcomeTimelineRow row={row} /> : null}
      {row.kind === "page" ? <PageTimelineRow row={row} /> : null}
      {row.kind === "vault-request" ? <VaultRequestTimelineRow row={row} /> : null}
      {row.kind === "origin-request" ? <OriginRequestTimelineRow row={row} /> : null}
      {row.kind === "mirror-request" ? <MirrorRequestTimelineRow row={row} /> : null}
      {row.kind === "proposal" ? <ProposalTimelineRow row={row} /> : null}
      {row.kind === "seam" ? <SeamTimelineRow row={row} /> : null}
      {row.kind === "crew-seam" ? (
        <CrewSeamActivity asEvent seam={row.seam} words={row.words} />
      ) : null}
      {row.kind === "proposed-plan" ? <ProposedPlanTimelineRow row={row} /> : null}
      {row.kind === "queued-message" ? <QueuedMessageTimelineRow row={row} /> : null}
    </>
  );
}

function PauseTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "pause" }> }) {
  const ctx = use(TimelineRowCtx);
  const ref = useRef<HTMLDivElement>(null);
  const settledHeight = useRef<number | null>(null);
  const shownPhase = useRef<string | null>(null);
  // What the notice says changes when the pause lifts (Continue goes, the line goes quiet): its
  // height glides to the new one rather than cutting, so nothing around it jumps.
  const phase = `${row.resumedAt !== null}:${row.id === ctx.livePauseId ? ctx.limit?.kind : "none"}`;
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => {
      if (node.getAnimations().length === 0)
        settledHeight.current = node.getBoundingClientRect().height;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = ref.current;
    const before = shownPhase.current;
    shownPhase.current = phase;
    if (node === null || before === null || before === phase) return;
    // A glide still running is taken up where it stands: the lift can change the notice twice.
    const running = node.getAnimations();
    const from = running.length > 0 ? node.getBoundingClientRect().height : settledHeight.current;
    for (const glide of running) glide.cancel();
    const to = node.getBoundingClientRect().height;
    settledHeight.current = to;
    if (from === null || Math.abs(from - to) < 1 || prefersReducedMotion()) return;
    node.style.overflow = "clip";
    const glide = node.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 220,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
    glide.onfinish = () => {
      node.style.overflow = "";
    };
  }, [phase]);
  return (
    <div
      ref={ref}
      style={row.id === ctx.pauseStage?.id ? { height: ctx.pauseStage.height } : undefined}
    >
      <PauseBlock
        stage={row.id === ctx.pauseStage?.id}
        mate={ctx.pauseStage?.mate ?? null}
        nowMs={Date.now()}
        onContinue={row.id === ctx.livePauseId ? (ctx.onUsageContinue ?? null) : null}
        triesBeforeReset={ctx.usageContinueTries === true}
        limit={row.id === ctx.livePauseId ? (ctx.limit ?? NO_MATE_LIMIT) : NO_MATE_LIMIT}
        blockedByAnswer={row.id === ctx.livePauseId && ctx.queueBlockedByAnswer === true}
        row={row}
        serverPause={row.id === ctx.livePauseId ? ctx.usagePause : null}
        speaker={ctx.speaker}
        timestampFormat={ctx.timestampFormat}
      />
    </div>
  );
}
