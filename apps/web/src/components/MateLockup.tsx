import { MATE_LOCKUP, MATE_MARK, MATE_WORDMARK } from "@t3tools/shared/brand";

import { cn } from "~/lib/utils";
import "./MateMark.css";

/**
 * Identity v1's lockup: the still mark and the "mate" wordmark, one SVG.
 *
 * Sized by height like the bare mark (`h-6 w-auto`), and the mark inside it
 * is the same size a bare `MateMark` would be at that height. The wordmark is
 * outlined geometry from `@t3tools/shared/brand`, so it needs no webfont and
 * cannot flash or reflow. Eyes and letters take the current text colour, the
 * way the mark's eyes do: ink on paper, paper on dark.
 *
 * Below a 24 px mark the identity says to use the mark alone; a caller that
 * small wants `MateMark`, not this.
 */
export function MateLockup({
  className,
  decorative = false,
  label = "Zerops Mate",
}: {
  className?: string;
  /**
   * Inside a link that already names itself, the lockup is decoration: hidden
   * from assistive technology so the name is announced once, not twice.
   */
  decorative?: boolean;
  /** What the lockup reads as; the default is the product's name. */
  label?: string;
}) {
  return (
    <svg
      {...(decorative ? { "aria-hidden": true } : { "aria-label": label, role: "img" })}
      className={cn("mate-lockup", className)}
      data-mate-lockup="still"
      viewBox={MATE_LOCKUP.viewBox}
    >
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
        {MATE_WORDMARK.paths.map((d) => (
          <path d={d} key={d} />
        ))}
      </g>
    </svg>
  );
}
