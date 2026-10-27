/**
 * A large Mate face following the person with its eyes (`MateFace` `tracks`): where the eyes
 * look for a pointer, and the one controller that listens for it — only while the face is on
 * screen, at most once a frame, with one cached rectangle. Nothing here is timed: the eyes
 * move when the pointer does, ease by the stylesheet's transition, and blink after the pointer
 * has travelled a while.
 */

/** How far the eyes travel from centre, in the face's own percent (its 100-box). */
export const MATE_GAZE_REACH = { x: 6, y: 4 } as const;

/** How much pointer travel, in CSS px, earns one blink. */
export const MATE_GAZE_BLINK_TRAVEL = 2_400;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the eyes look for a pointer at `pointer`, as an offset in the face's percent: toward
 * the pointer, easing out with distance (a pointer across the page looks as far as one just past
 * the face's edge would, never further than the eye area allows).
 */
export function gazeOffset(face: Rect, pointer: Point): Point {
  const cx = face.left + face.width / 2;
  const cy = face.top + face.height / 2;
  const dx = pointer.x - cx;
  const dy = pointer.y - cy;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: 0, y: 0 };
  // Full reach about two faces away; closer, it looks less far.
  const reach = Math.tanh(distance / (face.width * 2));
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    x: round((dx / distance) * reach * MATE_GAZE_REACH.x),
    y: round((dy / distance) * reach * MATE_GAZE_REACH.y),
  };
}

/** What the tracker needs from the page: injected, so it can be driven without a browser. */
export interface GazeHost {
  readonly reducedMotion: () => boolean;
  readonly observeVisible: (element: Element, onChange: (visible: boolean) => void) => () => void;
  readonly listen: (
    type: "pointermove" | "pointerdown" | "pointerout" | "resize" | "scroll",
    handler: (event: {
      clientX?: number;
      clientY?: number;
      pointerType?: string;
      relatedTarget?: unknown;
    }) => void,
  ) => () => void;
  readonly nextFrame: (run: () => void) => () => void;
  readonly measure: (element: Element) => Rect;
}

/** Where the tracker writes: the face's look, a blink, a tap's glance that eases back. */
export interface GazeSink {
  readonly look: (offset: Point) => void;
  readonly blink: () => void;
  readonly tap: (offset: Point) => void;
}

/**
 * Follows the pointer for one face. Listens only while the face is visible and motion is
 * welcome; reads the face's rectangle once per resize or scroll; writes at most once a frame.
 * Returns its stop.
 */
export function trackGaze(element: Element, host: GazeHost, sink: GazeSink): () => void {
  if (host.reducedMotion()) return () => {};
  let rect: Rect | null = null;
  let pointer: Point | null = null;
  let last: Point | null = null;
  let travelled = 0;
  let cancelFrame: (() => void) | null = null;
  let unlisten: Array<() => void> = [];

  const frame = () => {
    cancelFrame = null;
    if (pointer === null) return;
    rect ??= host.measure(element);
    sink.look(gazeOffset(rect, pointer));
  };
  const schedule = () => {
    cancelFrame ??= host.nextFrame(frame);
  };
  const stopListening = () => {
    for (const off of unlisten) off();
    unlisten = [];
    cancelFrame?.();
    cancelFrame = null;
  };
  const startListening = () => {
    rect = null;
    unlisten = [
      host.listen("pointermove", (event) => {
        if (event.pointerType === "touch" || event.clientX === undefined) return;
        const at = { x: event.clientX, y: event.clientY ?? 0 };
        if (last !== null) travelled += Math.hypot(at.x - last.x, at.y - last.y);
        last = at;
        pointer = at;
        if (travelled >= MATE_GAZE_BLINK_TRAVEL) {
          travelled = 0;
          sink.blink();
        }
        schedule();
      }),
      host.listen("pointerdown", (event) => {
        if (event.pointerType !== "touch" || event.clientX === undefined) return;
        rect ??= host.measure(element);
        sink.tap(gazeOffset(rect, { x: event.clientX, y: event.clientY ?? 0 }));
      }),
      // The pointer leaving the window: the eyes drift back to centre.
      host.listen("pointerout", (event) => {
        if (event.relatedTarget !== null && event.relatedTarget !== undefined) return;
        pointer = null;
        last = null;
        sink.look({ x: 0, y: 0 });
      }),
      host.listen("resize", () => {
        rect = null;
      }),
      host.listen("scroll", () => {
        rect = null;
      }),
    ];
  };
  const unobserve = host.observeVisible(element, (visible) => {
    stopListening();
    if (visible) startListening();
  });
  return () => {
    unobserve();
    stopListening();
  };
}
