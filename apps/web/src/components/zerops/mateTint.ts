import type { MateTintId } from "@t3tools/shared/brand";
import type { CSSProperties } from "react";

/**
 * A Mate's own hue where it is drawn (`--mate-tint`): what it says wears it through the theme's
 * `mate-*` colours (its words' ink, its message's wash and edge, its mention chip, its dot at
 * work), each mixed so it holds its contrast in light and dark.
 */
export function mateTintStyle(tint: MateTintId): CSSProperties {
  return { "--mate-tint": `var(--zerops-mate-tint-${tint})` } as CSSProperties;
}
