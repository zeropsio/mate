/**
 * Settings → Billing: the chosen organization's money, read here, acted on in HQ (hq.zerops.io).
 *
 * The balance leads, at the size of a figure people check: what Zerops spends from, how it splits
 * between topped-up and promo credit, and what keeps it going — the automatic top-up, or how long
 * it lasts at the last 30 days' rate — with Top up in HQ beside it. An unverified organization is
 * offered the first top-up that verifies it; a project Zerops will stop soon is named. Then what it
 * spent, by period, over a bar a day for 30 days; then this month by project, each with its share.
 * Invoices, cards and billing details are HQ's alone. A member Zerops shows no finances to is told
 * so, never shown a zero.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  listedProjectAtom,
  organizationBillingAtom,
  organizationComputeSpend,
  stopWords,
  type ComputeSpendRead,
  type OrganizationBilling,
  type PeriodCost,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo, useState, type JSX } from "react";

import { cn } from "~/lib/utils";
import { useAccountDataOptional, useDetailDemand, useProjection } from "~/zerops/accountData";
import { hqCreditUrl } from "~/zerops/hqCredit";
import { useCreditOffers } from "~/zerops/usePlatformCapabilities";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PAGE_BARS, SpendBars } from "../zerops/projects/ProjectSpend";
import { formatUsd, joinSpend, moneyParts } from "../zerops/projects/projectSpend.logic";
import { SettingsPageContainer } from "./settingsLayout";
import { mayReadBilling } from "@t3tools/client-runtime/zerops/billingAccess";

/** Projects listed before "Show all": the ones that cost most this month. */
const PROJECTS_SHOWN = 8;

export function BillingSettings(): JSX.Element {
  const organization = useZeropsSessionOptional()?.activeOrganization ?? null;
  return (
    <SettingsPageContainer>
      {organization === null ? (
        <PageNote
          title="No organization chosen"
          words="Billing belongs to an organization. Choose one in the menu."
        />
      ) : !mayReadBilling(organization.roleCode) ? (
        // Offered nowhere to anyone else: an address typed by hand reads nothing.
        <PageNote
          title="Billing is for owners and admins"
          words={`${organization.name}'s owners and admins see its billing. Ask one of them.`}
        />
      ) : (
        <OrganizationBillingPage organizationName={organization.name} orgId={organization.id} />
      )}
    </SettingsPageContainer>
  );
}

function PageNote({ title, words }: { readonly title: string; readonly words: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-24 text-center">
      <p className="font-medium text-foreground text-sm">{title}</p>
      <p className="max-w-sm text-muted-foreground text-sm">{words}</p>
    </div>
  );
}

function OrganizationBillingPage({
  orgId,
  organizationName,
}: {
  readonly orgId: string;
  readonly organizationName: string;
}): JSX.Element {
  // The data layer reads the organization a render after the session names it: until then the
  // page reads, and nothing is asked of the organization left behind.
  const observed = useAccountDataOptional()?.orgId === orgId ? orgId : null;
  useDetailDemand("organizationCost", undefined, observed);
  useDetailDemand("organizationCredit", undefined, observed);
  useDetailDemand("projectSpend", undefined, observed);
  const billing = useAtomValue(organizationBillingAtom(orgId));
  const daily = useProjection(organizationComputeSpend, observed, READING_DAYS);
  const { addCredit } = useCreditOffers();
  const hq = hqCreditUrl(orgId);
  if (billing.kind === "refused") {
    return (
      <PageNote
        title="Billing isn't shared with you"
        words={`${organizationName}'s billing is shared with its owners and members with finance access. Ask an owner.`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-12 pb-16" data-zerops-surface="billing">
      <BalanceCard
        addCredit={addCredit}
        billing={billing}
        hq={hq}
        organizationName={organizationName}
      />
      <SpendingSection billing={billing} daily={daily} />
      <ProjectsSection billing={billing} />
      <section className="flex flex-col items-start justify-between gap-3 rounded-xl bg-muted/50 px-5 py-4 sm:flex-row sm:items-center">
        <p className="text-muted-foreground text-sm">
          Invoices, payment cards, automatic top-up and billing details are in HQ.
        </p>
        <HqButton href={hq} variant="secondary">
          Open billing in HQ
        </HqButton>
      </section>
    </div>
  );
}

const READING_DAYS = Atom.make<ComputeSpendRead>({ kind: "reading" });

function HqButton({
  href,
  variant,
  children,
}: {
  readonly href: string;
  readonly variant: "primary" | "secondary";
  readonly children: string;
}) {
  return (
    <Button render={<a href={href} rel="noreferrer" target="_blank" />} variant={variant}>
      {children}
      <ExternalLinkIcon aria-hidden="true" />
    </Button>
  );
}

/**
 * "$1,240.50" at the size people read money at: the sign quiet, the dollars in the ink, the cents
 * smaller and quiet.
 */
function Figure({ usd, size }: { readonly usd: number; readonly size: "hero" | "title" }) {
  const { whole, cents } = moneyParts(usd);
  const sign = whole.match(/^-?\$/u)?.[0] ?? "";
  return (
    <span
      className={cn(
        "font-semibold text-foreground tabular-nums tracking-tight",
        size === "hero" ? "text-4xl" : "text-display",
      )}
    >
      <span className="font-normal text-muted-foreground">{sign}</span>
      {whole.slice(sign.length)}
      <span
        className={cn(
          "font-medium text-muted-foreground",
          size === "hero" ? "text-xl" : "text-emphasis",
        )}
      >
        {cents}
      </span>
    </span>
  );
}

function BalanceCard({
  billing,
  addCredit,
  hq,
  organizationName,
}: {
  readonly billing: OrganizationBilling;
  readonly addCredit: boolean;
  readonly hq: string;
  readonly organizationName: string;
}): JSX.Element {
  const balance = billing.balance;
  const total = billing.total;
  return (
    <section
      aria-label="Balance"
      className="overflow-hidden rounded-2xl border border-border/70 bg-card"
      data-zerops-surface="billing-balance"
    >
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="font-medium text-muted-foreground text-sm">Balance</h2>
          {balance === null || total === null ? (
            <Skeleton className="h-10 w-48" />
          ) : (
            <Figure size="hero" usd={total} />
          )}
          <p className="min-h-5 text-muted-foreground text-sm">
            <Keeps billing={billing} />
          </p>
        </div>
        {addCredit ? (
          <HqButton href={hq} variant="primary">
            Top up in HQ
          </HqButton>
        ) : (
          <p className="max-w-56 text-muted-foreground text-sm sm:text-right">
            Owners and members who manage billing top up. Ask an owner.
          </p>
        )}
      </div>
      {balance === null || total === null ? null : (
        <div className="flex flex-col gap-3 border-border/70 border-t px-6 py-5">
          <Split credit={balance.credit} promo={balance.promoCredit} />
          {billing.verification === "unverified" ? (
            <Alert variant="success">
              <AlertDescription>
                A first top-up of $10 verifies {organizationName}: $50 of promo credit comes with
                it, and higher limits.
              </AlertDescription>
            </Alert>
          ) : null}
          {billing.soonest === null || billing.tone === "quiet" ? null : (
            <SoonestStop
              hoursLeft={billing.soonest.hoursLeft}
              projectId={billing.soonest.projectId}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** What keeps the balance going: the automatic top-up, else how long it lasts at its rate. */
function Keeps({ billing }: { readonly billing: OrganizationBilling }) {
  const balance = billing.balance;
  if (balance === null || billing.total === null) return <Skeleton className="h-4 w-72" />;
  const refill = balance.autoTopUp;
  if (refill !== null) {
    return (
      <>
        Below {formatUsd(refill.threshold)}, HQ adds {formatUsd(refill.amount)}, at most{" "}
        {formatUsd(refill.monthlyLimit)} a month.
      </>
    );
  }
  if (billing.total <= 0) return <>Nothing is left: stopped projects can't start until a top-up.</>;
  if (billing.daysLeft === null) {
    return billing.cost.kind === "reading" ? <Skeleton className="h-4 w-72" /> : null;
  }
  const rate = billing.cost.kind === "known" ? billing.cost.value.organization.perDay : null;
  return (
    <span className={cn(billing.lastsShort && "text-status-attention-text")}>
      Lasts about {daysWords(billing.daysLeft)}
      {rate === null ? "" : ` at ${formatUsd(rate)} a day`} · no automatic top-up
    </span>
  );
}

function daysWords(days: number): string {
  if (days < 1) return "less than a day";
  const whole = Math.floor(days);
  return whole === 1 ? "a day" : `${String(whole)} days`;
}

/** How the balance splits between topped-up credit and promo credit, which Zerops spends alike. */
function Split({ credit, promo }: { readonly credit: number; readonly promo: number }) {
  const total = Math.max(0, credit) + Math.max(0, promo);
  const creditShare = total > 0 ? (Math.max(0, credit) / total) * 100 : 0;
  return (
    <div className="flex flex-col gap-3">
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {total > 0 ? (
          <>
            <span className="h-full bg-spend-compute" style={{ width: `${creditShare}%` }} />
            <span
              className="h-full bg-spend-compute/55"
              style={{ width: `${100 - creditShare}%` }}
            />
          </>
        ) : null}
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <SplitPart dot="bg-spend-compute" label="Topped up" usd={credit} />
        <SplitPart dot="bg-spend-compute/55" label="Promo credit" usd={promo} />
      </dl>
    </div>
  );
}

function SplitPart({
  label,
  usd,
  dot,
}: {
  readonly label: string;
  readonly usd: number;
  readonly dot: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
        {label}
      </dt>
      <dd className="text-foreground tabular-nums">{formatUsd(usd)}</dd>
    </div>
  );
}

/** The project Zerops will stop soonest: its own name, and when, in Zerops's hours. */
function SoonestStop({
  projectId,
  hoursLeft,
}: {
  readonly projectId: string;
  readonly hoursLeft: number;
}): JSX.Element {
  const project = useAtomValue(listedProjectAtom(projectId));
  return (
    <Alert variant="warning">
      <AlertDescription>
        {project?.name ?? "A project"} stops {stopWords(hoursLeft)}: not enough credit.
      </AlertDescription>
    </Alert>
  );
}

type Period = "today" | "last7Days" | "last30Days" | "thisMonth" | "lastMonth";

const PERIODS: ReadonlyArray<{ readonly id: Period; readonly label: string }> = [
  { id: "today", label: "Today" },
  { id: "last7Days", label: "7 days" },
  { id: "last30Days", label: "30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
];

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long" });

/** What the figure covers, in words: "Last 30 days · $41.20 a day on average". */
function periodWords(period: Period, cost: PeriodCost): string {
  const now = new Date();
  switch (period) {
    case "today":
      return "Today so far";
    case "last7Days":
      return `Last 7 days · ${formatUsd(cost.last7Days / 7)} a day on average`;
    case "last30Days":
      return `Last 30 days · ${formatUsd(cost.perDay)} a day on average`;
    case "thisMonth":
      return `${MONTH.format(now)} so far`;
    case "lastMonth":
      return MONTH.format(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }
}

function SpendingSection({
  billing,
  daily,
}: {
  readonly billing: OrganizationBilling;
  readonly daily: ComputeSpendRead;
}): JSX.Element {
  const [period, setPeriod] = useState<Period>("last30Days");
  const cost = billing.cost;
  const series = useMemo(
    () =>
      daily.kind === "read"
        ? joinSpend(daily, new Map(), daily.days[daily.days.length - 1] ?? "")
        : null,
    [daily],
  );
  return (
    <section
      aria-label="Spending"
      className="flex flex-col gap-5"
      data-zerops-surface="billing-spending"
    >
      <div className="flex flex-col gap-4 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-medium text-muted-foreground text-sm">Spending</h2>
          {cost.kind === "known" ? (
            <>
              <Figure size="title" usd={cost.value.organization[period]} />
              <p className="text-muted-foreground text-xs">
                {periodWords(period, cost.value.organization)}
              </p>
            </>
          ) : cost.kind === "refused" ? (
            <p className="text-muted-foreground text-sm">Spending isn't shared with you.</p>
          ) : (
            <>
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-4 w-56" />
            </>
          )}
        </div>
        <ToggleGroup
          aria-label="Period"
          onValueChange={(next) => {
            const picked = PERIODS.find((entry) => entry.id === next[0]);
            if (picked !== undefined) setPeriod(picked.id);
          }}
          value={[period]}
          variant="segmented"
        >
          {PERIODS.map((entry) => (
            <Toggle key={entry.id} value={entry.id}>
              {entry.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <figure className="flex flex-col gap-2 px-1">
        {series === null ? (
          daily.kind === "reading" ? (
            <Skeleton className="w-full" style={{ height: PAGE_BARS.height }} />
          ) : null
        ) : (
          <>
            <div className="relative">
              <SpendBars geometry={PAGE_BARS} series={series} />
              <AverageLine averageUsd={series.averageUsd} maxUsd={series.maxUsd} />
            </div>
            <figcaption className="flex justify-between text-caption text-muted-foreground">
              <span>30 days ago</span>
              <span>Today</span>
            </figcaption>
          </>
        )}
      </figure>
    </section>
  );
}

/**
 * The 30 days' average across the bars, dashed: how a day compares at a glance (the figure's
 * caption says its amount). Measured as the bars are (the tallest day fills the plot, less the gap between a day's
 * segments), and drawn over them without taking pointer events from their tooltips.
 */
function AverageLine({
  averageUsd,
  maxUsd,
}: {
  readonly averageUsd: number;
  readonly maxUsd: number;
}) {
  if (maxUsd <= 0 || averageUsd <= 0) return null;
  const bottom = (averageUsd / maxUsd) * (PAGE_BARS.height - BAR_SEGMENT_GAP);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 flex items-center"
      style={{ bottom }}
    >
      <span className="h-0 flex-1 border-foreground/40 border-t border-dashed" />
    </div>
  );
}

/** The gap the bars keep between a day's two segments, which their height leaves out. */
const BAR_SEGMENT_GAP = 2;

function ProjectsSection({
  billing,
}: {
  readonly billing: OrganizationBilling;
}): JSX.Element | null {
  const [all, setAll] = useState(false);
  const cost = billing.cost;
  if (cost.kind !== "known") return null;
  const projects = Object.entries(cost.value.projects)
    .filter(([, period]) => period.thisMonth > 0)
    .sort(([, left], [, right]) => right.thisMonth - left.thisMonth);
  const month = cost.value.organization.thisMonth;
  const top = projects[0]?.[1].thisMonth ?? 0;
  const shown = all ? projects : projects.slice(0, PROJECTS_SHOWN);
  return (
    <section
      aria-label="This month by project"
      className="flex flex-col gap-3"
      data-zerops-surface="billing-projects"
    >
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h2 className="font-medium text-muted-foreground text-sm">This month by project</h2>
        {projects.length === 0 ? null : (
          <span className="text-muted-foreground text-xs tabular-nums">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </span>
        )}
      </div>
      {projects.length === 0 ? (
        <p className="px-1 text-muted-foreground text-sm">Nothing has cost anything this month.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border/60">
          {shown.map(([projectId, period]) => (
            <ProjectRow
              key={projectId}
              month={month}
              projectId={projectId}
              top={top}
              usd={period.thisMonth}
            />
          ))}
        </ol>
      )}
      {projects.length > PROJECTS_SHOWN ? (
        <div className="px-1">
          <Button onClick={() => setAll(!all)} size="sm" variant="ghost">
            {all ? "Show fewer" : `Show all ${String(projects.length)}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ProjectRow({
  projectId,
  usd,
  top,
  month,
}: {
  readonly projectId: string;
  readonly usd: number;
  /** The costliest project's amount: what each bar is measured against. */
  readonly top: number;
  /** The organization's month: what each share is of. */
  readonly month: number;
}): JSX.Element {
  const project = useAtomValue(listedProjectAtom(projectId));
  const share = month > 0 ? Math.round((usd / month) * 100) : 0;
  return (
    <li className="flex min-h-11 items-center gap-4 px-1 py-2">
      {/* A project the person no longer sees, or one deleted since, still cost what it cost. */}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          project === null ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {project?.name ?? "A project no longer listed"}
      </span>
      <span
        aria-hidden="true"
        className="hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-muted sm:block"
      >
        <span
          className="block h-full rounded-full bg-spend-compute"
          style={{ width: `${top > 0 ? Math.max(2, (usd / top) * 100) : 0}%` }}
        />
      </span>
      <span className="w-20 shrink-0 text-right text-foreground text-sm tabular-nums">
        {formatUsd(usd)}
      </span>
      <span className="w-9 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
        {share < 1 ? "<1%" : `${String(share)}%`}
      </span>
    </li>
  );
}
