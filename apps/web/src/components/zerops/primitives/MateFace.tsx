import {
  MATE_FACE,
  MATE_FACE_STROKES,
  MATE_SHAPE_OF_TINT,
  MATE_SHAPES,
  MATE_TINT_IDS,
  mateFaceParts,
  type MateMarkState,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import { useEffect, useRef, useState, type AnimationEvent, type CSSProperties } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { trackGaze, type GazeHost } from "./mateFaceGaze.logic";
import {
  cueMoments,
  endMoment,
  mateFaceArrival,
  startMoments,
  type MateFaceCue,
  type MateMoment,
  type MateMomentPlayer,
} from "./mateFaceMoment.logic";

type MateFaceSize = "dot" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<MateFaceSize, string> = {
  /** In a menu row, where a status dot would be. */
  dot: "size-3.5",
  /** Beside a name in a row of text. */
  sm: "size-5",
  /** The card's avatar, beside a 14 px name. */
  md: "size-7",
  /** Alone on a page, where there is no card yet to sit in. */
  lg: "size-12",
};

/** Strokes stay legible at every size: they are set in pixels, not in the box. */
const STROKE_PX: Record<MateFaceSize, number> = { dot: 1.25, sm: 1.5, md: 1.75, lg: 2.5 };

const TINT_CLASS: Record<MateTintId, string> = {
  coral: "fill-[var(--zerops-mate-tint-coral)]",
  amber: "fill-[var(--zerops-mate-tint-amber)]",
  olive: "fill-[var(--zerops-mate-tint-olive)]",
  sky: "fill-[var(--zerops-mate-tint-sky)]",
  violet: "fill-[var(--zerops-mate-tint-violet)]",
  rose: "fill-[var(--zerops-mate-tint-rose)]",
  sand: "fill-[var(--zerops-mate-tint-sand)]",
  slate: "fill-[var(--zerops-mate-tint-slate)]",
};

/** Below this an eye is shut, and a shut eye is a hairline, not a sliver of a pill. */
const SHUT_EYE_HEIGHT = 0.3 * MATE_FACE.eyeUnit;

/**
 * Where a Mate's eyes go beyond its state: up and aside while it thinks,
 * down along the line while it writes. Only the run's status line knows which
 * of the two it is doing; everywhere else a working Mate simply works.
 */
type MateFaceGaze = "up" | "down";

type MateFaceProps = Omit<React.ComponentProps<"span">, "children"> & {
  readonly tint: MateTintId;
  /** The silhouette its Mate chose (HQ's record); the tint's own (`MATE_SHAPE_OF_TINT`) when absent. */
  readonly shape?: MateShapeId | undefined;
  readonly state: MateMarkState;
  readonly size?: MateFaceSize;
  readonly gaze?: MateFaceGaze | undefined;
  /**
   * Whether it greets the changes of pose it watches (`mateFaceArrival`): a face that
   * stands for one Mate the whole time it is on screen and knows when its
   * state is read — a menu row, a run's status line. Off by default: a face
   * reused from one Mate to the next (a header) or first drawn asleep
   * until its Mate connects would greet arrivals that never happened.
   */
  readonly greets?: boolean | "detail";
  /**
   * Whether the state is the Mate's as read, or a pose standing in until it
   * is: a change from a stand-in is no arrival to greet, and plays nothing. Known by default.
   */
  readonly known?: boolean;
  /**
   * The facts its caller greets with a moment (`MateFaceCue`), first the one that wins when two
   * become true at once; any of them outranks a change of pose `greets` reads.
   */
  readonly cues?: ReadonlyArray<MateFaceCue> | undefined;
  /**
   * Its Mate's container is restarting: for as long as it lasts, it switches off like an old TV
   * and boots again, calmly, in a slow loop. With reduced motion, the still state.
   */
  readonly restarting?: boolean | undefined;
  /** One completed restart loop, for the words alongside it. Never a readiness signal. */
  readonly onRestartCycle?: (() => void) | undefined;
  /**
   * It works on something it was asked to stand up: it paces back and forth, as far either way
   * as its caller's `--mate-face-pace` says. With reduced motion, the still state.
   */
  readonly paces?: boolean | undefined;
  /** A large face alone on its page: its eyes follow the person's pointer (`trackGaze`). */
  readonly tracks?: boolean | undefined;
};

const NO_CUES: ReadonlyArray<MateFaceCue> = [];

/** Reduced motion, or nowhere to ask: a moment plays only where motion is known to be welcome. */
function prefersStill(): boolean {
  return (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The page, as the gaze tracker reads it. */
const BROWSER_GAZE: GazeHost = {
  reducedMotion: prefersStill,
  observeVisible: (element, onChange) => {
    if (typeof IntersectionObserver === "undefined") return () => {};
    const observer = new IntersectionObserver((entries) =>
      onChange(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  },
  listen: (type, handler) => {
    const target = type === "resize" || type === "scroll" ? window : document;
    const options = { passive: true, capture: type === "scroll" };
    const listener = handler as (event: Event) => void;
    target.addEventListener(type, listener, options);
    return () => target.removeEventListener(type, listener, options);
  },
  nextFrame: (run) => {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  },
  measure: (element) => element.getBoundingClientRect(),
};

/** Follows the pointer with the face's eyes while `tracks`, writing only CSS variables. */
function useGaze(face: React.RefObject<HTMLSpanElement | null>, tracks: boolean): void {
  useEffect(() => {
    const element = face.current;
    if (!tracks || element === null) return;
    const flip = (attribute: string) =>
      element.setAttribute(attribute, element.getAttribute(attribute) === "a" ? "b" : "a");
    return trackGaze(element, BROWSER_GAZE, {
      look: ({ x, y }) => {
        element.style.setProperty("--mate-gaze-x", `${x}%`);
        element.style.setProperty("--mate-gaze-y", `${y}%`);
        element.style.setProperty("--mate-gaze-x-turn", String(x / 2));
      },
      blink: () => flip("data-mate-face-blink"),
      tap: ({ x, y }) => {
        element.style.setProperty("--mate-tap-x", `${x}%`);
        element.style.setProperty("--mate-tap-y", `${y}%`);
        flip("data-mate-face-tap");
      },
    });
  }, [face, tracks]);
}

/**
 * The moment the face plays now, and how many have started: the facts its caller hands it, then
 * the change of pose it watched (`greets`). Only while it is on screen and its state is read
 * (`known`) — never on a first paint, a remount or a re-render, never from a stand-in, never
 * with reduced motion. A moment is never cut short: the next waits for its end.
 */
function useMoment(input: {
  readonly state: MateMarkState;
  readonly known: boolean;
  readonly greets: boolean | "detail";
  readonly cues: ReadonlyArray<MateFaceCue>;
}): { readonly player: MateMomentPlayer; readonly end: (moment: MateMoment) => void } {
  const { state, known, greets, cues } = input;
  const cueKeys = cues.map((cue) => cue.key).join("\n");
  const [seen, setSeen] = useState(() => ({
    state,
    known,
    cueKeys,
    player: startMoments(cues, known && !prefersStill()),
  }));
  const still = prefersStill();
  if (still && seen.player.playing !== undefined) {
    // Reduced motion turned on mid-moment: its animation is gone, and so is the moment.
    setSeen({ ...seen, player: { ...seen.player, playing: undefined, next: undefined } });
  } else if (seen.state !== state || seen.known !== known || seen.cueKeys !== cueKeys) {
    const change =
      greets && seen.known && known && seen.state !== state
        ? mateFaceArrival(seen.state, state)
        : undefined;
    // Nodding off belongs in a detail view; a list keeps its sleeping face still.
    const arrival = change === "nod" && greets !== "detail" ? undefined : change;
    const handed =
      arrival === undefined
        ? cues
        : [...cues, { moment: arrival, key: `${seen.state}>${state}` } satisfies MateFaceCue];
    setSeen({
      state,
      known,
      cueKeys,
      player: cueMoments(seen.player, handed, known && !still),
    });
  }
  const end = (moment: MateMoment) =>
    setSeen((current) =>
      current.player.playing?.moment === moment
        ? { ...current, player: endMoment(current.player) }
        : current,
    );
  return { player: seen.player, end };
}

/**
 * A Mate's face: its eyes on its shape, in its colour — the shape it chose,
 * else its colour's own (`MATE_SHAPE_OF_TINT`) — wearing the state the live mark would — open when idle, narrowed and
 * dropped when working, wide with an "o" when it needs you, happy when done,
 * shut when asleep or waking.
 *
 * Every pose is the same drawing: the eyes, the arcs and the mouth are always
 * there and a state only moves them, so a change of state morphs (the eyes
 * narrowing into work, the "o" opening when it needs you) rather than
 * swapping one picture for another. The motion itself is the stylesheet's
 * (`[data-mate-face-*]` in index.css): at work the shape turns a notch at a
 * time and the eyes glance about; waking, on its way up, it breathes over
 * asleep's closed eyes (`matePose`). Idle and asleep it is still. Events it
 * watches happen get a moment (`MateFaceMoments.css`): a question raised is a
 * jump that lands with a splat, a run done a little dance, falling asleep a
 * nod with a zzz, and whatever its caller cues. With reduced motion the face stays still. Decorative on its own — the name and the state are always
 * written beside it — so it carries no accessible name.
 */
function MateFace({
  className,
  size = "md",
  state,
  tint,
  shape: chosenShape,
  gaze,
  greets = false,
  known = true,
  cues = NO_CUES,
  restarting = false,
  onRestartCycle,
  paces = false,
  tracks = false,
  style,
  ...props
}: MateFaceProps) {
  const root = useRef<HTMLSpanElement>(null);
  useGaze(root, tracks);
  // Restarting, its cycle closes and opens its eyes itself: they are drawn open for it.
  const parts = mateFaceParts(restarting && !prefersStill() ? "idle" : state);
  const { player, end } = useMoment({ state, known, greets, cues });
  const moment = player.playing?.moment;
  // A moment ends where its own box's animation does; every other box's ending is only bubbling
  // past.
  const ended = (event: AnimationEvent<HTMLSpanElement>) => {
    if (moment !== undefined && event.animationName === `mate-moment-${moment}`) end(moment);
  };
  const shapeId = chosenShape ?? MATE_SHAPE_OF_TINT[tint];
  const shape = MATE_SHAPES[shapeId];
  const strokeWidth = STROKE_PX[size];
  const shut = parts.eyes.length > 0 && parts.eyes[0]!.height < SHUT_EYE_HEIGHT;
  // Done has no pills: they close to a slit where they stand, so the eyes
  // open again from the arcs' place when the next run starts.
  const pills =
    parts.eyes.length > 0
      ? parts.eyes
      : mateFaceParts("idle").eyes.map((eye) => ({
          ...eye,
          y: eye.y + eye.height / 2 - SHUT_EYE_HEIGHT / 2,
          height: SHUT_EYE_HEIGHT,
          rx: SHUT_EYE_HEIGHT / 2,
        }));
  const shutY = MATE_FACE.eyeCentreY;
  const faceStyle = {
    "--mate-face-step": `${shape.step}deg`,
    // In the face's own box: its 100-box is the box, so a unit of the drawing is a percent of it.
    "--mate-face-origin": `${shape.origin[0]}% ${shape.origin[1]}%`,
    // Mates at work do not turn in step: each its own beat in the cycle.
    "--mate-face-phase": String(MATE_TINT_IDS.indexOf(tint)),
    ...style,
  } as CSSProperties;
  // Each part that moves on its own is an HTML box over the whole face holding its own drawing
  // in the same 100-box: Chrome composites an animation on an HTML box, never on an SVG element.
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn("relative block shrink-0", SIZE_CLASS[size], className)}
      data-mate-face-gaze={gaze}
      data-mate-face-moment={moment}
      data-mate-face-pacing={paces ? "" : undefined}
      data-mate-face-restarting={restarting ? "" : undefined}
      data-mate-face-tracks={tracks ? "" : undefined}
      data-mate-face-shape={shapeId}
      data-mate-face-size={size}
      data-mate-face-state={state}
      data-mate-face-tint={tint}
      data-zerops-primitive="mate-face"
      onAnimationEnd={ended}
      onAnimationIteration={(event) => {
        if (restarting && !prefersStill() && event.animationName === "mate-face-restart-shake")
          onRestartCycle?.();
      }}
      ref={root}
      style={faceStyle}
    >
      {/* Drawn afresh for every moment that starts, so the same one can play twice running. */}
      <span data-mate-face-moment-box="" key={player.runs}>
        <span data-mate-face-hop="">
          <span data-mate-face-body="">
            <svg data-mate-face-layer="" viewBox={MATE_FACE.viewBox}>
              <path className={TINT_CLASS[tint]} d={shape.d} />
            </svg>
          </span>
          <span data-mate-face-look="">
            <span data-mate-face-glance="">
              <svg data-mate-face-layer="" viewBox={MATE_FACE.viewBox}>
                <g className="fill-[var(--zerops-mate-face-ink)]">
                  {pills.map((eye, index) => (
                    <rect
                      data-mate-face-eye={index === 0 ? "left" : "right"}
                      height={eye.height}
                      key={MATE_FACE.eyeCentres[index]}
                      opacity={parts.eyes.length > 0 && !shut ? 1 : 0}
                      rx={eye.rx}
                      width={eye.width}
                      x={eye.x}
                      y={eye.y}
                    />
                  ))}
                </g>
                <g
                  className="stroke-[var(--zerops-mate-face-ink)]"
                  fill="none"
                  strokeLinecap="round"
                  strokeWidth={strokeWidth}
                >
                  {MATE_FACE.eyeCentres.map((cx) => (
                    <line
                      data-mate-face-shut=""
                      key={cx}
                      opacity={shut ? 1 : 0}
                      vectorEffect="non-scaling-stroke"
                      x1={cx - MATE_FACE.eyeUnit / 2}
                      x2={cx + MATE_FACE.eyeUnit / 2}
                      y1={shutY}
                      y2={shutY}
                    />
                  ))}
                  {MATE_FACE.eyeCentres.map((cx) => (
                    <path
                      d={MATE_FACE_STROKES.arc}
                      data-mate-face-arc=""
                      key={cx}
                      opacity={parts.arcs.length > 0 ? 1 : 0}
                      transform={`translate(${cx},${MATE_FACE.eyeCentreY + 0.05 * MATE_FACE.eyeUnit})`}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              </svg>
            </span>
            <svg data-mate-face-layer="" viewBox={MATE_FACE.viewBox}>
              <g
                className="stroke-[var(--zerops-mate-face-ink)]"
                fill="none"
                strokeLinecap="round"
                strokeWidth={strokeWidth}
              >
                <circle
                  cx="50"
                  cy={MATE_FACE.mouth.y}
                  data-mate-face-mouth="o"
                  opacity={parts.mouth === "o" ? 1 : 0}
                  r={parts.mouth === "o" ? MATE_FACE.mouth.r : 0}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={MATE_FACE_STROKES.smile}
                  data-mate-face-mouth="smile"
                  opacity={parts.mouth === "smile" ? 1 : 0}
                  transform={`translate(50,${MATE_FACE.mouth.y})`}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </svg>
          </span>
        </span>
      </span>
      {moment === "nod" ? (
        <span data-mate-face-zzz="">
          <span>z</span>
          <span>z</span>
          <span>z</span>
        </span>
      ) : null}
    </span>
  );
}

export { MateFace };
export type { MateFaceCue, MateMoment } from "./mateFaceMoment.logic";
export type { MateFaceGaze, MateFaceProps, MateFaceSize };
