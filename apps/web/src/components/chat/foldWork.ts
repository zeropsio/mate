/**
 * A settled run's work folding shut into its line (pass 39, replacing the
 * stepped fold of 2026-09-29). One motion at a time: the fold waits for the
 * conversation to finish gliding to what the settle brought (the answer, the
 * result), then eases the work's height to nothing on the run card's curve —
 * a clip: what it holds stays whole until the edge passes over it.
 *
 * In a conversation that follows its end, the line and everything under it
 * keep their place and what stands above comes down to meet it: each frame the
 * list's scroll gives back what the fold took. The list places the rows under
 * the card a frame or two late; each frame those rows are held where they
 * belong — their place under the card's edge as it stands — until the list
 * has them there itself.
 */
import { ROOM_TAU_MS, approach } from "./runMotion.logic";
import { GLIDING_ATTRIBUTE, scrollOwn } from "./timelineEndFollow";

/** Frames the rows under the card are held after the fold, while the list catches up. */
const HOLD_AFTER_FRAMES = 6;

/** The most frames the fold waits for the conversation to settle. */
const WAIT_AT_MOST_FRAMES = 60;

/** Frames the list takes to lay out the rows a settle brings, at the least. */
const LIST_LAYS_OUT_FRAMES = 3;

export function foldWork({
  above,
  from,
  done,
}: {
  /** The work over the line. */
  readonly above: HTMLElement;
  /** The height the fold starts from. */
  readonly from: number;
  readonly done: () => void;
}): () => void {
  const slice = above.closest<HTMLElement>("[data-card-slice]");
  // The list's row holding the card, its scroll, and the rows under it.
  const holder = slice?.closest("[data-timeline-root]")?.parentElement ?? null;
  const scroller = holder?.closest<HTMLElement>(".timeline-legend-list") ?? null;
  const edge = () => slice?.getBoundingClientRect().bottom ?? 0;
  const translateOf = (row: HTMLElement) =>
    Number.parseFloat(row.style.translate.split(" ")[1] ?? "") || 0;
  // The rows under the card and how far under its edge each stands, read as
  // the fold sets out: the list has placed what the settle brought by then.
  const below: Array<{ readonly row: HTMLElement; readonly offset: number }> = [];
  const readBelow = () => {
    if (!holder?.parentElement) return;
    const top = holder.getBoundingClientRect().top;
    const bottom = edge();
    for (const row of holder.parentElement.children) {
      if (!(row instanceof HTMLElement) || row === holder) continue;
      const box = row.getBoundingClientRect();
      if (box.top > top && box.height > 0) below.push({ row, offset: box.top - bottom });
    }
  };
  const hold = () => {
    const bottom = edge();
    for (const { row, offset } of below) {
      const laid = row.getBoundingClientRect().top - translateOf(row);
      const off = bottom + offset - laid;
      row.style.translate = Math.abs(off) < 0.5 ? "" : `0 ${off}px`;
    }
  };
  // Heard after the list has heard the card shrink and placed its rows for it
  // (made after the list's own): what it placed is read, never a frame behind.
  const placed =
    typeof ResizeObserver === "undefined" || slice === null ? null : new ResizeObserver(hold);
  const release = () => {
    placed?.disconnect();
    for (const { row } of below) row.style.translate = "";
  };
  let height = from;
  let frame = 0;
  let last = 0;
  let waited = 0;
  let after = -1;
  above.style.height = `${from}px`;
  const step = (now: number) => {
    frame = 0;
    if (after >= 0) {
      hold();
      after += 1;
      if (after < HOLD_AFTER_FRAMES) frame = requestAnimationFrame(step);
      else release();
      return;
    }
    // Waits for the list to lay out what the settle brought, for it to enter
    // and for the conversation to stand at it.
    const busy =
      waited < LIST_LAYS_OUT_FRAMES ||
      scroller?.hasAttribute(GLIDING_ATTRIBUTE) === true ||
      scroller?.closest("[data-timeline-arriving]") != null;
    if (busy && waited < WAIT_AT_MOST_FRAMES) {
      waited += 1;
      frame = requestAnimationFrame(step);
      return;
    }
    if (last === 0) {
      readBelow();
      if (slice !== null) placed?.observe(slice);
    }
    const next = approach(height, 0, last === 0 ? 1000 / 60 : now - last, ROOM_TAU_MS);
    last = now;
    const taken = height - next;
    height = next;
    // A clip, never a fade (run 11: the work was gone by 40 % of the fold
    // while the card still moved): it stays whole until the edge takes it.
    above.style.height = `${next}px`;
    if (scroller !== null && scroller.closest("[data-timeline-follows-end]") !== null) {
      // The page's own move: never read as the person leaving the end.
      scrollOwn(scroller, scroller.scrollTop - taken);
    }
    hold();
    if (next === 0) {
      after = 0;
      done();
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  // Stopped once shut, it holds the rows under the card on until the list has them.
  return () => {
    if (after >= 0) return;
    cancelAnimationFrame(frame);
    release();
  };
}
