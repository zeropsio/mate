/**
 * A project's spend over the last 30 days, a row of its page's side column: the figure, what it is
 * a day, and a bar a day. Each day stacks compute (Zerops) under model tokens (the organization's
 * key); a bar's tooltip says the day's split. Nothing shows, and no room is kept, when either half
 * cannot be read.
 */
import {
  agentUsage,
  agentUsageOwner,
  computeSpend,
  dayIn,
  type AgentUsageRead,
  type ComputeSpendRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useMemo, useState } from "react";

import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useAccountOrgId, useDetailDemand, useProjection } from "~/zerops/accountData";

import { SetupRow } from "../project/SetupCard";
import { spendDaily } from "../project/projectSetup.logic";
import {
  formatUsd,
  moneyParts,
  spendBarPx,
  spendState,
  tokenSpendQuery,
  tooltipDay,
  type SpendSeries,
  type SpendState,
} from "./projectSpend.logic";

const READING_COMPUTE = Atom.make<ComputeSpendRead>({ kind: "reading" });
const READING_TOKENS = Atom.make<AgentUsageRead>({ kind: "reading" });

export interface ProjectSpendInput {
  /** The HQ application: whose automated Mates' tokens count. */
  readonly appId: string;
  /** The Zerops projects it is made of: its Mates' projects, its stage and its production. */
  readonly projectIds: ReadonlyArray<string>;
}

/** The project's spend as the data layer reads it: billing's days joined with HQ's tokens. */
export function useProjectSpend({ appId, projectIds }: ProjectSpendInput): SpendState {
  const orgId = useAccountOrgId();
  const timeZone = useMemo(() => new Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // The day the screen opened on: a new day's window comes with the next screen.
  const [today] = useState(() => dayIn(Date.now(), timeZone));
  const owner = useMemo(
    () => agentUsageOwner(tokenSpendQuery(appId, today, timeZone)),
    [appId, today, timeZone],
  );
  useDetailDemand("projectSpend", undefined, orgId);
  useDetailDemand("agentUsage", undefined, owner);
  const compute = useProjection(
    computeSpend,
    orgId === null ? null : { orgId, projectIds },
    READING_COMPUTE,
  );
  const tokens = useProjection(
    agentUsage,
    orgId === null ? null : { orgId, owner },
    READING_TOKENS,
  );
  // No organization shown: nothing is read, so nothing is drawn and no room is kept.
  return useMemo(
    () => (orgId === null ? NO_SPEND : spendState(compute, tokens, today)),
    [orgId, compute, tokens, today],
  );
}

const NO_SPEND: SpendState = { kind: "unknown" };

/** "$64" at the figure's size, ".30" smaller and quiet. */
function Money({ usd }: { readonly usd: number }) {
  const { whole, cents } = moneyParts(usd);
  return (
    <span className="text-title font-semibold tabular-nums tracking-tight text-foreground">
      {whole}
      <span className="text-emphasis font-medium text-muted-foreground">{cents}</span>
    </span>
  );
}

const COMPUTE_FILL = "bg-spend-compute";
const TOKENS_FILL = "bg-spend-tokens";

interface BarsGeometry {
  /** The plot's height, in pixels. */
  readonly height: number;
  /** A bar's width inside its slot: the slot's leftover is the gap between bars. */
  readonly bar: string;
  /** A slot's width; `null` shares the plot's width out evenly. */
  readonly slot: number | null;
  readonly radius: string;
}

/** The sparkline's plot: a bar a day at a line's height. */
const ROW_BARS: BarsGeometry = {
  height: 28,
  bar: "w-[calc(100%-5px)]",
  slot: null,
  radius: "rounded-t-sm",
};
/** Between a day's two segments. */
const SEGMENT_GAP = 2;

/** One bar a day, compute under tokens, and a tooltip per bar with the day's split. */
function SpendBars({
  series,
  geometry,
}: {
  readonly series: SpendSeries;
  readonly geometry: BarsGeometry;
}) {
  const scale = series.maxUsd > 0 ? (geometry.height - SEGMENT_GAP) / series.maxUsd : 0;
  const px = (usd: number) => spendBarPx(usd, scale);
  const today = series.todayIndex >= 0 ? series.days[series.todayIndex]?.day : undefined;
  const [handle] = useState(() => TooltipCreateHandle<number>());
  return (
    <>
      <Tooltip handle={handle}>
        {({ payload }) => {
          const row = payload === undefined ? undefined : series.days[payload];
          return row === undefined ? null : (
            <TooltipPopup side="top">
              <span className="flex min-w-36 flex-col gap-0.5 py-0.5 tabular-nums">
                <span className="font-medium text-foreground">
                  {tooltipDay(row.day, today ?? "")}
                </span>
                <span className="flex justify-between gap-4 text-muted-foreground">
                  Compute <span className="text-foreground">{formatUsd(row.computeUsd)}</span>
                </span>
                <span className="flex justify-between gap-4 text-muted-foreground">
                  Model tokens <span className="text-foreground">{formatUsd(row.tokensUsd)}</span>
                </span>
              </span>
            </TooltipPopup>
          );
        }}
      </Tooltip>
      <div
        role="img"
        aria-label={`Daily spend, last ${String(series.days.length)} days: compute ${formatUsd(series.computeUsd)}, model tokens ${formatUsd(series.tokensUsd)}`}
        className={cn("relative flex items-end", geometry.slot === null ? "w-full" : "shrink-0")}
        style={{ height: geometry.height }}
      >
        {series.days.map((row, at) => {
          const computePx = px(row.computeUsd);
          const tokensPx = px(row.tokensUsd);
          const isToday = at === series.todayIndex;
          return (
            <TooltipTrigger
              key={row.day}
              handle={handle}
              payload={at}
              delay={0}
              render={<div />}
              className={cn(
                "flex h-full flex-col-reverse items-center",
                geometry.slot === null && "min-w-0 flex-1",
              )}
              style={geometry.slot === null ? undefined : { width: geometry.slot }}
            >
              {row.totalUsd === 0 ? (
                // Every day keeps its slot visible, so the plot reads as 30 days to today.
                <span className={cn("h-0.5 bg-border", geometry.bar)} />
              ) : (
                <span
                  className={cn("flex flex-col-reverse", geometry.bar, isToday && "opacity-55")}
                  style={{ gap: computePx > 0 && tokensPx > 0 ? SEGMENT_GAP : 0 }}
                >
                  {computePx > 0 ? (
                    <span
                      className={cn("block", COMPUTE_FILL, tokensPx === 0 && geometry.radius)}
                      style={{ height: computePx }}
                    />
                  ) : null}
                  {tokensPx > 0 ? (
                    <span
                      className={cn("block", TOKENS_FILL, geometry.radius)}
                      style={{ height: tokensPx }}
                    />
                  ) : null}
                </span>
              )}
            </TooltipTrigger>
          );
        })}
      </div>
    </>
  );
}

/**
 * The project page's Spend row: the 30-day figure, what it is a day, and a bar a day under it —
 * each bar's tooltip the day's split. Holds its room while read; not drawn where it is unknown.
 */
export function ProjectSpendRowView({ state }: { readonly state: SpendState }) {
  if (state.kind === "unknown") return null;
  if (state.kind === "loading")
    return (
      <SetupRow busy label="Spend" surface="project-spend">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-full" />
      </SetupRow>
    );
  const { series } = state;
  return (
    <SetupRow label="Spend" surface="project-spend">
      {series.totalUsd === 0 ? (
        <p className="text-line text-muted-foreground">No spend in the last 30 days</p>
      ) : (
        <>
          <p className="flex h-7 min-w-0 flex-wrap items-baseline gap-x-2">
            <Money usd={series.totalUsd} />
            <span className="text-caption text-muted-foreground">
              {spendDaily(series.averageUsd, series.days.length)}
            </span>
          </p>
          <SpendBars geometry={ROW_BARS} series={series} />
        </>
      )}
    </SetupRow>
  );
}

export function ProjectSpendRow(input: ProjectSpendInput) {
  return <ProjectSpendRowView state={useProjectSpend(input)} />;
}
