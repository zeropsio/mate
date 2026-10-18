/**
 * A project's spend over the last 30 days, as its card and its page show it: what Zerops billed
 * for the projects it is made of (compute), and what its automated Mates' models cost on the
 * organization's key (model tokens), joined day by day. Subscriptions (a person's Claude or Codex
 * sign-in) bill no tokens and are not in the figure; the card names who runs on one.
 */
import type { ComputeSpendRead, SpendDay } from "@t3tools/client-runtime/data";
import type { AgentUsageRead } from "@t3tools/client-runtime/data";
import type { GroupFlow } from "@t3tools/client-runtime/zerops";
import { USAGE_AUTOMATED_OWNER, type UsageReport, type UsageReportQuery } from "@t3tools/contracts";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";

import { AUTOMATED_KEY_PROVIDER } from "~/zerops/automatedMate.logic";

export interface SpendDayRow {
  readonly day: SpendDay;
  readonly computeUsd: number;
  readonly tokensUsd: number;
  readonly totalUsd: number;
}

export interface SpendSeries {
  /** Oldest first, 30 of them; missing days cost nothing. */
  readonly days: ReadonlyArray<SpendDayRow>;
  readonly computeUsd: number;
  readonly tokensUsd: number;
  readonly totalUsd: number;
  /** The total over the window's days. */
  readonly averageUsd: number;
  /** The tallest day's total: what a bar's height is measured against. */
  readonly maxUsd: number;
  /** Today's place in `days`; -1 when the read's window ended before today. */
  readonly todayIndex: number;
}

/**
 * `unknown`: billing refused, a read failed, or HQ cannot report the tokens — nothing is shown and
 * no room is kept, since a figure missing either half would claim to be the whole.
 */
export type SpendState =
  | { readonly kind: "loading" }
  | { readonly kind: "unknown" }
  | { readonly kind: "loaded"; readonly series: SpendSeries };

const DAY_MS = 86_400_000;
const addDays = (day: SpendDay, count: number): SpendDay =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + count * DAY_MS).toISOString().slice(0, 10);

/**
 * The report of a project's model tokens on the organization's key, by day, over the same 30
 * calendar days as the compute read (HQ keeps tokens by UTC day: each joins the compute day of
 * the same date).
 */
export function tokenSpendQuery(
  appId: string,
  today: SpendDay,
  timeZone: string,
): UsageReportQuery {
  return {
    provenance: "live-responses",
    since: `${addDays(today, -29)}T00:00:00.000Z`,
    until: `${addDays(today, 1)}T00:00:00.000Z`,
    mode: "utc-days",
    timezone: timeZone,
    projectId: null,
    appId,
    mateId: null,
    ownerUserId: USAGE_AUTOMATED_OWNER,
    provider: null,
    model: null,
    groupBy: "day",
  };
}

/** A report's priced cost by day, every provider of a day added; an unpriced line adds nothing. */
export function tokenSpendByDay(report: UsageReport): ReadonlyMap<SpendDay, number> {
  const byDay = new Map<SpendDay, number>();
  for (const group of report.groups) {
    if (group.period === undefined) continue;
    const day = group.period.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(group.costUsdNanos ?? 0) / 1e9);
  }
  return byDay;
}

/** The two halves joined on the compute read's days. */
export function joinSpend(
  compute: { readonly days: ReadonlyArray<SpendDay>; readonly usd: ReadonlyArray<number> },
  tokens: ReadonlyMap<SpendDay, number>,
  today: SpendDay,
): SpendSeries {
  const days = compute.days.map((day, at) => {
    const computeUsd = compute.usd[at] ?? 0;
    const tokensUsd = tokens.get(day) ?? 0;
    return { day, computeUsd, tokensUsd, totalUsd: computeUsd + tokensUsd };
  });
  const sum = (pick: (row: SpendDayRow) => number) =>
    days.reduce((total, row) => total + pick(row), 0);
  const totalUsd = sum((row) => row.totalUsd);
  return {
    days,
    computeUsd: sum((row) => row.computeUsd),
    tokensUsd: sum((row) => row.tokensUsd),
    totalUsd,
    averageUsd: days.length === 0 ? 0 : totalUsd / days.length,
    maxUsd: days.reduce((max, row) => Math.max(max, row.totalUsd), 0),
    todayIndex: compute.days.indexOf(today),
  };
}

export function spendState(
  compute: ComputeSpendRead,
  tokens: AgentUsageRead,
  today: SpendDay,
): SpendState {
  if (compute.kind === "unknown" || tokens.kind === "unavailable") return { kind: "unknown" };
  if (compute.kind === "reading" || tokens.kind === "reading") return { kind: "loading" };
  return { kind: "loaded", series: joinSpend(compute, tokenSpendByDay(tokens.report), today) };
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$64.30"; a cost under a cent that is not nothing reads "<$0.01", never "$0.00". */
export function formatUsd(usd: number): string {
  return usd > 0 && usd < 0.005 ? "<$0.01" : USD.format(usd);
}

/** The figure split for type: "$64" and ".30". */
export function moneyParts(usd: number): { readonly whole: string; readonly cents: string } {
  const text = USD.format(usd);
  const point = text.lastIndexOf(".");
  return point === -1
    ? { whole: text, cents: "" }
    : { whole: text.slice(0, point), cents: text.slice(point) };
}

const DAY_PARTS = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
/** A day's weekday, date and month as people write them here: "Sat", "18", "Oct". */
const partsOf = (day: SpendDay) => {
  const parts = DAY_PARTS.formatToParts(Date.parse(`${day}T00:00:00.000Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return { weekday: part("weekday"), date: part("day"), month: part("month") };
};

/** A visible bar's least height: a day that cost anything never reads as a day that cost nothing. */
const LEAST_BAR_PX = 2;

/** A day's bar segment, in pixels at `scale` px a dollar: none for nothing, else at least 2 px. */
export function spendBarPx(usd: number, scale: number): number {
  return usd > 0 ? Math.max(LEAST_BAR_PX, Math.round(usd * scale)) : 0;
}

/** An axis's day: "19 Sep", or "Today". */
export function dayLabel(day: SpendDay, today: SpendDay): string {
  if (day === today) return "Today";
  const { date, month } = partsOf(day);
  return `${date} ${month}`;
}

/** A bar's tooltip heading: "Sat 18 Oct", or "Today". */
export function tooltipDay(day: SpendDay, today: SpendDay): string {
  if (day === today) return "Today";
  const { weekday, date, month } = partsOf(day);
  return `${weekday} ${date} ${month}`;
}

export function averageLine(averageUsd: number): string {
  return `avg ${formatUsd(averageUsd)} a day`;
}

/** Who the organization's key is with, as the legend names it: "Nebius". */
export const TOKEN_SOURCE =
  OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === AUTOMATED_KEY_PROVIDER)?.name.split(
    " ",
  )[0] ?? "organization key";

export interface SubscriptionMate {
  readonly name: string;
  /** The sign-in's product, as people say it: "Claude", "Codex". */
  readonly provider: string;
}

const names = (list: ReadonlyArray<string>): string =>
  list.length <= 1
    ? (list[0] ?? "")
    : list.length <= 3
      ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`
      : `${list.slice(0, 2).join(", ")} and ${String(list.length - 2)} more`;

/**
 * "Raya and Vera run on a Claude subscription; it is not in this figure." Null when no Mate of the
 * project runs on one.
 */
export function subscriptionLine(mates: ReadonlyArray<SubscriptionMate>): string | null {
  const byProvider = new Map<string, Array<string>>();
  for (const mate of mates)
    byProvider.set(mate.provider, [...(byProvider.get(mate.provider) ?? []), mate.name]);
  const groups = [...byProvider].map(([provider, list]) => ({ provider, list }));
  if (groups.length === 0) return null;
  const verb = (list: ReadonlyArray<string>) => (list.length === 1 ? "runs" : "run");
  if (groups.length === 1) {
    const [{ provider, list }] = groups as [(typeof groups)[number]];
    return `${names(list)} ${verb(list)} on a ${provider} subscription; it is not in this figure.`;
  }
  const clauses = groups.map(
    ({ provider, list }) => `${names(list)} ${verb(list)} on a ${provider} subscription`,
  );
  return `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1)}; they are not in this figure.`;
}

/** The Zerops projects a project is made of: its Mates', its stages' and its production's. */
export function spendProjectIds(
  flow: Pick<GroupFlow, "mates" | "stages" | "production">,
): ReadonlyArray<string> {
  const production = "stop" in flow.production ? [flow.production.stop.projectId] : [];
  return [
    ...flow.mates.map((mate) => mate.projectId),
    ...flow.stages.map((stage) => stage.projectId),
    ...production,
  ];
}
