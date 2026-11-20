import { prefersReducedMotion } from "~/lib/reducedMotion";
import { type DrawnRow, orderedGlides, rowShifts } from "./slotMoves.logic";
import { RIDE_MS, type Travel } from "./runTravel";

/**
 * Stops what moves an element by a translate — a plop or a glide in flight —
 * so its place is read where the layout has it: a new move starts from where
 * it shows, never from a place the one it replaces held it off.
 */
export function stopGliding(element: HTMLElement): void {
  if (typeof element.getAnimations !== "function") return;
  // Only its own: a row's rise in (`run-rise`) moves it by a translate too.
  for (const animation of element.getAnimations()) {
    if (animation.id === GLIDE_ID) animation.cancel();
  }
}

/** What names a plop's or a glide's animation, so a new move stops only those. */
const GLIDE_ID = "run-glide";

/**
 * An element gliding to its place from where it showed (`stood`, its top on
 * screen) by `travel`; how far it glides. One in flight is taken over from
 * where it shows.
 */
function glideFrom(element: HTMLElement, stood: number, travel: Travel): number {
  stopGliding(element);
  return glideBy(
    element,
    visibleTravel(element, stood - element.getBoundingClientRect().top),
    travel,
  );
}

/** A translated row stays inside the scroll that clips it, including its first frame. */
export function visibleTravel(element: HTMLElement, moved: number): number {
  if (typeof getComputedStyle !== "function") return moved;
  const box = element.getBoundingClientRect();
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      style.clipPath === "none" &&
      !["auto", "scroll", "hidden", "clip"].includes(style.overflowY)
    )
      continue;
    const view = parent.getBoundingClientRect();
    lower = Math.max(lower, Math.min(0, view.top - box.top));
    upper = Math.min(upper, Math.max(0, view.bottom - box.bottom));
  }
  return Math.max(lower, Math.min(upper, moved));
}

/**
 * An element gliding from `moved` px off its place to it by `travel`: the
 * same share of its way, in every frame, as the heights the travel eases.
 */
export function glideBy(element: HTMLElement, moved: number, travel: Travel): number {
  if (Math.abs(moved) < 0.5) return 0;
  // Added to what moves it already: a call's rise keeps the rest of its way.
  // Its travel says where in its way it stands, frame by frame (`ride`).
  travel.ride(
    element.animate([{ translate: `0 ${moved}px` }, { translate: "0 0" }], {
      id: GLIDE_ID,
      composite: "add",
      duration: RIDE_MS,
      easing: "linear",
    }),
    moved,
  );
  return moved;
}

/**
 * The lines in the scroll's view that moved on screen since `before`, gliding
 * from where they stood by `travel` — the room a landing takes moves them, and
 * they move as it does, never in one frame. A line that was not there — the
 * one landing, one that rode along with it — comes with the line over it, from
 * under the scroll's edge: where it stood in the slot is outside the scroll,
 * which would cut it.
 */
export function glideLines(
  scroll: HTMLElement,
  list: HTMLElement,
  before: ReadonlyMap<string, number>,
  /** How far the scroll moved since `before` was read, as painted: its lines stood that much higher. */
  scrolled: number,
  landed: ReadonlySet<HTMLElement>,
  /** How far under the scroll's top its view ended before: a slot that grew took room a line stood in. */
  stoodEnd: number | null,
  travel: Travel,
  /** How far the scroll's box still shrinks under the lines: they go by that too. */
  gives: number,
): void {
  if ((before.size === 0 && landed.size === 0) || prefersReducedMotion()) return;
  const shown = scroll.getBoundingClientRect();
  const view = {
    top: shown.top,
    bottom: Math.max(shown.bottom, stoodEnd === null ? shown.bottom : shown.top + stoodEnd),
  };
  const rows = [...list.children].filter(
    (line): line is HTMLElement => line instanceof HTMLElement,
  );
  // Cancel every sibling before measuring any: one plan owns their travel,
  // including a landed row whose old slot position the scroll clips.
  for (const line of rows) stopGliding(line);
  // How far the line over the one read glides: what was not there comes with it.
  let over = 0;
  const moves = rows.map((line) => {
    const stood =
      landed.has(line) || line.dataset.runKey === undefined
        ? undefined
        : before.get(line.dataset.runKey);
    if (stood !== undefined) {
      const box = line.getBoundingClientRect();
      const moved = stood - scrolled - (box.top - shown.top);
      // Where it stood it was drawn: it comes from there whole, its foot under
      // the scroll's edge if the landing grew it (a call joining its card).
      const seen = box.bottom + moved >= view.top && box.top + moved <= view.bottom;
      over = seen ? moved : 0;
    }
    return over;
  });
  const ordered = orderedGlides(moves);
  // A call joining a card that stood there rides its card, as what the card holds does.
  for (let index = 0; index < rows.length; index += 1) {
    glideBy(rows[index]!, ordered[index]!, travel);
  }
  travel.far(Math.max(0, ...ordered) + gives);
}

/** The rows of one holder of a run's history — its list, or a card of calls — as drawn, each by its top in it. */
export interface HolderRows {
  readonly holder: HTMLElement;
  readonly rows: ReadonlyArray<DrawnRow & { readonly row: HTMLElement }>;
}

/** A card's calls in its row of the history: two levels under it, never a search of it. */
function callsIn(line: Element): HTMLElement | null {
  for (const part of line.children) {
    for (const inner of part.children) {
      if (inner instanceof HTMLElement && inner.hasAttribute("data-chat-calls")) return inner;
    }
  }
  return null;
}

/** The rows a holder draws, each by its top in the holder as laid out (a glide's translate left out). */
function rowsIn(holder: HTMLElement, was: HolderRows | undefined): HolderRows {
  const found: Array<{ readonly key: string; readonly row: HTMLElement }> = [];
  for (const row of holder.children) {
    const key = row.getAttribute("data-run-key");
    if (key !== null && row instanceof HTMLElement) found.push({ key, row });
  }
  // Grown only at its foot: what stood keeps the place last read, and only
  // what joined is read — a long history's every row would take milliseconds.
  const grew =
    was !== undefined &&
    was.rows.length <= found.length &&
    was.rows.every((row, index) => found[index]!.key === row.key);
  return {
    holder,
    rows: found.map(({ key, row }, index) => ({
      key,
      row,
      top: grew && index < was.rows.length ? was.rows[index]!.top : topIn(holder, row),
    })),
  };
}

/** A row's top in what holds it, as laid out: a glide's translate left out. */
function topIn(holder: HTMLElement, row: HTMLElement): number {
  return row.offsetParent === holder.offsetParent
    ? row.offsetTop - holder.offsetTop
    : row.offsetTop;
}

/** The rows of a run's history by what holds them: its lines (""), and each card's calls by its key. */
export function historyRows(
  list: HTMLElement,
  was: ReadonlyMap<string, HolderRows> | undefined,
): ReadonlyMap<string, HolderRows> {
  const lines = rowsIn(list, was?.get(""));
  const rows = new Map([["", lines]]);
  for (const { key, row } of lines.rows) {
    const calls = callsIn(row);
    if (calls !== null) rows.set(key, rowsIn(calls, was?.get(key)));
  }
  return rows;
}

/** How far past the scroll's view a row's place is read again as heights ease. */
const RETOP_MARGIN_PX = 400;

/**
 * The rows as they stand now, what holds them unchanged since they were
 * drawn: a height easing moved the rows under it. Only the rows near the
 * scroll's view are read again — a long history's thousands would take
 * milliseconds a frame — by where each last stood; one far from it, or one
 * whose place is unknown since a scroll took the view away, is unknown,
 * and is never glided (`rowShifts`).
 */
export function retopped(
  drawn: ReadonlyMap<string, HolderRows>,
  scroll: HTMLElement,
): ReadonlyMap<string, HolderRows> {
  const near = {
    top: scroll.scrollTop - RETOP_MARGIN_PX,
    bottom: scroll.scrollTop + scroll.clientHeight + RETOP_MARGIN_PX,
  };
  const lines = drawn.get("");
  if (lines === undefined) return drawn;
  const rows = new Map<string, HolderRows>([["", nearRows(lines, 0, near)]]);
  // Where each card of calls stands in the list: its calls stand under it.
  const cardTops = new Map(rows.get("")!.rows.map(({ key, top }) => [key, top] as const));
  for (const [holderKey, held] of drawn) {
    if (holderKey === "") continue;
    const base = cardTops.get(holderKey) ?? null;
    rows.set(
      holderKey,
      base === null
        ? { holder: held.holder, rows: held.rows.map((row) => ({ ...row, top: null })) }
        : nearRows(held, base, near),
    );
  }
  return rows;
}

/**
 * The rows of one holder near the view, read where they stand — the first
 * found by halves, the rest until one stands past it — and the others
 * unknown: whatever the view did since, a scroll included, the rows it
 * reaches are read anew (`base`: the holder's top in the list).
 */
function nearRows(
  held: HolderRows,
  base: number,
  near: { readonly top: number; readonly bottom: number },
): HolderRows {
  const { holder, rows } = held;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const row = rows[middle]!.row;
    if (base + topIn(holder, row) + row.offsetHeight < near.top) low = middle + 1;
    else high = middle;
  }
  const read = rows.map((row) => ({ ...row, top: null as number | null }));
  for (let index = low; index < rows.length; index += 1) {
    const top = topIn(holder, rows[index]!.row);
    if (base + top > near.bottom) break;
    read[index] = { ...rows[index]!, top };
  }
  return { holder, rows: read };
}

/**
 * The rows in view that the rows around them moved since the last draw —
 * what joined above them, what left — gliding from where they stood on the
 * plop's curve (`rowShifts`), a glide in flight taken over from where it
 * shows; a call in a card rides its card. The lines themselves only when
 * `lines`.
 */
export function glideShifted(
  list: HTMLElement,
  before: ReadonlyMap<string, HolderRows>,
  after: ReadonlyMap<string, HolderRows>,
  lines: boolean,
  travel: Travel,
): void {
  if (prefersReducedMotion()) return;
  const scroll = list.parentElement;
  if (scroll === null) return;
  let view: DOMRect | null = null;
  for (const [holderKey, { rows }] of after) {
    const was = before.get(holderKey);
    if (was === undefined || (holderKey === "" && !lines)) continue;
    const shifts = rowShifts(was.rows, rows);
    if (shifts.size === 0) continue;
    view ??= scroll.getBoundingClientRect();
    for (const { key, row } of rows) {
      const shift = shifts.get(key);
      if (shift === undefined) continue;
      const box = row.getBoundingClientRect();
      if (box.bottom - shift < view.top || box.top - shift > view.bottom) continue;
      glideFrom(row, box.top - shift, travel);
    }
  }
}
