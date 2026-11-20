import { useLayoutEffect, useRef, useState } from "react";
import { wordsJustStood } from "./wordsLanding";
import { type FoldsFrom, type MessagesTimelineRow } from "./MessagesTimeline.logic";

/**
 * Where the Mate at work last stood, per run, while this page drew it: its
 * row, its card's bottom edge and its line, and when it left. What settles in
 * its place — the report, or the Mate's last word under a run with nothing to
 * report — starts there and eases to its own height, so a panel folding away
 * never throws what follows (Nova, 2026-09-27: a tall panel folding into its
 * report threw a streamed answer 470 px). Only a panel that left just now
 * folds: one scrolled away, or never seen, is simply gone.
 */
interface PanelStand {
  readonly panel: number;
  readonly cardEnd: number;
  readonly line: number;
}
const panelStands = new Map<string, PanelStand>();
/** The row each stand was read from, while the list carries it. */
const panelRows = new Map<string, HTMLElement>();
/**
 * When a run's panel left the rows, read from the rows themselves: the list
 * mounts and unmounts its rows in its own order, so the row that replaces the
 * panel may arrive before the panel's own row is gone.
 */
const panelLeftAt = new Map<string, number>();
/** When what replaced a run's panel first took its stand: an effect replayed takes it again. */
const panelTakenAt = new Map<string, number>();
const FOLD_RETAKE_MS = 50;

/** Whether a run's panel stands in its list's view now, as the person reads it. */
function panelInView(turnKey: string): boolean {
  const panel = panelRows.get(turnKey);
  const view = panel?.closest<HTMLElement>(".timeline-legend-list");
  if (!panel || !view) return false;
  const box = panel.getBoundingClientRect();
  const sight = view.getBoundingClientRect();
  return box.height > 0 && box.bottom > sight.top && box.top < sight.bottom;
}

/** Marks the runs whose panel the rows no longer carry. */
export function markPanelsGone(
  previous: ReadonlyArray<MessagesTimelineRow>,
  rows: ReadonlyArray<MessagesTimelineRow>,
): void {
  const live = new Set(rows.flatMap((row) => (row.kind === "working" ? [row.turnKey] : [])));
  const now = performance.now();
  for (const row of previous) {
    if (row.kind !== "working" || live.has(row.turnKey)) continue;
    // A hand-off plays only from what the person saw: a panel that left out of the view hands
    // nothing over, and what takes its place stands at its own height.
    if (panelInView(row.turnKey)) panelLeftAt.set(row.turnKey, now);
    else panelStands.delete(row.turnKey);
  }
  for (const turnKey of live) {
    panelLeftAt.delete(turnKey);
    panelTakenAt.delete(turnKey);
  }
}
const FOLD_FRESH_MS = 1500;
/** How long after its panel left a run's report, arriving late, still eases in. */
const FOLD_LATE_MS = 4000;
const FOLD_EASE = "height 460ms cubic-bezier(0.32, 0.72, 0, 1)";

function rowElementById(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(id)}"]`);
}

/**
 * The stand a run's panel just left, for what takes its place: null when the
 * panel is still there, left a while ago, or its stand was taken already — an
 * effect replayed at once (React's strict mode runs each twice) takes it again.
 */
export function takePanelStand(turnKey: string): PanelStand | null {
  const stand = panelStands.get(turnKey);
  const leftAt = panelLeftAt.get(turnKey);
  if (stand === undefined || leftAt === undefined) return null;
  const now = performance.now();
  const takenAt = panelTakenAt.get(turnKey);
  if (takenAt === undefined) panelTakenAt.set(turnKey, now);
  else if (now - takenAt > FOLD_RETAKE_MS) return null;
  return now - leftAt < FOLD_FRESH_MS ? stand : null;
}

/** A run's panel left the rows a moment ago: what arrives in its place late still eases. */
export function panelLeftRecently(turnKey: string): boolean {
  const leftAt = panelLeftAt.get(turnKey);
  return leftAt !== undefined && performance.now() - leftAt < FOLD_LATE_MS;
}

/** Eases an element's height from `from` to `to`, then lets it size itself again. */
function easeHeight(element: HTMLElement, from: number, to: number): () => void {
  if (Math.abs(to - from) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }
  const release = () => {
    element.style.height = "";
    element.style.overflow = "";
    element.style.transition = "";
  };
  element.style.height = `${from}px`;
  element.style.overflow = "hidden";
  const frame = requestAnimationFrame(() => {
    element.style.transition = FOLD_EASE;
    element.style.height = `${to}px`;
  });
  const onEnd = (event: TransitionEvent) => {
    if (event.target !== element || event.propertyName !== "height") return;
    element.removeEventListener("transitionend", onEnd);
    release();
  };
  element.addEventListener("transitionend", onEnd);
  return () => {
    cancelAnimationFrame(frame);
    element.removeEventListener("transitionend", onEnd);
    release();
  };
}

/** Records where a run's panel stands while the rows carry it. */
export function usePanelStand(turnKey: string, cardKey: string) {
  const markerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const own = markerRef.current?.closest<HTMLElement>("[data-timeline-row-id]");
    if (!own) return;
    const measure = () => {
      // Gone from the rows, its row may still be emptied or recycled: its
      // last stand is the one it left.
      if (panelLeftAt.has(turnKey) || !own.isConnected) return;
      const panel = own.getBoundingClientRect().height;
      if (panel <= 0) return;
      panelRows.set(turnKey, own);
      panelStands.set(turnKey, {
        panel,
        cardEnd: rowElementById(`card-end:${cardKey}`)?.getBoundingClientRect().height ?? 0,
        line: rowElementById(`work-line:${cardKey}`)?.getBoundingClientRect().height ?? 0,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(own);
    return () => {
      observer.disconnect();
      // Unmounted while the rows still carry it — scrolled out of the list's
      // window — its stand would be stale by the time it is taken.
      if (!panelLeftAt.has(turnKey)) panelStands.delete(turnKey);
      if (panelRows.get(turnKey) === own) panelRows.delete(turnKey);
    };
  }, [turnKey, cardKey]);
  return markerRef;
}

/**
 * Room at the top of the Mate's last word under a run that settled into its
 * line alone: as tall as the panel that just stood there, easing to nothing.
 */
export function FoldRoom({
  fold,
  words,
}: {
  readonly fold: FoldsFrom | undefined;
  /** The message whose words it stands above. */
  readonly words: string;
}) {
  const roomRef = useRef<HTMLDivElement>(null);
  // Once it folds it folds through: a report arriving a moment later — the
  // files a run changed are known after its settle — eases in from the card
  // while this room eases on to nothing, rather than snapping shut.
  const [folding, setFolding] = useState<FoldsFrom | undefined>(fold);
  if (fold !== undefined && folding === undefined) setFolding(fold);
  useLayoutEffect(() => {
    const room = roomRef.current;
    if (folding === undefined || room === null) return;
    const stand = takePanelStand(folding.turnKey);
    // Words read in the run's slot land from where they stood (`onAnswerLands`): under the panel's
    // room they opened a panel's height below it, then eased back up (a crash's lost job, 49 px).
    if (stand === null || wordsJustStood(words)) return;
    const lineNow = rowElementById(`work-line:${folding.cardKey}`)?.getBoundingClientRect().height;
    const from =
      stand.panel +
      (folding.cardClosed ? stand.cardEnd + (stand.line - (lineNow ?? stand.line)) : 0);
    return easeHeight(room, from, 0);
  }, [folding]);
  return <div ref={roomRef} aria-hidden="true" data-fold-room />;
}
