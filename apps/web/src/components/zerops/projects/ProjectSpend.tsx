/**
 * A project's spend over the last 30 days: one line for its overview card (the figure, and a micro
 * bar a day) and a card for its page (the figure, a bar a day against the daily average, and what
 * the figure is made of). Each day stacks compute (Zerops) under model tokens (the organization's
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
import { createContext, useMemo, useState, type ReactNode } from "react";

import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useAccountOrgId, useDetailDemand, useProjection } from "~/zerops/accountData";

import {
  averageLine,
  dayLabel,
  formatUsd,
  moneyParts,
  spendState,
  subscriptionLine,
  TOKEN_SOURCE,
  tokenSpendQuery,
  tooltipDay,
  type SpendSeries,
  type SpendState,
  type SubscriptionMate,
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
function Money({ usd, size }: { readonly usd: number; readonly size: "line" | "card" }) {
  const { whole, cents } = moneyParts(usd);
  return (
    <span
      className={cn(
        "font-semibold tabular-nums tracking-tight text-foreground",
        size === "card" ? "text-title" : "text-emphasis",
      )}
    >
      {whole}
      <span
        className={cn(
          "font-medium text-muted-foreground",
          size === "card" ? "text-emphasis" : "text-caption",
        )}
      >
        {cents}
      </span>
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

const LINE_BARS: BarsGeometry = { height: 26, bar: "w-[3px]", slot: 5, radius: "" };
const CARD_BARS: BarsGeometry = {
  height: 92,
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
  average = false,
}: {
  readonly series: SpendSeries;
  readonly geometry: BarsGeometry;
  readonly average?: boolean;
}) {
  const scale = series.maxUsd > 0 ? (geometry.height - SEGMENT_GAP) / series.maxUsd : 0;
  const px = (usd: number) => (usd > 0 ? Math.max(1, Math.round(usd * scale)) : 0);
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
                <span className={cn("h-px bg-border", geometry.bar)} />
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
        {average && series.averageUsd > 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/60"
            style={{ bottom: Math.round(series.averageUsd * scale) }}
          />
        ) : null}
      </div>
    </>
  );
}

/** The overview card's line: "$64.30 30-day cost" and a micro bar a day. */
export function ProjectSpendLineView({ state }: { readonly state: SpendState }) {
  if (state.kind === "unknown") return null;
  if (state.kind === "loading")
    return (
      <div className="flex h-7 items-end justify-between gap-4" aria-busy="true">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-[26px] w-[148px]" />
      </div>
    );
  const { series } = state;
  return (
    <div className="flex h-7 items-end justify-between gap-4">
      <p className="flex min-w-0 items-baseline gap-2">
        <Money usd={series.totalUsd} size="line" />
        <span className="truncate text-caption text-muted-foreground">30-day cost</span>
      </p>
      <SpendBars series={series} geometry={LINE_BARS} />
    </div>
  );
}

export function ProjectSpendLine(input: ProjectSpendInput) {
  return <ProjectSpendLineView state={useProjectSpend(input)} />;
}

function LegendRow({
  fill,
  label,
  usd,
}: {
  readonly fill: string;
  readonly label: string;
  readonly usd: number;
}) {
  return (
    <div className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2">
      <span aria-hidden="true" className={cn("size-2.5 rounded-xs", fill)} />
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{formatUsd(usd)}</span>
    </div>
  );
}

const NO_MATES: ReadonlyArray<SubscriptionMate> = [];

/** The project page's card: the figure, a bar a day against the average, and its parts. */
export function ProjectSpendCardView({
  state,
  subscriptionMates = NO_MATES,
}: {
  readonly state: SpendState;
  readonly subscriptionMates?: ReadonlyArray<SubscriptionMate>;
}) {
  if (state.kind === "unknown") return null;
  const title = <h3 className="text-line font-medium text-foreground">Spend</h3>;
  if (state.kind === "loading")
    return (
      <Card size="md" aria-busy="true">
        {title}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-[116px] w-full" />
          <Skeleton className="h-[46px] w-full" />
        </div>
      </Card>
    );
  const { series } = state;
  if (series.totalUsd === 0)
    return (
      <Card size="md">
        {title}
        <p className="text-line text-muted-foreground">No spend in the last 30 days</p>
      </Card>
    );
  const first = series.days[0]?.day ?? "";
  const last = series.days.at(-1)?.day ?? "";
  const today = series.todayIndex >= 0 ? last : "";
  const fine = subscriptionLine(subscriptionMates);
  return (
    <Card size="md">
      {title}
      <div className="flex flex-col gap-3">
        <p className="flex h-7 items-baseline gap-2">
          <Money usd={series.totalUsd} size="card" />
          <span className="text-caption text-muted-foreground">30-day cost</span>
        </p>
        <div className="flex flex-col gap-2">
          <SpendBars series={series} geometry={CARD_BARS} average />
          <div className="flex justify-between text-caption tabular-nums text-muted-foreground">
            <span>{dayLabel(first, today)}</span>
            <span>{averageLine(series.averageUsd)}</span>
            <span>{dayLabel(last, today)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 pt-1 text-line">
          <LegendRow fill={COMPUTE_FILL} label="Compute · Zerops" usd={series.computeUsd} />
          <LegendRow
            fill={TOKENS_FILL}
            label={`Model tokens · ${TOKEN_SOURCE}`}
            usd={series.tokensUsd}
          />
        </div>
        {fine === null ? null : (
          <p className="text-caption text-muted-foreground text-pretty">{fine}</p>
        )}
      </div>
    </Card>
  );
}

export function ProjectSpendCard({
  subscriptionMates,
  ...input
}: ProjectSpendInput & { readonly subscriptionMates?: ReadonlyArray<SubscriptionMate> }) {
  return (
    <ProjectSpendCardView
      state={useProjectSpend(input)}
      {...(subscriptionMates === undefined ? {} : { subscriptionMates })}
    />
  );
}

/**
 * The project page's Spend card, handed from the page, which knows the project's Mates, to its card
 * grid (`ZeropsGroupPane`); none outside a project page.
 */
export const ProjectPageSpend = createContext<ReactNode>(null);
