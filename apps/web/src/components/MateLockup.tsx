import { MATE_LOCKUP, MATE_MARK, MATE_WORDMARK } from "@t3tools/shared/brand";

import { cn } from "~/lib/utils";
import { MateMark } from "./MateMark";
import "./MateMark.css";

/**
 * Identity v1's lockup: the mark and the "mate" wordmark in one box.
 *
 * Sized by height like the bare mark (`h-6 w-auto`), and the mark inside it
 * is the same size a bare `MateMark` would be at that height. The wordmark is
 * outlined geometry from `@t3tools/shared/brand`, so it needs no webfont and
 * cannot flash or reflow. Eyes and letters take the current text colour, the
 * way the mark's eyes do: ink on paper, paper on dark.
 *
 * The box is drawn as two SVGs side by side — the mark's and the word's, which
 * meet at the mark's right edge (`MATE_LOCKUP.word.viewBox` carries the gap) —
 * so that `live` can hand the mark to `MateMark`: it looks about, blinks and
 * turns on its own root, and the letters hold still beside it. Still, the
 * pair is the one `MATE_LOCKUP` box to the pixel.
 *
 * Below a 24 px mark the identity says to use the mark alone; a caller that
 * small wants `MateMark`, not this.
 */
export function MateLockup({
  className,
  decorative = false,
  label = "Zerops Mate",
  live = false,
}: {
  className?: string;
  /**
   * Inside a link that already names itself, the lockup is decoration: hidden
   * from assistive technology so the name is announced once, not twice.
   */
  decorative?: boolean;
  /** What the lockup reads as; the default is the product's name. */
  label?: string;
  /** The live mark — the one that looks at you — rather than the still one. */
  live?: boolean;
}) {
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { "aria-label": label, role: "img" })}
      className={cn("mate-lockup", className)}
      data-mate-lockup={live ? "live" : "still"}
    >
      {live ? (
        <MateMark playful />
      ) : (
        <svg aria-hidden="true" data-mate-lockup-part="mark" viewBox={MATE_MARK.viewBox}>
          <g fill={MATE_MARK.color}>
            {MATE_MARK.paths.map((d) => (
              <path d={d} key={d} />
            ))}
          </g>
          <g fill="currentColor">
            {MATE_MARK.eyeXs.map((x) => (
              <rect
                height={MATE_MARK.eyeHeight}
                key={x}
                rx={MATE_MARK.eyeWidth / 2}
                width={MATE_MARK.eyeWidth}
                x={x}
                y={MATE_MARK.eyeY}
              />
            ))}
          </g>
        </svg>
      )}
      <svg aria-hidden="true" data-mate-lockup-part="word" viewBox={MATE_LOCKUP.word.viewBox}>
        <g fill="currentColor">
          {MATE_WORDMARK.paths.map((d) => (
            <path d={d} key={d} />
          ))}
        </g>
      </svg>
    </span>
  );
}
