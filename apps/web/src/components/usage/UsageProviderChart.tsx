import type { UsageProviderKind } from "@t3tools/contracts";
import { useMemo, useState } from "react";

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
import { ChartAxis, ChartReadout, ChartReadoutRow } from "~/components/ui/chart";
import { Text } from "~/components/ui/text";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipTrigger,
} from "~/components/ui/tooltip";
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
interface DayColumn {
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
  const [handle] = useState(() => TooltipCreateHandle<number>());

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
  const periodTotal = (period: string, column: DayColumn | undefined) =>
    byPeriod.has(period) !== true
      ? "No data"
      : column?.total == null
        ? "Unpriced"
        : metric === "cost"
          ? formatUsageCost(byPeriod.get(period)!)
          : format(column.total);
  const middle = periods[Math.floor(periods.length / 2)];
  const axis = [periods[0], middle, periods[periods.length - 1]].map((period) =>
    period === undefined ? "" : formatPeriod(period),
  );

  return (
    <div className="flex flex-col gap-1">
      <Tooltip handle={handle}>
        {({ payload }) => {
          const period = payload === undefined ? undefined : periods[payload];
          return period === undefined || payload === undefined ? null : (
            <TooltipPopup variant="rich" side="top">
              <ChartReadout title={formatTooltipPeriod(period)}>
                {providers.map((provider) => {
                  const { label, mark: Mark } = PROVIDER_PRESENTATION[provider];
                  return (
                    <ChartReadoutRow
                      key={provider}
                      label={label}
                      mark={<Mark aria-hidden className="size-3 shrink-0" />}
                      value={providerValue(period, provider)}
                    />
                  );
                })}
                <ChartReadoutRow
                  label={metric === "cost" ? "Priced cost" : "Total"}
                  total
                  value={periodTotal(period, series[payload])}
                />
              </ChartReadout>
            </TooltipPopup>
          );
        }}
      </Tooltip>
      <div className="flex gap-2">
        {/* Axis labels sit outside the plot so they stay aligned to gridlines. */}
        <div className="relative h-56 w-14 shrink-0">
          {ticks.map((tick) => (
            <Text
              key={tick}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}
              variant="meta"
            >
              {tick === 0 ? "0" : metric === "cost" ? formatUsdTick(tick) : formatTokens(tick)}
            </Text>
          ))}
        </div>

        <div className="relative h-56 flex-1" onMouseLeave={() => setHoverIndex(null)}>
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
              <g key={period}>
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
          {/* Each period's hover and focus target, over its column: one tooltip names them all. */}
          <div className="absolute inset-0 flex">
            {periods.map((period, index) => (
              <TooltipTrigger
                aria-label={`${formatTooltipPeriod(period)}; ${metric === "tokens" ? "processed tokens" : "cost"}; ${providers.map((provider) => `${PROVIDER_PRESENTATION[provider].label}: ${providerValue(period, provider)}`).join("; ")}`}
                className="h-full min-w-0 flex-1"
                delay={0}
                handle={handle}
                key={period}
                onBlur={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex(index)}
                onMouseEnter={() => setHoverIndex(index)}
                payload={index}
                render={<div />}
                tabIndex={0}
              />
            ))}
          </div>
        </div>
      </div>

      <ChartAxis className="ms-16" labels={axis} />
    </div>
  );
}
