import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/**
 * The one dot: a state said as a colour, with no words of its own. It stands before a line it
 * marks (a plan's step, a background job, a process), on a corner of the thing it marks (an icon
 * with something new, a tab with unsaved changes), or inside `Badge`'s dot form before its words.
 * The tones are `Badge`'s, with the same meanings; `current` takes the ink of what it marks, for a
 * mark whose place already says what it means (a file's unsaved changes). `sm` is 6 px, for a
 * dense line and a corner; `md` is 8 px, before words. A dot that pulses marks work running now.
 * A corner dot is cut out of the ground it sits on by a 2 px ring in `--mark-ground` (the page's
 * ground unless a parent sets it), so it never melts into the icon under it.
 */
const dotVariants = cva("inline-flex shrink-0 rounded-full", {
  defaultVariants: { size: "md" },
  variants: {
    size: {
      sm: "size-1.5",
      md: "size-2",
    },
    corner: {
      none: "",
      "top-end": "absolute",
      "top-start": "absolute",
      "bottom-end": "absolute",
    },
  },
  compoundVariants: [
    { size: "sm", corner: "top-end", className: "-end-0.75 -top-0.75" },
    { size: "sm", corner: "top-start", className: "-start-0.75 -top-0.75" },
    { size: "sm", corner: "bottom-end", className: "-end-0.75 -bottom-0.75" },
    { size: "md", corner: "top-end", className: "-end-1 -top-1" },
    { size: "md", corner: "top-start", className: "-start-1 -top-1" },
    { size: "md", corner: "bottom-end", className: "-end-1 -bottom-1" },
  ],
});

const FILL = {
  neutral: "bg-status-off",
  info: "bg-status-busy",
  success: "bg-status-ok",
  warning: "bg-status-attention",
  danger: "bg-status-failed",
  current: "bg-current",
} as const;

/** The hollow dot: the tone's ring only, for a place that holds nothing yet or rests on purpose. */
const RING = {
  neutral: "ring-[1.5px] ring-status-off ring-inset",
  info: "ring-[1.5px] ring-status-busy ring-inset",
  success: "ring-[1.5px] ring-status-ok ring-inset",
  warning: "ring-[1.5px] ring-status-attention ring-inset",
  danger: "ring-[1.5px] ring-status-failed ring-inset",
  current: "ring-[1.5px] ring-current ring-inset",
} as const;

/** The cut a corner dot makes in the ground under it. */
const CUT = "ring-2 ring-(--mark-ground,var(--color-background))";

type DotTone = keyof typeof FILL;
type DotCorner = "top-end" | "top-start" | "bottom-end";

type DotProps = Omit<ComponentProps<"span">, "children"> & {
  readonly tone?: DotTone;
  /** `sm` 6 px: a dense line, a corner. `md` 8 px: before words. */
  readonly size?: "sm" | "md";
  /** It breathes while the work it marks runs. */
  readonly pulse?: boolean;
  /** Only its accessible name says what it means; without one it is decoration beside words. */
  readonly "aria-label"?: string;
} & (
    | {
        /** Which corner of its positioned parent it sits on, cut out of `--mark-ground`. */
        readonly corner?: DotCorner;
        readonly hollow?: false;
      }
    | {
        readonly corner?: never;
        /** Only the tone's ring: nothing there yet, or at rest on purpose. */
        readonly hollow: true;
      }
  );

function Dot({
  className,
  tone = "neutral",
  size = "md",
  pulse = false,
  hollow = false,
  corner,
  ...props
}: DotProps) {
  const labelled = props["aria-label"] !== undefined;
  const breathes = pulse && !hollow;
  return (
    <span
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      {...props}
      className={cn(
        dotVariants({ size, corner: corner ?? "none" }),
        hollow ? RING[tone] : FILL[tone],
        corner !== undefined && CUT,
        breathes && "animate-status-pulse motion-reduce:animate-none",
        className,
      )}
      data-pulse={breathes ? "" : undefined}
      data-slot="dot"
      data-tone={tone}
    />
  );
}

export { Dot, type DotCorner, type DotTone };
