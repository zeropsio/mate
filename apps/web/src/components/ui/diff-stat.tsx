"use client";

import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/** A count past a thousand, cut to its first figures: 1.2k, 34k, 5m. */
function compactCount(value: number): string {
  const steps = [
    [1_000_000_000, "b"],
    [1_000_000, "m"],
    [1000, "k"],
  ] as const;
  for (const [step, suffix] of steps) {
    if (value >= step) {
      const scaled = value / step;
      return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, "") : Math.round(scaled)}${suffix}`;
    }
  }
  return String(value);
}

/**
 * How much a change changed: `+12 −3`, the added lines in the addition ink, the removed in the
 * deletion ink, with a true minus sign, in figures of even width, in the step of the words around
 * it. A side at zero is left out; a change of nothing says nothing. `compact` cuts large counts
 * (1.2k) where room is short (a menu row). `aligned` sets the two counts in columns of their own,
 * for a list whose counts read down one edge.
 */
function DiffStat({
  additions,
  deletions,
  compact = false,
  aligned = false,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  readonly additions: number;
  readonly deletions: number;
  readonly compact?: boolean;
  readonly aligned?: boolean;
}) {
  if (additions === 0 && deletions === 0 && !aligned) return null;
  const shown = (value: number) => (compact ? compactCount(value) : String(value));
  return (
    <span
      aria-label={`${additions} added, ${deletions} removed`}
      className={cn(
        "whitespace-nowrap tabular-nums",
        aligned ? "inline-grid grid-cols-[4ch_4ch] gap-2 text-end" : "inline-flex gap-1",
        className,
      )}
      data-slot="diff-stat"
      role="group"
      {...props}
    >
      {additions > 0 || aligned ? (
        <span aria-hidden="true" className="text-diff-addition-foreground">
          {additions > 0 ? `+${shown(additions)}` : null}
        </span>
      ) : null}
      {deletions > 0 || aligned ? (
        <span aria-hidden="true" className="text-diff-deletion-foreground">
          {deletions > 0 ? `−${shown(deletions)}` : null}
        </span>
      ) : null}
    </span>
  );
}

export { DiffStat };
