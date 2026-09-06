import {
  MATE_FACE,
  MATE_FACE_STROKES,
  mateFaceParts,
  type MateMarkState,
  type MateTintId,
} from "@t3tools/shared/brand";
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

type MateFaceProps = Omit<React.ComponentProps<"svg">, "children" | "viewBox"> & {
  readonly tint: MateTintId;
  readonly state: MateMarkState;
  readonly size?: MateFaceSize;
};

/**
 * A Mate's face: its eyes on a disc of its colour, wearing the state the live
 * mark would — open when idle, narrowed and dropped when working, wide with
 * an "o" when it needs you, happy when done, shut when asleep. Still, by
 * design: what moves is the state, never the face. Decorative on its own —
 * the name and the state are always written beside it — so it carries no
 * accessible name.
 */
function MateFace({ className, size = "md", state, tint, ...props }: MateFaceProps) {
  const parts = mateFaceParts(state);
  const strokeWidth = STROKE_PX[size];
  return (
    <svg
      {...props}
      aria-hidden="true"
      className={cn("shrink-0", SIZE_CLASS[size], className)}
      data-mate-face-size={size}
      data-mate-face-state={state}
      data-mate-face-tint={tint}
      data-zerops-primitive="mate-face"
      viewBox={MATE_FACE.viewBox}
    >
      <circle className={TINT_CLASS[tint]} cx="50" cy="50" r={MATE_FACE.radius} />
      <g className="fill-[var(--zerops-mate-face-ink)]">
        {parts.eyes.map((eye) =>
          eye.height < SHUT_EYE_HEIGHT ? (
            <line
              className="stroke-[var(--zerops-mate-face-ink)]"
              key={eye.x}
              strokeLinecap="round"
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
              x1={eye.x}
              x2={eye.x + eye.width}
              y1={eye.y + eye.height / 2}
              y2={eye.y + eye.height / 2}
            />
          ) : (
            <rect
              height={eye.height}
              key={eye.x}
              rx={eye.rx}
              width={eye.width}
              x={eye.x}
              y={eye.y}
            />
          ),
        )}
      </g>
      <g
        className="stroke-[var(--zerops-mate-face-ink)]"
        fill="none"
        strokeLinecap="round"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      >
        {parts.arcs.map(([x, y]) => (
          <path
            d={MATE_FACE_STROKES.arc}
            key={x}
            transform={`translate(${x},${y})`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {parts.mouth === "o" ? (
          <circle
            cx="50"
            cy={MATE_FACE.mouth.y}
            r={MATE_FACE.mouth.r}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {parts.mouth === "smile" ? (
          <path
            d={MATE_FACE_STROKES.smile}
            transform={`translate(50,${MATE_FACE.mouth.y})`}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </g>
    </svg>
  );
}

export { MateFace };
export type { MateFaceProps, MateFaceSize };
