/**
 * The conversation line's motion (the owner, 2026-09-29: "why isn't the
 * transition between these ten time more smooth, animated, beautiful?").
 * Switching between the Mate and its crewmates is one move: the band
 * travels from the seat left to the seat opened, the seats between slide to
 * where they now stand, the name left folds back into its face and the one
 * opened opens out of its own, its ⌄ riding at the edge — over 240 ms, from
 * wherever a press before left them.
 *
 * Only transform and opacity move, so it all runs on the compositor and the
 * conversation swapping below at the same moment never stalls it. The band
 * is three pieces of one colour: its two round ends travel and the straight
 * run between them stretches, so its corners stay round on every frame —
 * one stretched shape would squash them. A name's words sit in a window
 * that slides shut over them while they slide the other way, so they stay
 * put as they are covered: the look of a clip, on the compositor.
 *
 * The line is read just before React changes it and again after; each piece
 * then starts from where it was seen and ends where it now stands. Which
 * change moves at all is `lineMotion`'s: a first paint, the crew arriving,
 * a crewmate added or gone are placed, and a reflow is followed at once.
 */
import { Component, createRef } from "react";

import { afterLayout } from "~/lib/afterLayout";

import { lineMotion, MATE_SEAT, sameLineStage, type LineStage } from "./ConversationStrip.logic";
import { fadeAlong, lowestTrack } from "./ConversationStripMotion.logic";

/**
 * Every travel on the line — the band, the seats, the names — on one clock,
 * shaped like a spring from rest that settles without overshoot: it moves on
 * the first frame, peaks early and eases in long, never taking more than 16 %
 * of its way in one frame at 60 Hz. The strong ease-out took 29 % and then
 * 24 % in its first two frames, which read as a jump on a 200 px travel; the
 * ease-in-out held still for four frames, then took 28 % in one.
 */
const TRAVEL_MS = 240;
const TRAVEL: KeyframeAnimationOptions = {
  duration: TRAVEL_MS,
  easing: "cubic-bezier(0.19, 0.06, 0.24, 1)",
};
/** Reduced motion: nothing travels; the band and the names cross-fade. */
const CROSSFADE: KeyframeAnimationOptions = { duration: 120, easing: "ease" };

/** How far the band's run tucks under each of its round ends: no seam between them. */
const TUCK_PX = 1;

/** How much of its way out of its face a name travels before it shows whole. */
const NAME_FADE = 0.6;

/** A name left folds back into its face by this share of the travel, even with nothing closing in. */
const FOLDED_BY = 0.6;

/** *N more*, which slides with the seats; no crewmate's handle is ever this. */
const MORE = "@more";

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the band stands at rest: the box of what stands on it, and its corner. */
interface BandTarget {
  readonly box: Box;
  readonly radius: number;
}

/** One name as seen: how far its window is shut, how opaque it is, how wide it stands. */
interface NameSeen {
  readonly open: boolean;
  readonly shut: number;
  readonly opacity: number;
  readonly width: number;
}

/** The line as seen just before React changes it, from its own corner. */
interface LineSeen {
  /** The band's pieces as drawn, sliding or not; `null` while it stands nowhere. */
  readonly band: ReadonlyArray<Box> | null;
  /** Each seat, and *N more*: as drawn, and where the flow holds it under its slide. */
  readonly seats: ReadonlyMap<string, { readonly drawn: Box; readonly flowLeft: number }>;
  /** Each name shown or folding, by its crewmate's handle. */
  readonly names: ReadonlyMap<string, NameSeen>;
  /** The crewmate whose press held the focus. */
  readonly focus: string | null;
  /**
   * Seen with nothing on the line moving and nothing switched: no box was
   * read, since a draw at rest only follows a reflow, from where things stand.
   */
  readonly still?: true;
}

const NOTHING_SEEN: ReadonlyMap<never, never> = new Map();

/** How long after a move set off something on the line may still be moving. */
const MOVING_MS = TRAVEL_MS + 60;

function boxOf(element: Element, origin: DOMRect): Box {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}

/** How far `element` is drawn from its place in the flow, mid-slide; none at rest. */
function shiftOf(element: Element): number {
  const transform = getComputedStyle(element).transform;
  return transform === "none" || transform === "" ? 0 : new DOMMatrixReadOnly(transform).m41;
}

function stop(element: Element): void {
  for (const animation of element.getAnimations()) animation.cancel();
}

/** The seats in the line's flow, and *N more* while it is drawn: what slides. */
function movers(
  line: HTMLElement,
): ReadonlyArray<{ readonly key: string; readonly node: Element }> {
  const found: Array<{ readonly key: string; readonly node: Element }> = [];
  for (const seat of line.querySelectorAll<HTMLElement>("[data-conversation-seat]")) {
    if (getComputedStyle(seat).visibility === "hidden") continue;
    found.push({ key: seat.dataset.conversationSeat ?? "", node: seat });
  }
  const more = line.querySelector("[data-conversation-more]");
  if (more !== null && getComputedStyle(more).visibility !== "hidden") {
    found.push({ key: MORE, node: more });
  }
  return found;
}

interface NameParts {
  readonly handle: string;
  readonly label: HTMLElement;
  /** The window over the words, which slides shut. */
  readonly window: Element;
  /** The words, which slide the other way and so stay put. */
  readonly words: Element;
  readonly chevron: Element;
}

function names(line: HTMLElement): ReadonlyArray<NameParts> {
  const found: Array<NameParts> = [];
  for (const label of line.querySelectorAll<HTMLElement>("[data-conversation-label]")) {
    const handle = label.closest<HTMLElement>("[data-conversation-seat]")?.dataset.conversationSeat;
    const window = label.querySelector("[data-conversation-name]");
    const words = label.querySelector("[data-conversation-name-text]");
    const chevron = label.querySelector("[data-conversation-chevron]");
    if (handle === undefined || window === null || words === null || chevron === null) continue;
    found.push({ handle, label, window, words, chevron });
  }
  return found;
}

function readLine(line: HTMLElement, band: HTMLElement): LineSeen {
  const origin = line.getBoundingClientRect();
  const seats = new Map<string, { readonly drawn: Box; readonly flowLeft: number }>();
  for (const { key, node } of movers(line)) {
    const drawn = boxOf(node, origin);
    seats.set(key, { drawn, flowLeft: drawn.left - shiftOf(node) });
  }
  const seen = new Map<string, NameSeen>();
  for (const { handle, label, window } of names(line)) {
    seen.set(handle, {
      open: label.dataset.conversationLabel === "open",
      shut: -shiftOf(window),
      opacity: Number(getComputedStyle(label).opacity),
      width: label.getBoundingClientRect().width,
    });
  }
  const focus = focusIn(line);
  return {
    band: band.hasAttribute("data-on")
      ? [...band.children].map((piece) => boxOf(piece, origin))
      : null,
    seats,
    names: seen,
    focus,
  };
}

/** The crewmate whose press holds the focus on the line. */
function focusIn(line: HTMLElement): string | null {
  const active = document.activeElement;
  return active !== null && line.contains(active)
    ? (active.closest<HTMLElement>("[data-conversation-seat]")?.dataset.conversationSeat ?? null)
    : null;
}

/** The band's three pieces over `target`: a round end, the run tucked under both ends, a round end. */
function piecesOf(target: BandTarget): ReadonlyArray<Box> {
  const { box } = target;
  const radius = Math.min(target.radius, box.width / 2, box.height / 2);
  return [
    { left: box.left, top: box.top, width: radius, height: box.height },
    {
      left: box.left + radius - TUCK_PX,
      top: box.top,
      width: Math.max(0, box.width - 2 * radius + 2 * TUCK_PX),
      height: box.height,
    },
    { left: box.left + box.width - radius, top: box.top, width: radius, height: box.height },
  ];
}

/** What turns `at` into `from`, scaled from its top-left corner: where a piece starts from. */
function inverse(from: Box, at: Box): string {
  const scaleX = at.width === 0 ? 1 : from.width / at.width;
  const scaleY = at.height === 0 ? 1 : from.height / at.height;
  return `translate(${from.left - at.left}px, ${from.top - at.top}px) scale(${scaleX}, ${scaleY})`;
}

function sameTarget(left: BandTarget | null, right: BandTarget | null): boolean {
  if (left === null || right === null) return left === right;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  return (
    near(left.box.left, right.box.left) &&
    near(left.box.top, right.box.top) &&
    near(left.box.width, right.box.width) &&
    near(left.box.height, right.box.height) &&
    left.radius === right.radius
  );
}

/** A seat from where it was drawn to where it now stands. */
function slide(node: Element, from: number, origin: DOMRect): void {
  stop(node);
  const shift = from - boxOf(node, origin).left;
  if (Math.abs(shift) < 0.5) return;
  node.animate([{ transform: `translateX(${shift}px)` }, { transform: "none" }], TRAVEL);
}

/** Where a seat was drawn as the travel set off, and where it now stands, from the line's corner. */
interface Place {
  readonly seen: number;
  readonly at: number;
}

/**
 * A name opening out of its face or folding back into it, in step with the
 * travel. Its ⌄ rides at the edge of its words, and that edge is the lowest
 * of three tracks at every moment (`lowestTrack`): its own opening or
 * folding, the band's end — arriving under a name opening, leaving one that
 * folds — and the seat after it making room or closing in. So a name never
 * shows past the band, nor under the seat beside it. Folded, it is behind
 * its face's edge, where the name clips; it fades in over most of its way
 * out, and out over most of its way back (`fadeAlong`). Left alone, a fold
 * is done by `FOLDED_BY` of the travel.
 */
function moveName(input: {
  readonly name: NameParts;
  readonly opening: boolean;
  readonly seen: NameSeen | undefined;
  readonly place: Place;
  /** The seat after it, if any. */
  readonly next: Place | undefined;
  /** The band's end, arriving or leaving: its right edge as it set off, and where it stands. */
  readonly band: Place | undefined;
  readonly done: () => void;
}): void {
  const { name, opening, seen, place, next, band } = input;
  const { label, window, words, chevron } = name;
  for (const element of [label, window, words, chevron]) stop(element);
  if (opening) label.style.removeProperty("width");
  // Out of the flow while it folds, it keeps the width it stood at: a squeezed name its ellipsis.
  else if (seen !== undefined) label.style.width = `${seen.width}px`;
  const seatLeft = label.closest("[data-conversation-seat]")?.getBoundingClientRect().left ?? 0;
  const glyph = chevron.getBoundingClientRect();
  const open = glyph.left - seatLeft;
  // Folded: the ⌄ wholly behind the face's edge, where the name clips.
  const face = label.getBoundingClientRect().left - seatLeft - glyph.width;
  const start = seen === undefined ? (opening ? face : open) : open - seen.shut;
  const tracks: Array<{ readonly from: number; readonly to: number }> = [
    opening ? { from: start, to: open } : { from: start, to: start - (start - face) / FOLDED_BY },
  ];
  // An edge the ⌄ keeps its room from — the room it has with the name open:
  // where it ends for a name opening, where it starts for one folding.
  const follow = (edge: Place) => {
    const room = opening ? edge.at - place.at - open : edge.seen - place.seen - start;
    tracks.push({ from: edge.seen - place.seen - room, to: edge.at - place.at - room });
  };
  if (next !== undefined) follow(next);
  if (band !== undefined) follow(band);
  const frames = lowestTrack(tracks, face, Math.max(open, start));
  const timing: KeyframeAnimationOptions = { ...TRAVEL, fill: opening ? "none" : "forwards" };
  const along = (shift: (value: number) => number) =>
    frames.map((frame) => ({
      offset: frame.offset,
      transform: `translateX(${shift(frame.value)}px)`,
    }));
  const fold = window.animate(
    along((value) => value - open),
    timing,
  );
  chevron.animate(
    along((value) => value - open),
    timing,
  );
  words.animate(
    along((value) => open - value),
    timing,
  );
  label.animate(
    fadeAlong(frames, face, NAME_FADE * (open - face)).map((frame) => ({
      offset: frame.offset,
      opacity: frame.value,
    })),
    timing,
  );
  if (!opening) fold.onfinish = input.done;
}

/** Focus follows the press a switch drew anew: the pressed face is the pill now. */
function keepFocus(line: HTMLElement, handle: string | null): void {
  if (handle === null) return;
  const active = document.activeElement;
  if (active !== null && active !== document.body) return;
  line
    .querySelector<HTMLElement>(`[data-conversation-seat="${CSS.escape(handle)}"] > button`)
    ?.focus({ preventScroll: true });
}

export interface LineMotionProps {
  /** Where the band stands and the crew in its order, as drawn now. */
  readonly stage: LineStage;
  /** A name left has folded back into its face: it may go. */
  readonly onFolded: (handle: string) => void;
}

/**
 * The line's band, drawn behind everything on the line, and the motion of
 * everything on it. Drawn inside the line: its parent is what it measures
 * from and moves.
 */
export class LineMotion extends Component<LineMotionProps> {
  private readonly band = createRef<HTMLSpanElement>();
  private bandAt: BandTarget | null = null;
  private live = false;
  /** Until when something this line set moving may still move. */
  private movingUntil = Number.NEGATIVE_INFINITY;
  /** A follow at rest waits for the page to be laid out. */
  private followWaits = false;

  override componentDidMount(): void {
    this.live = true;
    const line = this.line();
    if (line !== null) this.place(line);
  }

  override componentWillUnmount(): void {
    this.live = false;
  }

  /**
   * The line as seen before React changes it. A draw that switches nothing
   * while nothing on the line moves — a face changing state, a chat's title
   * — reads no box: it is most of the line's draws while a Mate works, and a
   * box read here, before the commit's other changes are laid out, forced a
   * layout of the page on each.
   */
  override getSnapshotBeforeUpdate(previous: LineMotionProps): LineSeen | null {
    const line = this.line();
    const band = this.band.current;
    if (line === null || band === null) return null;
    if (sameLineStage(previous.stage, this.props.stage) && !this.moving()) {
      return {
        band: null,
        seats: NOTHING_SEEN,
        names: NOTHING_SEEN,
        focus: focusIn(line),
        still: true,
      };
    }
    return readLine(line, band);
  }

  override componentDidUpdate(
    previous: LineMotionProps,
    _state: unknown,
    seen: LineSeen | null,
  ): void {
    const line = this.line();
    if (line === null || seen === null) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = lineMotion(previous.stage, this.props.stage, { reducedMotion });
    if (motion === "travel") this.travel(line, seen);
    else if (motion === "fade") this.crossfade(line, seen);
    else if (seen.still === true) this.followAtRest();
    else if (sameLineStage(previous.stage, this.props.stage)) this.follow(line, seen);
    else this.place(line);
    keepFocus(line, seen.focus);
  }

  override render() {
    return (
      <span aria-hidden="true" className="conversation-band" ref={this.band}>
        <span />
        <span />
        <span />
      </span>
    );
  }

  private moving(): boolean {
    return performance.now() < this.movingUntil;
  }

  private setMoving(): void {
    this.movingUntil = performance.now() + MOVING_MS;
  }

  /**
   * A draw that switched nothing, with nothing moving: the band follows a
   * reflow at once — once the page is laid out and before it paints, where
   * reading where its seat now stands costs no layout of its own.
   */
  private followAtRest(): void {
    if (this.followWaits) return;
    this.followWaits = true;
    afterLayout(() => {
      this.followWaits = false;
      const line = this.line();
      // A switch drawn since moves it, from what it saw.
      if (!this.live || line === null || this.moving()) return;
      const target = this.target(line, line.getBoundingClientRect());
      if (!sameTarget(target, this.bandAt)) this.stand(target);
    });
  }

  private line(): HTMLElement | null {
    return this.band.current?.parentElement ?? null;
  }

  /** Where the band belongs now: under the Mate, or under the seat opened, where the flow holds it. */
  private target(line: HTMLElement, origin: DOMRect): BandTarget | null {
    const on = this.props.stage.band;
    if (on === null) return null;
    const element =
      on === MATE_SEAT
        ? line.querySelector("[data-conversation-mate]")
        : line.querySelector(`[data-conversation-seat="${CSS.escape(on)}"]`);
    if (element === null) return null;
    const drawn = boxOf(element, origin);
    return {
      box: { ...drawn, left: drawn.left - shiftOf(element) },
      radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
    };
  }

  /** Stands the band's pieces at rest over `target`, or takes it away. */
  private stand(target: BandTarget | null): void {
    const band = this.band.current;
    if (band === null) return;
    this.bandAt = target;
    stop(band);
    const pieces = [...band.children] as HTMLElement[];
    for (const piece of pieces) stop(piece);
    if (target === null) {
      band.removeAttribute("data-on");
      return;
    }
    const radius = `${Math.min(target.radius, target.box.width / 2, target.box.height / 2)}px`;
    piecesOf(target).forEach((box, index) => {
      const piece = pieces[index];
      if (piece === undefined) return;
      piece.style.left = `${box.left}px`;
      piece.style.top = `${box.top}px`;
      piece.style.width = `${box.width}px`;
      piece.style.height = `${box.height}px`;
      piece.style.borderRadius =
        index === 0 ? `${radius} 0 0 ${radius}` : index === 2 ? `0 ${radius} ${radius} 0` : "0";
    });
    band.setAttribute("data-on", "");
  }

  /** The band from its pieces as seen to `target`. */
  private carry(from: ReadonlyArray<Box>, target: BandTarget): void {
    this.setMoving();
    this.stand(target);
    const pieces = [...(this.band.current?.children ?? [])];
    piecesOf(target).forEach((at, index) => {
      const seen = from[index];
      const piece = pieces[index];
      if (seen === undefined || piece === undefined) return;
      piece.animate([{ transform: inverse(seen, at) }, { transform: "none" }], TRAVEL);
    });
  }

  /** A first paint, the crew arriving, a crewmate added or gone: all where it stands, at once. */
  private place(line: HTMLElement): void {
    for (const { node } of movers(line)) stop(node);
    for (const name of names(line)) {
      for (const element of [name.label, name.window, name.words, name.chevron]) stop(element);
      name.label.style.removeProperty("width");
    }
    for (const ghost of line.querySelectorAll("[data-conversation-band-ghost]")) ghost.remove();
    this.stand(this.target(line, line.getBoundingClientRect()));
  }

  /** A switch the person made: everything from where it was seen to where it now stands. */
  private travel(line: HTMLElement, seen: LineSeen): void {
    this.setMoving();
    const origin = line.getBoundingClientRect();
    const places = new Map<string, Place>();
    for (const { key, node } of movers(line)) {
      stop(node);
      const at = boxOf(node, origin).left;
      const was = seen.seats.get(key);
      places.set(key, { seen: was?.drawn.left ?? at, at });
      if (was !== undefined) slide(node, was.drawn.left, origin);
    }
    const target = this.target(line, origin);
    const seenBand = seen.band;
    let band: Place | undefined;
    if (target === null || seenBand === null) this.stand(target);
    else {
      this.carry(seenBand, target);
      const end = seenBand[2];
      if (end !== undefined) {
        band = { seen: end.left + end.width, at: target.box.left + target.box.width };
      }
    }
    for (const name of names(line)) {
      const was = seen.names.get(name.handle);
      const opening = name.label.dataset.conversationLabel === "open";
      // Standing open already, it has nowhere to go.
      if (opening && was?.open === true) continue;
      const place = places.get(name.handle);
      if (place === undefined) {
        if (!opening) this.folded(name.handle);
        continue;
      }
      const next = [...places.values()]
        .filter((other) => other.at > place.at + 0.5)
        .sort((left, right) => left.at - right.at)[0];
      moveName({
        name,
        opening,
        seen: was,
        place,
        next,
        band,
        done: () => this.folded(name.handle),
      });
    }
  }

  /**
   * The same switch under reduced motion: nothing travels. The seats stand
   * where they now stand at once, so the name left goes with its place; the
   * band fades out where it stood as it fades in where it stands, and the
   * name opened fades in.
   */
  private crossfade(line: HTMLElement, seen: LineSeen): void {
    this.setMoving();
    for (const { node } of movers(line)) stop(node);
    const band = this.band.current;
    if (band !== null && seen.band !== null) {
      // A still picture of the band where it stood, over the ground it fades into.
      const ghost = band.cloneNode(true) as HTMLElement;
      ghost.setAttribute("data-conversation-band-ghost", "");
      [...ghost.children].forEach((piece, index) => {
        const box = seen.band?.[index];
        if (!(piece instanceof HTMLElement) || box === undefined) return;
        stop(piece);
        piece.style.transform = "none";
        piece.style.left = `${box.left}px`;
        piece.style.top = `${box.top}px`;
        piece.style.width = `${box.width}px`;
        piece.style.height = `${box.height}px`;
      });
      band.before(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { ...CROSSFADE, fill: "forwards" }).onfinish =
        () => ghost.remove();
    }
    this.stand(this.target(line, line.getBoundingClientRect()));
    band?.animate([{ opacity: 0 }, { opacity: 1 }], CROSSFADE);
    for (const name of names(line)) {
      for (const element of [name.label, name.window, name.words, name.chevron]) stop(element);
      if (name.label.dataset.conversationLabel !== "open") {
        name.label.style.opacity = "0";
        this.folded(name.handle);
        continue;
      }
      name.label.style.removeProperty("width");
      const was = seen.names.get(name.handle);
      if (was?.open !== true) {
        name.label.animate([{ opacity: was?.opacity ?? 0 }, { opacity: 1 }], CROSSFADE);
      }
    }
  }

  /**
   * A draw that switched nothing — the crew's room measured again, a face
   * changing state: a seat still sliding whose place moved turns toward the
   * new place from where it is, and so does the band; at rest, both follow
   * a reflow at once.
   */
  private follow(line: HTMLElement, seen: LineSeen): void {
    const origin = line.getBoundingClientRect();
    for (const { key, node } of movers(line)) {
      const was = seen.seats.get(key);
      if (was === undefined || node.getAnimations().length === 0) continue;
      const flowLeft = boxOf(node, origin).left - shiftOf(node);
      if (Math.abs(flowLeft - was.flowLeft) >= 0.5) {
        this.setMoving();
        slide(node, was.drawn.left, origin);
      }
    }
    const target = this.target(line, origin);
    if (sameTarget(target, this.bandAt)) return;
    const pieces = [...(this.band.current?.children ?? [])];
    const travelling = pieces.some((piece) => piece.getAnimations().length > 0);
    if (travelling && target !== null && seen.band !== null) this.carry(seen.band, target);
    else this.stand(target);
  }

  private folded(handle: string): void {
    if (this.live) this.props.onFolded(handle);
  }
}
