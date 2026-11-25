import type { CSSProperties } from "react";

import type { MateTintId } from "@t3tools/shared/brand";

import { cn } from "~/lib/utils";

/** One meaning per colour (S3): amber needs you, blue finished and unseen (the blue of what
    clicks), red broken, the Mate's own tint at work. */
const TONE = {
  attention: "bg-status-attention",
  unread: "bg-info-foreground",
  failed: "bg-status-failed",
  working: "bg-mate-dot",
} as const;

/** Where it hangs; `corner` is ringed in `--menu-ground`, the ground its face is cut in. */
const PLACE = {
  before: "absolute top-1/2 right-[calc(100%+5px)] -mt-0.75",
  corner: "absolute -top-0.5 -right-0.5 z-6 size-2.25 ring-2 ring-(--menu-ground)",
  inline: "inline-block",
} as const;

/**
 * A Mate's state as one dot, the same wherever a Mate is drawn: amber waits on you, blue an
 * unseen result, red stopped on an error, its own tint at work.
 *
 * - `before` hangs in the gap before the text it stands in (its parent, positioned): a row's
 *   time, so the dot coming and going moves nothing.
 * - `corner` sits on a face's corner, ringed by the menu's ground: the rail.
 * - `inline` stands in the line: a card's time.
 */
export function MateDot({
  tone,
  place,
  tint,
  surface,
  className,
}: {
  readonly tone: "attention" | "unread" | "failed" | "working";
  readonly place: "before" | "corner" | "inline";
  /** The working tone's hue. */
  readonly tint?: MateTintId | undefined;
  readonly surface?: string | undefined;
  /** Its seat on a face of another size. */
  readonly className?: string | undefined;
}) {
  return (
    <i
      aria-hidden="true"
      className={cn("size-1.5 flex-none rounded-full", TONE[tone], PLACE[place], className)}
      data-zerops-surface={surface}
      style={
        tone === "working" && tint !== undefined
          ? ({ "--mate-tint": `var(--zerops-mate-tint-${tint})` } as CSSProperties)
          : undefined
      }
    />
  );
}
