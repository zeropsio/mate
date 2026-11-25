import { useState } from "react";

import {
  ChartAxis,
  ChartPlot,
  ChartReadout,
  ChartReadoutRow,
  Legend,
  LegendItem,
  SERIES_COLORS,
  SeriesSwatch,
} from "~/components/ui/chart";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipTrigger,
} from "~/components/ui/tooltip";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const DAYS = [
  { day: "Mon", cpu: 22, read: 8 },
  { day: "Tue", cpu: 48, read: 14 },
  { day: "Wed", cpu: 35, read: 30 },
  { day: "Thu", cpu: 64, read: 12 },
  { day: "Fri", cpu: 41, read: 22 },
  { day: "Sat", cpu: 12, read: 4 },
  { day: "Sun", cpu: 18, read: 6 },
];
const CPU = "var(--color-series-1)";
const READ = "var(--color-series-2)";

/** A week as a plot: each day's two columns, one tooltip for every day, the axis under it. */
function WeekPlot() {
  const [handle] = useState(() => TooltipCreateHandle<number>());
  return (
    <div className="flex w-full flex-col gap-2">
      <Legend>
        <LegendItem color={CPU} label="CPU average" />
        <LegendItem color={READ} label="Reads" />
      </Legend>
      <Tooltip handle={handle}>
        {({ payload }) => {
          const row = payload === undefined ? undefined : DAYS[payload];
          return row === undefined ? null : (
            <TooltipPopup>
              <ChartReadout title={row.day}>
                <ChartReadoutRow color={CPU} label="CPU average" value={`${String(row.cpu)}%`} />
                <ChartReadoutRow color={READ} label="Reads" value={`${String(row.read)} MB`} />
              </ChartReadout>
            </TooltipPopup>
          );
        }}
      </Tooltip>
      <ChartPlot className="h-28">
        {DAYS.map((row, at) => (
          <TooltipTrigger
            className="grid h-full min-w-1 flex-1 grid-cols-2 items-end gap-0.5"
            delay={0}
            handle={handle}
            key={row.day}
            payload={at}
            render={<div />}
          >
            <span
              className="block rounded-t-mark"
              style={{ height: `${String(row.cpu)}%`, backgroundColor: CPU }}
            />
            <span
              className="block rounded-t-mark"
              style={{ height: `${String(row.read)}%`, backgroundColor: READ }}
            />
          </TooltipTrigger>
        ))}
      </ChartPlot>
      <ChartAxis labels={["Mon", "Thu", "Sun"]} />
    </div>
  );
}

function ChartSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Handed out in this order, never cycled: a ninth series folds into Other."
        title="Series palette"
      >
        <SpecimenGrid>
          {SERIES_COLORS.map((color, index) => (
            <Specimen key={color} label={`--color-series-${String(index + 1)}`}>
              <span className="flex items-center gap-3">
                <SeriesSwatch color={color} />
                <span className="h-8 w-16 rounded-mark" style={{ backgroundColor: color }} />
              </span>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A swatch, the series' name in the muted ink, its amount in the foreground."
        title="Legend"
      >
        <SpecimenGrid size="lg">
          <Specimen label="<LegendItem color label value />">
            <Legend>
              <LegendItem color="var(--color-agent-codex)" label="Codex" value="$4.20" />
              <LegendItem color="var(--color-agent-claude)" label="Claude Code" value="$2.80" />
              <LegendItem color="var(--color-agent-opencode)" label="OpenCode" value="$0.90" />
            </Legend>
          </Specimen>
          <Specimen label="<LegendItem color label />" note="A plot's key, without amounts">
            <Legend>
              <LegendItem color={CPU} label="CPU average" />
              <LegendItem color={READ} label="Reads" />
              <LegendItem color="var(--color-series-3)" label="Writes" />
            </Legend>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Hover a day: one tooltip for every column, saying the day and each series."
        title="Plot, readout and axis"
      >
        <SpecimenGrid size="lg">
          <Specimen label="<ChartPlot> <ChartReadout> <ChartAxis>">
            <WeekPlot />
          </Specimen>
          <Specimen label="<ChartReadoutRow total />" note="A readout with its sum">
            <Tooltip>
              <TooltipTrigger
                delay={0}
                render={<span className="text-body text-foreground underline decoration-dotted" />}
              >
                Hover for 3 Oct
              </TooltipTrigger>
              <TooltipPopup>
                <ChartReadout title="3 Oct · UTC day">
                  <ChartReadoutRow color="var(--color-agent-codex)" label="Codex" value="$4.20" />
                  <ChartReadoutRow
                    color="var(--color-agent-claude)"
                    label="Claude Code"
                    value="$2.80"
                  />
                  <ChartReadoutRow label="Priced cost" total value="$7.00" />
                </ChartReadout>
              </TooltipPopup>
            </Tooltip>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "chart",
  title: "Chart pieces",
  purpose:
    "What every chart shares: the series palette, its legend, the hover readout, the axis and the plot's ground.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/chart.tsx",
  render: () => <ChartSpecimens />,
});
