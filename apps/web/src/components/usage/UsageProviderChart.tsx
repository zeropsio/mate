import type { UsageProviderKind } from "@t3tools/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@t3tools/shared/usageMerge";
import {
  formatDayShort,
  formatHourShort,
  formatDateTimeShort,
  formatTokens,
  formatUsd,
  formatUsdTick,
  formatUsageCost,
} from "@t3tools/shared/usageFormat";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 260;
const TICK_COUNT = 4;
const PLOT_TOP = 8;

export type UsageChartMetric = "tokens" | "cost";

interface UsageProviderChartProps {
  readonly providers: readonly UsageProviderKind[];
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
}

/** Recorded period values shared by the marks and period readout. */
export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number | null;
  }[];
  readonly total: number | null;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number | null {
  const entry = totals?.byProvider.get(provider);
  if (entry === undefined) return null;
  return metric === "tokens" ? entry.totalTokens : entry.costKnown === false ? null : entry.costUsd;
}

export function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return {
      bands,
      total:
        entry === undefined
          ? null
          : bands.some((band) => band.value !== null)
            ? bands.reduce((sum, band) => sum + (band.value ?? 0), 0)
            : null,
    };
  });
}

export function niceScale(peak: number, count: number): { max: number; ticks: readonly number[] } {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

export function UsageProviderChart({
  providers,
  days,
  daily,
  hours,
  hourly,
  metric,
  resolution,
  timeZone,
}: UsageProviderChartProps) {
  const periods = resolution === "hour" ? hours : days;
  const byPeriod = useMemo(
    () =>
      resolution === "hour"
        ? new Map(hourly.map((entry) => [entry.hourStart, entry]))
        : new Map(daily.map((entry) => [entry.day, entry])),
    [daily, hourly, resolution],
  );
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverPositionRef = useRef<{ x: number; y: number } | null>(null);

  const { ticks, stepX, toY, series } = useMemo(() => {
    const columns = buildPeriodColumns(periods, byPeriod, metric);
    const peak = columns.reduce(
      (max, column) => column.bands.reduce((inner, band) => Math.max(inner, band.value ?? 0), max),
      0,
    );
    const hasValues = columns.some((column) => column.total !== null);
    const scale = niceScale(peak === 0 && hasValues ? 1 : peak, TICK_COUNT);
    return {
      series: columns,
      stepX: periods.length === 0 ? 0 : VIEW_WIDTH / periods.length,
      ticks: scale.ticks,
      toY: (value: number) =>
        scale.max === 0
          ? VIEW_HEIGHT
          : VIEW_HEIGHT - (value / scale.max) * (VIEW_HEIGHT - PLOT_TOP),
    };
  }, [byPeriod, metric, periods]);

  const format = metric === "tokens" ? formatTokens : formatUsd;

  const positionTooltip = useCallback(() => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const hoverPosition = hoverPositionRef.current;
    if (plot === null || tooltip === null || hoverPosition === null) return;

    const gap = 12;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const plotWidth = plot.clientWidth;
    const plotHeight = plot.clientHeight;
    const preferredLeft =
      hoverPosition.x + gap + tooltipWidth <= plotWidth
        ? hoverPosition.x + gap
        : hoverPosition.x - gap - tooltipWidth;
    const preferredTop =
      hoverPosition.y + gap + tooltipHeight <= plotHeight
        ? hoverPosition.y + gap
        : hoverPosition.y - gap - tooltipHeight;
    const left = Math.min(Math.max(0, preferredLeft), Math.max(0, plotWidth - tooltipWidth));
    const top = Math.min(Math.max(0, preferredTop), Math.max(0, plotHeight - tooltipHeight));
    plot.style.setProperty("--usage-tooltip-left", `${left}px`);
    plot.style.setProperty("--usage-tooltip-top", `${top}px`);
  }, []);

  useLayoutEffect(() => {
    if (hoverIndex === null) return;
    positionTooltip();

    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    if (plot === null || tooltip === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(positionTooltip);
    observer.observe(plot);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [hoverIndex, positionTooltip]);

  const handleMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const plot = plotRef.current;
      if (plot === null || periods.length === 0) return;
      const bounds = plot.getBoundingClientRect();
      if (bounds.width === 0) return;
      const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
      const localY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
      const fraction = localX / bounds.width;
      const index = Math.floor(fraction * periods.length);
      hoverPositionRef.current = { x: localX, y: localY };
      positionTooltip();
      setHoverIndex(Math.min(periods.length - 1, Math.max(0, index)));
    },
    [periods.length, positionTooltip],
  );

  const hoveredPeriod = hoverIndex === null ? undefined : periods[hoverIndex];
  const hoveredColumn = hoverIndex === null ? undefined : series[hoverIndex];
  const formatPeriod = (period: string) =>
    resolution === "hour" ? formatHourShort(period, timeZone) : formatDayShort(period);
  const formatTooltipPeriod = (period: string) =>
    resolution === "hour"
      ? formatDateTimeShort(period, timeZone)
      : `${formatDayShort(period)} · UTC day`;
  const providerValue = (period: string, provider: UsageProviderKind) => {
    const row = byPeriod.get(period)?.byProvider.get(provider);
    return row === undefined
      ? "No data"
      : metric === "cost"
        ? formatUsageCost(row)
        : formatTokens(row.totalTokens);
  };
  const selectPeriod = (index: number) => {
    const plot = plotRef.current;
    hoverPositionRef.current = {
      x: plot === null ? 0 : ((index + 0.5) / periods.length) * plot.clientWidth,
      y: 0,
    };
    setHoverIndex(index);
    positionTooltip();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {/* Axis labels sit outside the plot so they stay aligned to gridlines. */}
        <div className="relative h-56 w-14 shrink-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground tabular-nums"
              style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}
            >
              {tick === 0 ? "0" : metric === "cost" ? formatUsdTick(tick) : formatTokens(tick)}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          className="relative h-56 flex-1"
          onMouseMove={handleMove}
          onMouseLeave={() => {
            hoverPositionRef.current = null;
            setHoverIndex(null);
          }}
        >
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="group"
            aria-label={`${resolution === "hour" ? "Hourly" : "Daily"} ${metric === "tokens" ? "processed tokens" : "cost"} by coding agent`}
          >
            {ticks.map((tick) => {
              const y = toY(tick);
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={VIEW_WIDTH}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth={1}
                  className="text-border"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {periods.map((period, index) => (
              <g
                key={period}
                role="button"
                tabIndex={0}
                aria-label={`${formatTooltipPeriod(period)}; ${metric === "tokens" ? "processed tokens" : "cost"}; ${providers.map((provider) => `${PROVIDER_PRESENTATION[provider].label}: ${providerValue(period, provider)}`).join("; ")}`}
                onFocus={() => selectPeriod(index)}
                onClick={() => selectPeriod(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectPeriod(index);
                  }
                }}
                onBlur={() => setHoverIndex(null)}
              >
                <rect
                  x={index * stepX}
                  y={0}
                  width={stepX}
                  height={VIEW_HEIGHT}
                  fill="transparent"
                />
                {providers.map((provider, providerIndex) => {
                  const value = series[index]?.bands.find(
                    (band) => band.provider === provider,
                  )?.value;
                  if (value == null) return null;
                  const width = Math.min(28, (stepX * 0.8) / providers.length);
                  const height = Math.max(2, VIEW_HEIGHT - toY(value));
                  return (
                    <rect
                      key={provider}
                      data-usage-value={value}
                      x={(index + 0.5) * stepX + (providerIndex - providers.length / 2) * width}
                      y={VIEW_HEIGHT - height}
                      width={width}
                      height={height}
                      fill={PROVIDER_PRESENTATION[provider].color}
                    />
                  );
                })}
              </g>
            ))}

            {hoverIndex === null ? null : (
              <line
                x1={(hoverIndex + 0.5) * stepX}
                x2={(hoverIndex + 0.5) * stepX}
                y1={PLOT_TOP}
                y2={VIEW_HEIGHT}
                stroke="currentColor"
                strokeWidth={1}
                className="text-muted-foreground"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {hoveredPeriod === undefined ? null : (
            <div
              ref={tooltipRef}
              className="surface-glass pointer-events-none absolute z-10 min-w-36 max-w-full rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg"
              style={{
                left: "var(--usage-tooltip-left, 0px)",
                top: "var(--usage-tooltip-top, 0px)",
              }}
            >
              <div className="mb-1 text-muted-foreground">{formatTooltipPeriod(hoveredPeriod)}</div>
              {providers.map((provider) => {
                const { label, mark: Mark } = PROVIDER_PRESENTATION[provider];
                return (
                  <div key={provider} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Mark className="size-3 shrink-0" aria-hidden />
                      {label}
                    </span>
                    <span className="text-foreground tabular-nums">
                      {providerValue(hoveredPeriod, provider)}
                    </span>
                  </div>
                );
              })}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
                <span className="text-muted-foreground">
                  {metric === "cost" ? "Priced cost" : "Total"}
                </span>
                <span className="text-foreground tabular-nums">
                  {byPeriod.has(hoveredPeriod) !== true
                    ? "No data"
                    : hoveredColumn?.total == null
                      ? "Unpriced"
                      : metric === "cost"
                        ? formatUsageCost(byPeriod.get(hoveredPeriod)!)
                        : format(hoveredColumn.total)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between pl-16 text-3xs text-muted-foreground uppercase">
        <span>{periods[0] === undefined ? "" : formatPeriod(periods[0])}</span>
        <span>
          {periods[Math.floor(periods.length / 2)] === undefined
            ? ""
            : formatPeriod(periods[Math.floor(periods.length / 2)] ?? "")}
        </span>
        <span>
          {periods[periods.length - 1] === undefined
            ? ""
            : formatPeriod(periods[periods.length - 1] ?? "")}
        </span>
      </div>
    </div>
  );
}
