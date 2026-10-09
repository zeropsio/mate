/** Outer placement during a measured work fold, executed by MessagesTimeline. */
import { foldWork } from "./foldWork";
import { GLIDING_ATTRIBUTE, scrollOwn } from "./timelineEndFollow";

// Existing virtualizer handoff windows: allow initial layout, then hold through delayed placement.
const LIST_LAYS_OUT_FRAMES = 3;
const WAIT_AT_MOST_FRAMES = 60;
const HOLD_AFTER_FRAMES = 6;

export function foldTimelineWork({
  above,
  from,
  done,
  viewport,
  rows,
  arriving,
  follows,
  start,
  release,
}: Omit<Parameters<typeof foldWork>[0], "outer"> & {
  readonly viewport: () => HTMLElement | null;
  readonly rows: () => ReadonlyArray<{
    readonly row: HTMLElement;
    readonly position: number;
    readonly size: number;
  }>;
  readonly arriving: () => boolean;
  readonly follows: () => boolean;
  readonly start: () => void;
  readonly release: () => void;
}): { readonly cancel: () => void; readonly dispose: () => void; readonly place: () => void } {
  let waited = 0;
  let frame = 0;
  let slice: HTMLElement | null = null;
  let holder: HTMLElement | null = null;
  const below: Array<{ readonly row: HTMLElement; readonly offset: number }> = [];
  const translateOf = (row: HTMLElement) =>
    Number.parseFloat(row.style.translate.split(" ")[1] ?? "") || 0;
  const hold = () => {
    if (slice === null) return;
    const geometry = rows();
    const own = geometry.find(({ row }) => row === holder);
    if (holder === null || own === undefined) return;
    const bottom = slice.getBoundingClientRect().bottom;
    const origin = holder.getBoundingClientRect().top - translateOf(holder) - own.position;
    for (const { row, offset } of below) {
      const placed = geometry.find((item) => item.row === row);
      if (placed === undefined) continue;
      // Position is the list's committed placement, even before its DOM styles catch up.
      const laid = origin + placed.position;
      const off = bottom + offset - laid;
      row.style.translate = Math.abs(off) < 0.5 ? "" : `0 ${off}px`;
    }
  };
  const placed = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(hold);
  let released = false;
  const clear = () => {
    if (released) return;
    released = true;
    cancelAnimationFrame(frame);
    placed?.disconnect();
    for (const { row } of below) row.style.translate = "";
    release();
  };
  const cancel = foldWork({
    above,
    from,
    done,
    outer: {
      ready: () => {
        const busy =
          waited < LIST_LAYS_OUT_FRAMES ||
          viewport()?.hasAttribute(GLIDING_ATTRIBUTE) === true ||
          arriving();
        if (!busy || waited >= WAIT_AT_MOST_FRAMES) return true;
        waited += 1;
        return false;
      },
      start: () => {
        start();
        const elements = rows();
        const own = elements.find(({ row }) => row.contains(above));
        holder = own?.row ?? null;
        // Card-local geometry; row identities and the viewport come from the owning list.
        slice = above.closest<HTMLElement>("[data-card-slice]");
        if (own === undefined || holder === null || slice === null) return;
        const bottom = slice.getBoundingClientRect().bottom;
        // Panel carry translates the card inside its row; it is motion, not layout spacing.
        const inset = holder.getBoundingClientRect().bottom - bottom + translateOf(slice);
        for (const { row, position } of elements) {
          const box = row.getBoundingClientRect();
          if (row !== holder && position > own.position && box.height > 0)
            // The list may still place siblings using the holder's previous measured size.
            // Keep its spacing, rather than capturing that temporary overlap as the offset.
            below.push({ row, offset: position - own.position - own.size + inset });
        }
        placed?.observe(slice);
      },
      resize: (taken, shrink) => {
        const scroller = viewport();
        // Read before applying the child's shrink: the browser may clamp it during layout.
        const top = scroller?.scrollTop ?? 0;
        shrink();
        if (scroller !== null && follows()) scrollOwn(scroller, top - taken);
        hold();
      },
      finish: () => {
        let after = 0;
        const catchUp = () => {
          hold();
          if (++after < HOLD_AFTER_FRAMES) frame = requestAnimationFrame(catchUp);
          else clear();
        };
        frame = requestAnimationFrame(catchUp);
      },
      cancel: clear,
    },
  });
  return {
    cancel,
    place: hold,
    dispose: () => {
      cancel();
      clear();
    },
  };
}
