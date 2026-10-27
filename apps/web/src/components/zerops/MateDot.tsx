import type { CSSProperties } from "react";

import type { MateTintId } from "@t3tools/shared/brand";

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
}: {
  readonly tone: "attention" | "unread" | "failed" | "working";
  readonly place: "before" | "corner" | "inline";
  /** The working tone's hue. */
  readonly tint?: MateTintId | undefined;
  readonly surface?: string | undefined;
}) {
  return (
    <i
      aria-hidden="true"
      className="menu-dot"
      data-place={place}
      data-dot={tone}
      data-zerops-surface={surface}
      style={
        tone === "working" && tint !== undefined
          ? ({ "--menu-dot-tint": `var(--zerops-mate-tint-${tint})` } as CSSProperties)
          : undefined
      }
    />
  );
}
