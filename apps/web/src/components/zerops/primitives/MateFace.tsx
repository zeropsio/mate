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
import { useState, type CSSProperties } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

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
   * Whether it greets an arrival it watches (`mateFaceArrival`): a face that
   * stands for one Mate the whole time it is on screen and knows when its
   * state is read — a menu row, a run's status line. Off by default: a face
   * reused from one Mate to the next (a header) or first drawn asleep
   * until its Mate connects would greet arrivals that never happened.
   */
  readonly greets?: boolean;
  /**
   * Whether the state is the Mate's as read, or a pose standing in until it
   * is: a change from a stand-in is no arrival to greet. Known by default.
   */
  readonly known?: boolean;
};

/**
 * Whether a change of pose is an arrival the face greets: a run done after
 * work or a question, a question raised. Marking a Mate unread (idle to done)
 * is no run finishing, and waking to wait on a question already asked is no
 * question raised.
 */
export function mateFaceArrival(
  previous: MateMarkState,
  next: MateMarkState,
): MateMarkState | undefined {
  if (next === "done") return previous === "working" || previous === "needs" ? "done" : undefined;
  if (next === "needs") return previous === "needs" ? undefined : "needs";
  return undefined;
}

/**
 * The arrival this face last saw while it was on screen, marked until the
 * next change of pose — never on a first paint: a reload, a remount, a list
 * opening onto a waiting Mate shows the state as it is, without the flourish
 * of arriving at it. Nor from a pose that only stood in until the Mate's state
 * was read (`known`): a menu row wears idle or asleep for the second before
 * its socket answers, and a Mate that had waited all along is not arriving.
 */
function useArrived(state: MateMarkState, known: boolean): MateMarkState | undefined {
  const [seen, setSeen] = useState<{
    readonly state: MateMarkState;
    readonly known: boolean;
    readonly arrived: MateMarkState | undefined;
  }>({ state, known, arrived: undefined });
  if (seen.state === state && seen.known === known) return seen.arrived;
  const arrived =
    seen.state === state
      ? seen.arrived
      : seen.known && known
        ? mateFaceArrival(seen.state, state)
        : undefined;
  setSeen({ state, known, arrived });
  return arrived;
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
 * time and the eyes glance about; starting to need you, it hops three times;
 * done while you watch, it pops once; waking, on its way up, it breathes over
 * asleep's closed eyes (`matePose`). Idle and asleep it is still, and with
 * reduced motion only the morph remains. Decorative on its own — the name and the state are always
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
  style,
  ...props
}: MateFaceProps) {
  const parts = mateFaceParts(state);
  const arrived = useArrived(state, greets && known);
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
      data-mate-face-arrived={arrived}
      data-mate-face-gaze={gaze}
      data-mate-face-shape={shapeId}
      data-mate-face-size={size}
      data-mate-face-state={state}
      data-mate-face-tint={tint}
      data-zerops-primitive="mate-face"
      style={faceStyle}
    >
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
                    data-mate-face-eye=""
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
  );
}

export { MateFace };
export type { MateFaceGaze, MateFaceProps, MateFaceSize };
