/** Measured work folding shut into its run's line; the list owns the outer handoff. */
import { ROOM_TAU_MS, approach } from "./runMotion.logic";
/** The list executes the fold's effects outside the measured child. */
export interface FoldOuter {
  readonly ready: () => boolean;
  readonly start: () => void;
  readonly resize: (taken: number, shrink: () => void) => void;
  readonly finish: () => void;
  readonly cancel: () => void;
}

export function foldWork({
  above,
  from,
  done,
  outer,
}: {
  /** The work over the line. */
  readonly above: HTMLElement;
  /** The height the fold starts from. */
  readonly from: number;
  readonly done: () => void;
  readonly outer?: FoldOuter;
}): () => void {
  let height = from;
  let frame = 0;
  let last = 0;
  let finished = false;
  above.style.height = `${from}px`;
  const step = (now: number) => {
    frame = 0;
    if (outer?.ready() === false) {
      frame = requestAnimationFrame(step);
      return;
    }
    if (last === 0) outer?.start();
    const next = approach(height, 0, last === 0 ? 1000 / 60 : now - last, ROOM_TAU_MS);
    last = now;
    const taken = height - next;
    height = next;
    // A clip, never a fade (run 11: the work was gone by 40 % of the fold
    // while the card still moved): it stays whole until the edge takes it.
    const shrink = () => {
      above.style.height = `${next}px`;
    };
    if (outer === undefined) shrink();
    else outer.resize(taken, shrink);
    if (next === 0) {
      finished = true;
      outer?.finish();
      done();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  // Stopped once shut, it holds the rows under the card on until the list has them.
  return () => {
    if (finished) return;
    cancelAnimationFrame(frame);
    outer?.cancel();
  };
}
