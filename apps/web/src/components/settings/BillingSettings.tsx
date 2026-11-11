/**
 * Settings → Billing: the chosen organization's money as Mate shows it, every action on it in
 * Zerops. Its balance live (credit and promo credit), what keeps it topped up or how long it lasts
 * at the last 30 days' rate, the project Zerops will stop soonest for insufficient funds, what it
 * spent today, this month and over 30 days, and this month by project. Top-ups, automatic top-up,
 * invoices, cards and billing details open the organization's page in Zerops. A member Zerops shows
 * no finances to is told so, never shown a zero.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  listedProjectAtom,
  organizationBillingAtom,
  stopWords,
  type OrganizationBilling,
  type PeriodCost,
} from "@t3tools/client-runtime/data";
import { formatUsd } from "@t3tools/shared/usageFormat";
import { ExternalLinkIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { useAccountDataOptional, useDetailDemand } from "~/zerops/accountData";
import { hqCreditUrl } from "~/zerops/hqCredit";
import { useCreditOffers } from "~/zerops/usePlatformCapabilities";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

/** Projects listed before "Show all": the ones that cost most this month. */
const PROJECTS_SHOWN = 8;

export function BillingSettings(): JSX.Element {
  const organization = useZeropsSessionOptional()?.activeOrganization ?? null;
  const accountOrgId = useAccountDataOptional()?.orgId ?? null;
  // The data layer's organization: the session names a newly chosen one a render earlier.
  const orgId = organization !== null && organization.id === accountOrgId ? accountOrgId : null;
  return (
    <SettingsPageContainer>
      {orgId === null || organization === null ? (
        <SettingsSection title="Billing">
          <SettingsRow
            description="Billing belongs to an organization: choose one in the menu."
            title="No organization chosen"
          />
        </SettingsSection>
      ) : (
        <OrganizationBillingPage organizationName={organization.name} orgId={orgId} />
      )}
    </SettingsPageContainer>
  );
}

function OrganizationBillingPage({
  orgId,
  organizationName,
}: {
  readonly orgId: string;
  readonly organizationName: string;
}): JSX.Element {
  useDetailDemand("organizationCost", undefined, orgId);
  const billing = useAtomValue(organizationBillingAtom(orgId));
  const { addCredit } = useCreditOffers();
  const zerops = hqCreditUrl(orgId);
  const openInZerops = (label: string, variant: "primary" | "secondary") => (
    <Button render={<a href={zerops} rel="noreferrer" target="_blank" />} variant={variant}>
      {label}
      <ExternalLinkIcon aria-hidden="true" />
    </Button>
  );
  if (billing.kind === "refused") {
    return (
      <SettingsSection title="Billing">
        <SettingsRow
          description={`Zerops shows ${organizationName}'s billing only to its owners and members with finance access. Ask an owner.`}
          title="Not shared with you"
        />
      </SettingsSection>
    );
  }
  return (
    <>
      <SettingsSection
        headerAction={addCredit ? openInZerops("Top up in Zerops", "primary") : undefined}
        title="Balance"
      >
        <BalanceRows billing={billing} />
        {addCredit ? null : (
          <SettingsRow
            description="Only owners and members who manage billing top up. Ask an owner."
            title="Topping up"
          />
        )}
      </SettingsSection>
      <SpendingSection billing={billing} />
      <SettingsSection title="In Zerops">
        <SettingsRow
          control={openInZerops("Open billing in Zerops", "secondary")}
          description="Top-ups, automatic top-up, invoices, payment cards and billing details."
          title={`${organizationName} in Zerops`}
        />
      </SettingsSection>
    </>
  );
}

function Amount({ value }: { readonly value: number }): JSX.Element {
  return <span className="text-foreground text-sm tabular-nums">{formatUsd(value)}</span>;
}

function BalanceRows({ billing }: { readonly billing: OrganizationBilling }): JSX.Element {
  const balance = billing.balance;
  if (balance === null || billing.total === null) {
    return <SettingsRow description="Reading from Zerops…" title="Credit" />;
  }
  const refill = balance.autoTopUp;
  return (
    <>
      <SettingsRow
        control={
          <span className="font-semibold text-foreground text-xl tabular-nums">
            {formatUsd(billing.total)}
          </span>
        }
        description={
          balance.promoCredit > 0
            ? `${formatUsd(balance.credit)} topped up · ${formatUsd(balance.promoCredit)} promo credit, spent alike`
            : "Resources are paid from it by the hour, add-ons a month at a time."
        }
        title="Credit"
      />
      {refill !== null ? (
        <SettingsRow
          description={`Below ${formatUsd(refill.threshold)}, Zerops adds ${formatUsd(refill.amount)}, at most ${formatUsd(refill.monthlyLimit)} a month.`}
          title="Automatic top-up"
        />
      ) : billing.daysLeft !== null ? (
        <SettingsRow
          description={
            billing.total <= 0
              ? "Nothing is left: stopped projects can't start until a top-up."
              : `About ${daysWords(billing.daysLeft)} at the last 30 days' rate, with no automatic top-up.`
          }
          title="Lasts"
        />
      ) : null}
      {balance.status !== null && balance.status !== "ACTIVE" ? (
        <SettingsRow description={`Zerops says ${balance.status.toLowerCase()}.`} title="Status" />
      ) : null}
      {billing.soonest === null || billing.tone === "quiet" ? null : (
        <SoonestStop hoursLeft={billing.soonest.hoursLeft} projectId={billing.soonest.projectId} />
      )}
    </>
  );
}

function daysWords(days: number): string {
  if (days < 1) return "less than a day";
  const whole = Math.floor(days);
  return whole === 1 ? "a day" : `${String(whole)} days`;
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
  const name = project?.name ?? "A project";
  return (
    <Alert variant="warning">
      <AlertDescription>
        Zerops stops {name} {stopWords(hoursLeft)}: not enough credit.
      </AlertDescription>
    </Alert>
  );
}

const PERIODS: ReadonlyArray<{
  readonly title: string;
  readonly of: (cost: PeriodCost) => number;
}> = [
  { title: "Today", of: (cost) => cost.today },
  { title: "This month", of: (cost) => cost.thisMonth },
  { title: "Last 30 days", of: (cost) => cost.last30Days },
  { title: "A day, on average", of: (cost) => cost.perDay },
];

function SpendingSection({ billing }: { readonly billing: OrganizationBilling }): JSX.Element {
  const [all, setAll] = useState(false);
  const cost = billing.cost;
  if (cost.kind !== "known") {
    return (
      <SettingsSection title="Spending">
        <SettingsRow
          description={
            cost.kind === "refused"
              ? "Zerops didn't share what the organization spent."
              : "Reading from Zerops…"
          }
          title="Spent"
        />
      </SettingsSection>
    );
  }
  const projects = Object.entries(cost.value.projects)
    .filter(([, period]) => period.thisMonth > 0)
    .sort(([, left], [, right]) => right.thisMonth - left.thisMonth);
  const shown = all ? projects : projects.slice(0, PROJECTS_SHOWN);
  return (
    <>
      <SettingsSection title="Spending">
        {PERIODS.map((period) => (
          <SettingsRow
            control={<Amount value={period.of(cost.value.organization)} />}
            key={period.title}
            title={period.title}
          />
        ))}
      </SettingsSection>
      <SettingsSection
        count={projects.length === 0 ? undefined : projects.length}
        headerAction={
          projects.length > PROJECTS_SHOWN ? (
            <Button onClick={() => setAll(!all)} size="sm" variant="ghost">
              {all ? "Show fewer" : "Show all"}
            </Button>
          ) : undefined
        }
        title="This month by project"
      >
        {projects.length === 0 ? (
          <SettingsRow description="Nothing has cost anything this month." title="No spending" />
        ) : (
          shown.map(([projectId, period]) => (
            <ProjectSpendRow amount={period.thisMonth} key={projectId} projectId={projectId} />
          ))
        )}
      </SettingsSection>
    </>
  );
}

function ProjectSpendRow({
  projectId,
  amount,
}: {
  readonly projectId: string;
  readonly amount: number;
}): JSX.Element {
  const project = useAtomValue(listedProjectAtom(projectId));
  return (
    <SettingsRow
      control={<Amount value={amount} />}
      // A project the person no longer sees, or one deleted since, still cost what it cost.
      title={project?.name ?? "A project no longer listed"}
    />
  );
}
