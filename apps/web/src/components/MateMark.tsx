import {
  MATE_MARK,
  MATE_MARK_LIDS,
  MATE_MARK_LIVE,
  type MateMarkState,
  type MateTintId,
} from "@t3tools/shared/brand";
import { useEffect, useId, useRef, type CSSProperties } from "react";

import { cn } from "~/lib/utils";
import "./MateMark.css";
import { registerLiveMark, type LiveMarkParts } from "./mateMarkRuntime";

/**
 * Brand presence only. It deliberately does not imply that a provider is
 * online or working.
 *
 * `live` renders identity v1's animated mark: the band retracts as it wakes,
 * the eyes open behind it, the slab turns toward the pointer with its extruded
 * side wall showing, and it blinks. Without it the same geometry renders as
 * the still open mark — which is what the sidebar and the favicon want, and
 * what everyone gets under `prefers-reduced-motion`.
 */
/** The mark in a Mate's colour instead of the brand's: the slab, and the band and side wall of the live one. */
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

export function MateMark({
  className,
  playful = false,
  state,
  tint,
}: {
  className?: string;
  /** Renders the live mark rather than the still one. */
  playful?: boolean;
  /** Drives the face directly; otherwise it idles, blinks and reacts to hover. */
  state?: MateMarkState;
  /**
   * A Mate's colour for the mark, where the mark stands for one Mate rather
   * than for the product — an empty conversation, a draft's headline. Absent,
   * the mark is the brand's teal.
   */
  tint?: MateTintId | undefined;
}) {
  const clipId = useId();
  const loopId = `${clipId}-loop`;
  const parts = useRef<LiveMarkParts>({});

  useEffect(() => {
    if (!playful) return;
    const root = parts.current.svg;
    if (!root) return;
    return registerLiveMark(root, parts.current, state);
  }, [playful, state]);

  const [eyeLeft, eyeRight] = MATE_MARK_LIVE.eyeCentres;
  const eyeW = MATE_MARK.eyeWidth;
  const eyeH = MATE_MARK.eyeHeight;

  return (
    <svg
      aria-hidden="true"
      className={cn("mate-mark", className)}
      data-mate-mark={playful ? "live" : "still"}
      data-mate-mark-tint={tint}
      style={
        tint === undefined
          ? undefined
          : ({ "--zerops-mate-mark-side": `var(--zerops-mate-tint-${tint})` } as CSSProperties)
      }
      ref={(node) => {
        parts.current.svg = node;
      }}
      viewBox={MATE_MARK.viewBox}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={MATE_MARK.silhouette} />
        </clipPath>
        <g id={loopId}>
          {MATE_MARK.paths.map((d) => (
            <path d={d} key={d} />
          ))}
        </g>
      </defs>

      <g
        ref={(node) => {
          parts.current.bob = node;
        }}
      >
        {/* The extruded side wall. Hidden at rest; it fades in only as the
              slab turns, so a mark sitting still is flat by construction. */}
        {playful ? (
          <g
            className="mate-mark-sides"
            opacity="0"
            ref={(node) => {
              parts.current.sides = node;
            }}
          >
            {Array.from({ length: EXTRUSION_LAYERS }, (_, layer) => (
              <use href={`#${loopId}`} key={layer} />
            ))}
          </g>
        ) : null}

        <g className={tint === undefined ? undefined : TINT_CLASS[tint]} fill={MATE_MARK.color}>
          {MATE_MARK.paths.map((d) => (
            <path d={d} key={d} />
          ))}
        </g>

        {/* The band, clipped to the silhouette so its halves disappear into
              the walls rather than sliding out past them. A still mark has no
              band: it is the open face, and the retraction never happens. */}
        {playful ? (
          <g
            clipPath={`url(#${clipId})`}
            ref={(node) => {
              parts.current.band = node;
            }}
          >
            <path
              className={tint === undefined ? undefined : TINT_CLASS[tint]}
              d={MATE_MARK_LIVE.band.left}
              fill={MATE_MARK.color}
              ref={(node) => {
                parts.current.bandLeft = node;
              }}
            />
            <path
              className={tint === undefined ? undefined : TINT_CLASS[tint]}
              d={MATE_MARK_LIVE.band.right}
              fill={MATE_MARK.color}
              ref={(node) => {
                parts.current.bandRight = node;
              }}
            />
          </g>
        ) : null}

        {/* Hidden until the band clears them. A live mark starts closed — as
              the plain Zerops logo — and opens, so before the driver's first
              frame (and if its script never runs) it reads as the logo rather
              than as eyes painted over a band that is still in the way. */}
        <g
          className="mate-mark-eyes"
          fill="currentColor"
          ref={(node) => {
            parts.current.eyes = node;
          }}
          visibility={playful ? "hidden" : "visible"}
        >
          <rect
            height={eyeH}
            ref={(node) => {
              parts.current.eyeLeft = node;
            }}
            rx={eyeW / 2}
            width={eyeW}
            x={eyeLeft - eyeW / 2}
            y={MATE_MARK_LIVE.eyeCentreY - eyeH / 2}
          />
          <rect
            height={eyeH}
            ref={(node) => {
              parts.current.eyeRight = node;
            }}
            rx={eyeW / 2}
            width={eyeW}
            x={eyeRight - eyeW / 2}
            y={MATE_MARK_LIVE.eyeCentreY - eyeH / 2}
          />
          {/* The happy eyes: arcs that replace the rectangles on `done`. */}
          {playful ? (
            <>
              <path
                d={HAPPY_ARC}
                fill="none"
                ref={(node) => {
                  parts.current.happyLeft = node;
                }}
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth={MATE_MARK_LIVE.mouth.strokeWidth}
                visibility="hidden"
              />
              <path
                d={HAPPY_ARC}
                fill="none"
                ref={(node) => {
                  parts.current.happyRight = node;
                }}
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth={MATE_MARK_LIVE.mouth.strokeWidth}
                visibility="hidden"
              />
            </>
          ) : null}
        </g>

        {/* The mouth is an event, not a resting feature, so a still mark
              never carries one. */}
        {playful ? (
          <g
            ref={(node) => {
              parts.current.mouth = node;
            }}
            visibility="hidden"
          >
            <circle
              cx="0"
              cy="0"
              fill="none"
              r={MATE_MARK_LIVE.mouth.r}
              ref={(node) => {
                parts.current.mouthO = node;
              }}
              stroke="currentColor"
              strokeWidth={MATE_MARK_LIVE.mouth.strokeWidth}
            />
            <path
              d={SMILE}
              fill="none"
              ref={(node) => {
                parts.current.mouthSmile = node;
              }}
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth={MATE_MARK_LIVE.mouth.strokeWidth}
              visibility="hidden"
            />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

/** Enough layers that the extruded wall reads as solid at the 5° cap. */
const EXTRUSION_LAYERS = 12;

const U = MATE_MARK_LIVE.eyeUnit;
const HAPPY_ARC = `M${-U / 2},0 Q0,${-0.85 * U} ${U / 2},0`;
const SMILE = `M${-0.75 * U},${-0.05 * U} Q0,${1.22 * U} ${0.75 * U},${-0.05 * U}`;

export { MATE_MARK_LIDS };
