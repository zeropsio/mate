import type { CSSProperties } from "react";

import type { MateTintId } from "@t3tools/shared/brand";

import { Dot, type DotTone } from "~/components/ui/dot";
import { cn } from "~/lib/utils";

import { mateTintStyle } from "./mateTint";

/**
 * One meaning per colour, in `Dot`'s tones: amber (`warning`) needs you, red (`danger`) broken.
 * Two take the ink of what they mark (`current`, the ink set in `INK`): at work the Mate's own hue
 * (`--color-mate-dot`, mixed from `--mate-tint`), and an unseen result the blue of what clicks
 * (`info-foreground`). `Dot`'s `info` is the busy blue of work under way, and on the menu's light
 * ground it is 2.4:1, too faint for a 6 px dot; the link blue is 6.1:1.
 */
const TONE = {
  attention: "warning",
  unread: "current",
  failed: "danger",
  working: "current",
} as const satisfies Record<string, DotTone>;

const INK = {
  unread: "text-info-foreground",
  working: "text-mate-dot",
} as const;

type MateDotTone = keyof typeof TONE;

/** The ground a corner dot is cut out of: the menu's (`--menu-ground`) or its row's (`--row-ground`). */
const GROUND = {
  menu: "var(--menu-ground)",
  row: "var(--row-ground)",
} as const;

/**
 * A Mate's state as one dot, the same wherever a Mate is drawn: amber waits on you, blue an
 * unseen result, red stopped on an error, its own tint at work. It is a `Dot`: this only says
 * which tone each state is and where the dot hangs.
 *
 * - `before` hangs in the gap before the text it stands in (its parent, positioned): a row's
 *   time, so the dot coming and going moves nothing. 6 px.
 * - `corner` sits on a face's corner, cut out of the ground the face is drawn on (`ground`): the
 *   rail, the Chief's row. 8 px.
 * - `inline` stands in the line: a card's time. 6 px.
 */
export function MateDot({
  tone,
  place,
  tint,
  ground = "menu",
  surface,
  className,
}: {
  readonly tone: MateDotTone;
  readonly place: "before" | "corner" | "inline";
  /** The working tone's hue. */
  readonly tint?: MateTintId | undefined;
  /** A corner dot's cut: the menu's ground, or the row's it sits in. */
  readonly ground?: keyof typeof GROUND;
  readonly surface?: string | undefined;
  /** Its seat on a face of another size. */
  readonly className?: string | undefined;
}) {
  const style = (place === "corner" ? { "--mark-ground": GROUND[ground] } : undefined) as
    | CSSProperties
    | undefined;
  const dot =
    place === "corner" ? (
      <Dot
        className={cn("z-6", className)}
        corner="top-end"
        data-zerops-surface={surface}
        style={style}
        tone={TONE[tone]}
      />
    ) : (
      <Dot
        className={cn(
          place === "before" && "absolute end-[calc(100%+5px)] top-1/2 -mt-0.75",
          className,
        )}
        data-zerops-surface={surface}
        size="sm"
        tone={TONE[tone]}
      />
    );
  if (tone !== "unread" && tone !== "working") return dot;
  // Its ink, and at work the Mate's hue it is mixed from; the wrapper draws no box, so a placed dot
  // still hangs from its own positioned parent.
  return (
    <span
      className={cn("contents", INK[tone])}
      style={tone === "working" && tint !== undefined ? mateTintStyle(tint) : undefined}
    >
      {dot}
    </span>
  );
}
