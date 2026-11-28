import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Text } from "./text";

/**
 * The categorical series palette, in the order a chart hands it out: the first series takes
 * `series-1`, the next `series-2`, never cycled past eight (a ninth folds into "Other"). Each slot
 * is its own token, stepped per appearance and checked as a set for colour-blind separation, so a
 * chart that names a series by its slot reads the same in light and dark.
 */
const SERIES_COLORS = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
] as const;

/** The series colour for the series at `index`, or `fallback` past the palette's eight. */
function seriesColor(index: number, fallback = "var(--color-muted-foreground)"): string {
  return SERIES_COLORS[index] ?? fallback;
}

/**
 * A series' colour as a small disc: what ties a legend's words, a readout's line or a list row to
 * the marks of its series. `color` is any CSS colour, best a token: `var(--color-series-2)`.
 */
function SeriesSwatch({ color }: { readonly color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      data-slot="series-swatch"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * A chart's or a share bar's key: one `LegendItem` per series, in the marks' order, wrapping as
 * the room runs out. Words stay in the ink of words; the swatch carries the series.
 */
function Legend({ className, children }: { readonly className?: string; children: ReactNode }) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-8 gap-y-2 text-caption", className)}
      data-slot="legend"
    >
      {children}
    </div>
  );
}

/** One series in a legend: its swatch, its name, and its amount when the legend says one. */
function LegendItem({
  color,
  label,
  value,
}: {
  readonly color: string;
  readonly label: ReactNode;
  readonly value?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-slot="legend-item">
      <SeriesSwatch color={color} />
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      {value === undefined ? null : (
        <span className="shrink-0 text-foreground tabular-nums">{value}</span>
      )}
    </span>
  );
}

/**
 * What a chart's tooltip says about the mark under the pointer: the period or the thing it is,
 * then one `ChartReadoutRow` per series. Put it in a `rich` `TooltipPopup` (one tooltip for many
 * marks through `TooltipCreateHandle`), so every chart's hover reads alike.
 */
function ChartReadout({ title, children }: { readonly title?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex min-w-36 flex-col gap-0.5 py-0.5 tabular-nums" data-slot="chart-readout">
      {title === undefined ? null : <span className="font-medium text-foreground">{title}</span>}
      {children}
    </span>
  );
}

/**
 * One line of a readout: the series' mark (a `color` swatch, or a logo in `mark`), its name in the
 * muted ink, its value at the end. `total` sets the sum apart under a hairline.
 */
function ChartReadoutRow({
  label,
  value,
  color,
  mark,
  total = false,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly color?: string;
  readonly mark?: ReactNode;
  readonly total?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-between gap-4",
        total && "mt-1 border-border border-t pt-1",
      )}
      data-slot="chart-readout-row"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {color === undefined ? null : <SeriesSwatch color={color} />}
        {mark}
        {label}
      </span>
      <span className="shrink-0 text-foreground">{value}</span>
    </span>
  );
}

/**
 * The labels along a chart's time axis, in the meta ink: the first and last period, and any
 * between, spread across the plot's width. Offset it with a margin where the value axis stands
 * beside the plot.
 */
function ChartAxis({
  className,
  labels,
}: {
  readonly className?: string;
  readonly labels: readonly string[];
}) {
  return (
    <div className={cn("flex justify-between gap-4", className)} data-slot="chart-axis">
      {labels.map((label, index) => (
        <Text key={`${String(index)}:${label}`} variant="meta">
          {label}
        </Text>
      ))}
    </div>
  );
}

/**
 * The ground a bar chart's columns stand on: a tinted frame they rise from, bottom-aligned, a
 * small gap between them. The caller sets its height and draws the columns.
 */
function ChartPlot({ className, children }: { readonly className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-end gap-1 overflow-hidden rounded-control bg-muted/10 px-2 pt-3 pb-2",
        className,
      )}
      data-slot="chart-plot"
    >
      {children}
    </div>
  );
}

export {
  ChartAxis,
  ChartPlot,
  ChartReadout,
  ChartReadoutRow,
  Legend,
  LegendItem,
  SERIES_COLORS,
  SeriesSwatch,
  seriesColor,
};
