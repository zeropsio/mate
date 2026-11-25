import { mateTintStyle } from "../mateTint";
import type { LineBead } from "./projectLine.logic";

/**
 * A bead: a change in its Mate's colour, a 12 px square cut out of the track by a ring of the
 * ground. `waits` rings it blue (on the viewer's review), `stuck` amber (its Mate's to fix), `work`
 * is a dashed outline (not a change yet). Ledger rows under the line draw the same bead; `className`
 * places it.
 */
export function BeadMark({
  mark,
  tint,
  className,
}: {
  readonly mark: LineBead["mark"];
  readonly tint: LineBead["tint"];
  readonly className?: string | undefined;
}) {
  return (
    <i
      aria-hidden="true"
      className={`${BEAD[mark ?? "plain"]} ${className ?? ""}`}
      style={tint === undefined ? undefined : mateTintStyle(tint)}
    />
  );
}

const BEAD: Record<NonNullable<LineBead["mark"]> | "plain", string> = {
  plain:
    "relative block box-border size-3 rounded-mark bg-(--mate-tint,var(--ln-track)) ring-2 ring-(--ln-ground)",
  waits:
    "relative block box-border size-3 rounded-mark bg-(--mate-tint,var(--ln-track)) ring-2 ring-info ring-offset-2 ring-offset-(--ln-ground)",
  stuck:
    "relative block box-border size-3 rounded-mark bg-(--mate-tint,var(--ln-track)) ring-2 ring-warning ring-offset-2 ring-offset-(--ln-ground)",
  // Work that is no change yet: hollow, a faint fill of the ink on the ground, its edge dashed.
  work: "relative block box-border size-3 rounded-mark border border-dashed border-(--mate-tint,var(--ln-track)) bg-(--ln-ground) bg-linear-to-r from-foreground/5 to-foreground/5 ring-2 ring-(--ln-ground)",
};
