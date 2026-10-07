import { useAtomValue } from "@effect/atom-react";
import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { CheckIcon, InfoIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  isModelCostUnknown,
  type DailyTotals,
  type HourlyTotals,
  type MergedUsage,
} from "@t3tools/shared/usageMerge";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useProviderUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { useAtomCommand } from "../../state/use-atom-command";
import type {
  UsageEnvironmentIdentities,
  UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";
import { useUsageEnvironmentIdentities } from "../../zerops/useUsageEnvironmentIdentities";
import { useUsageMates } from "../../zerops/useUsageMates";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsageContractMismatch,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { Button, InlineButton } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Avatar } from "../zerops/primitives/Avatar";
import {
  isUsageScopeEmpty,
  usageDimensions,
  usageScopeIncludes,
  type UsageDimension,
  type UsageDimensions,
  type UsageScope,
} from "./usageDimensions";
import { UsageDimensionTable, UsagePeopleSplit } from "./UsageDimensionViews";
import { usagePageState } from "./usagePage.logic";
import { UsageLimitsSection } from "./UsageLimits";
import { UsagePriceOverrides } from "./UsagePriceOverrides";
import { UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import { modelShare, sortModelsByTokens } from "./usageBreakdown";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION, providersWithUsage } from "./usageProviders";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsagePagePreferences,
} from "./usagePagePreferences";

type UsageMetric = UsageChartMetric | "limits";
const METRIC_OPTIONS = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "limits", label: "Limits" },
] as const satisfies readonly { value: UsageMetric; label: string }[];

function isUsageMetric(value: string | null | undefined): value is UsageMetric {
  return METRIC_OPTIONS.some((option) => option.value === value);
}

const WINDOW_OPTIONS = [
  { days: 1, label: "Past 24h" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

function isUsageWindowDays(value: number): value is UsagePagePreferences["windowDays"] {
  return WINDOW_OPTIONS.some((option) => option.days === value);
}

type UsageBreakdown = UsageDimension | "model" | "time";
/** Who-dimensions in the order the Breakdown toggle offers them. */
const DIMENSION_OPTIONS = [
  { value: "person", label: "Owner" },
  { value: "project", label: "Project" },
  { value: "mate", label: "Mate" },
] as const satisfies readonly { value: UsageDimension; label: string }[];
const ALL = "all";

/** "Mate · project" as the left menu reads it, else the environment's own label. */
function environmentName(
  identities: UsageEnvironmentIdentities,
  environment: { readonly environmentId: EnvironmentId; readonly label: string },
): string {
  const identity = identities.get(environment.environmentId);
  if (identity === undefined) return environment.label;
  return identity.projectName === null
    ? identity.mateName
    : `${identity.mateName} · ${identity.projectName}`;
}

function scopeOwner(
  identities: UsageEnvironmentIdentities,
  personId: string,
): UsageEnvironmentOwner | null {
  for (const identity of identities.values()) {
    if (identity.owner?.id === personId) return identity.owner;
  }
  return null;
}

function withoutScope(scope: UsageScope, dimension: UsageDimension): UsageScope {
  return {
    ...scope,
    [dimension]: undefined,
    ...(dimension === "project" ? { legacyProject: undefined } : {}),
  };
}

export function UsagePage({
  scope,
  onScopeChange,
}: {
  readonly scope: UsageScope;
  readonly onScopeChange: (scope: UsageScope) => void;
}) {
  const [preferences, setPreferences] = useState(readUsagePagePreferences);
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: preferences.windowDays,
    window: makeWindow(
      preferences.windowDays,
      undefined,
      preferences.windowDays === 1 ? "hour" : "day",
    ),
  }));
  const metric = preferences.metric;
  const showingLimits = metric === "limits";
  const [breakdownChoice, setBreakdown] = useState<UsageBreakdown | "auto">("auto");
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { identities, owners, listed, baseline, projects } = useUsageEnvironmentIdentities();
  const { person: scopePerson, project: scopeProject, mate: scopeMate } = scope;
  const include = useMemo(() => {
    const current = { person: scopePerson, project: scopeProject, mate: scopeMate };
    return isUsageScopeEmpty(current)
      ? undefined
      : (environmentId: EnvironmentId) => usageScopeIncludes(current, identities, environmentId);
  }, [identities, scopeMate, scopePerson, scopeProject]);
  const permitted = useMemo(() => new Set(identities.keys()), [identities]);
  const { merged, overall, environments, isPending, isPartial, refresh } = useProviderUsage(
    window,
    include,
    permitted,
  );
  const connected = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const mates = useUsageMates(connected, listed);
  const missingMates = mates.filter((mate) => mate.state === "missing");
  const dimensionMetric = metric === "tokens" ? "tokens" : "cost";
  const labels = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const dimensions = useMemo(
    () =>
      usageDimensions({
        byEnvironment: merged.byEnvironment,
        identities,
        labels,
        metric: dimensionMetric,
      }),
    [dimensionMetric, identities, labels, merged.byEnvironment],
  );
  // The top bar's filters choose from the whole window, not from the scope
  // they would narrow.
  const overallDimensions = useMemo(
    () =>
      usageDimensions({
        byEnvironment: overall.byEnvironment,
        identities,
        labels,
        metric: dimensionMetric,
      }),
    [dimensionMetric, identities, labels, overall.byEnvironment],
  );
  const nameOf = useCallback(
    (environment: { readonly environmentId: EnvironmentId; readonly label: string }) =>
      environmentName(identities, environment),
    [identities],
  );
  const breakdownOptions: readonly { value: UsageBreakdown; label: string }[] = [
    ...DIMENSION_OPTIONS.filter((option) => dimensions.visible[option.value]),
    { value: "model", label: "Model" },
    { value: "time", label: isPast24Hours ? "Hour" : "Day" },
  ];
  const breakdown: UsageBreakdown =
    breakdownChoice !== "auto" &&
    breakdownOptions.some((option) => option.value === breakdownChoice)
      ? breakdownChoice
      : (breakdownOptions[0]?.value ?? "model");
  const whoSummary = [
    dimensions.visible.mate ? ` · ${formatCount(dimensions.mates.length)} contributing Mates` : "",
    dimensions.visible.person
      ? ` · ${formatCount(dimensions.people.filter((person) => person.owner !== null).length)} owners`
      : "",
  ].join("");
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const scopedEnvironments = environments.filter(
    (environment) => include === undefined || include(environment.environmentId),
  );
  const usable = scopedEnvironments.filter(
    (environment) =>
      environment.summary !== null &&
      environment.summary.contractVersion === USAGE_CONTRACT_VERSION &&
      !(
        environment.summary.sources.length > 0 &&
        environment.summary.sources.every((source) => source.status === "failed")
      ),
  );
  const answered = usable.length;
  const scopedMates = mates.filter((mate) => {
    if (isUsageScopeEmpty(scope)) return true;
    const environmentId = mate.environmentId;
    // Unread membership cannot establish a scoped zero.
    return (
      environmentId === undefined ||
      !identities.has(environmentId) ||
      usageScopeIncludes(scope, identities, environmentId)
    );
  });
  const state = usagePageState({
    baseline,
    owners,
    scope,
    projects,
    listed,
    scopeKnown:
      (scopeProject === undefined || projects.has(scopeProject)) &&
      (scopePerson === undefined || scopeOwner(identities, scopePerson) !== null) &&
      (scopeMate === undefined || identities.has(scopeMate)),
    answered,
    records: merged.records,
    pending:
      scopedEnvironments.filter(
        (environment) => environment.summary === null && environment.error === null,
      ).length + scopedMates.filter((mate) => mate.state === "connecting").length,
    unavailable:
      scopedEnvironments.filter(
        (environment) =>
          environment.error !== null ||
          (environment.summary !== null && !usable.includes(environment)),
      ).length +
      scopedMates.filter((mate) => mate.state === "missing").length +
      usable.filter((environment) =>
        environment.summary?.sources.some(
          (source) =>
            source.status === "partial" ||
            source.status === "failed" ||
            source.malformedRecords > 0,
        ),
      ).length,
  });
  const settling = state.kind === "reading" || (state.kind === "partial" && merged.records === 0);
  const noTotals = state.kind === "unavailable" || state.kind === "invalid";
  const sessionsLabel = `${formatCount(merged.sessions)} ${merged.sessions === 1 ? "session" : "sessions"}`;

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const hours = useMemo(
    () =>
      window.sinceTime === undefined || window.untilTime === undefined
        ? []
        : enumerateHourStarts(window.sinceTime, window.untilTime),
    [window.sinceTime, window.untilTime],
  );
  // Newest first: the window can run 90 periods, so the interesting end
  // belongs at the top of the table.
  const breakdownPeriods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(
    () => (isPast24Hours ? merged.hourly : merged.daily).toReversed(),
    [isPast24Hours, merged.daily, merged.hourly],
  );
  const breakdownModels = useMemo(
    () =>
      breakdown === "model" && metric === "tokens"
        ? sortModelsByTokens(merged.models)
        : merged.models,
    [breakdown, merged.models, metric],
  );
  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);
  const timeValueColumnWidth = `${60 / (activeProviders.length + 2)}%`;

  const [limitsNow, setLimitsNow] = useState(() => Date.now());
  const selectWindow = (days: number) => {
    if (!isUsageWindowDays(days)) return;
    const nextPreferences = { metric, windowDays: days };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };
  const selectMetric = (nextMetric: UsageMetric) => {
    if (nextMetric === "limits") setLimitsNow(Date.now());
    const nextPreferences = { metric: nextMetric, windowDays };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };
  const refreshWindow = () => {
    if (showingLimits) {
      const refreshes: Promise<unknown>[] = [];
      for (const [environmentId, presentation] of presentations) {
        if (
          permitted.has(environmentId) &&
          presentation.connection.phase === "connected" &&
          presentation.serverConfig !== null
        ) {
          refreshes.push(refreshProviders({ environmentId, input: {} }));
        }
      }
      void Promise.allSettled(refreshes).then(() => {
        setLimitsNow(Date.now());
      });
      return;
    }
    const nextWindow = makeWindow(windowDays, undefined, isPast24Hours ? "hour" : "day");
    if (
      nextWindow.sinceDay === window.sinceDay &&
      nextWindow.untilDay === window.untilDay &&
      nextWindow.sinceTime === window.sinceTime &&
      nextWindow.untilTime === window.untilTime
    ) {
      refresh();
    } else {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
  };
  const windowLabel =
    isPast24Hours && window.sinceTime !== undefined && window.untilTime !== undefined
      ? `${formatDateTimeShort(window.sinceTime, window.timeZone)} to ${formatDateTimeShort(window.untilTime, window.timeZone)}`
      : `${formatDayShort(window.sinceDay)} to ${formatDayShort(window.untilDay)}`;
  const topbarContent = (
    <div className="flex w-full min-w-0 items-center gap-3">
      <WorkspaceBreadcrumb ariaLabel="Usage breadcrumb" className="min-w-0">
        <WorkspaceBreadcrumbItem current>
          <h1>Usage</h1>
        </WorkspaceBreadcrumbItem>
        {showingLimits ? null : (
          <>
            <WorkspaceBreadcrumbSeparator className="hidden md:flex" />
            <WorkspaceBreadcrumbItem className="hidden min-w-0 shrink md:flex">
              <span className="truncate">{windowLabel}</span>
            </WorkspaceBreadcrumbItem>
            <UsageScopeChips
              scope={scope}
              identities={identities}
              projects={projects}
              dimensions={overallDimensions}
              labels={labels}
              onScopeChange={onScopeChange}
            />
          </>
        )}
      </WorkspaceBreadcrumb>
      <div className="ms-auto hidden min-w-0 items-center justify-end gap-2 lg:flex">
        {showingLimits ? null : (
          <UsageScopeFilters
            scope={scope}
            identities={identities}
            projects={projects}
            dimensions={overallDimensions}
            onScopeChange={onScopeChange}
          />
        )}
        <ToggleGroup
          aria-label="Usage metric"
          variant="segmented"
          value={[metric]}
          onValueChange={(next) => {
            const value = next[0];
            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          {METRIC_OPTIONS.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
        {/* The period does not apply to Limits, so it stays in place but
            disabled; unmounting it shifted the metric toggle ~300px. */}
        <ToggleGroup
          aria-label="Usage period"
          variant="segmented"
          value={[String(windowDays)]}
          disabled={showingLimits}
          onValueChange={(next) => {
            const value = next[0];
            if (value) selectWindow(Number(value));
          }}
        >
          {WINDOW_OPTIONS.map((option) => (
            <Toggle key={option.days} value={String(option.days)}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
        <Button
          onClick={refreshWindow}
          aria-label={showingLimits ? "Refresh limits" : "Refresh usage"}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      <div className="ms-auto flex min-w-0 items-center justify-end gap-1 lg:hidden">
        <Select
          value={metric}
          onValueChange={(value) => {
            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          <SelectTrigger
            aria-label="Usage metric"
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>
              {METRIC_OPTIONS.find((option) => option.value === metric)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {METRIC_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={String(windowDays)}
          disabled={showingLimits}
          onValueChange={(value) => selectWindow(Number(value))}
        >
          <SelectTrigger
            aria-label="Usage period"
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>
              {WINDOW_OPTIONS.find((option) => option.days === windowDays)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WINDOW_OPTIONS.map((option) => (
              <SelectItem key={option.days} value={String(option.days)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          onClick={refreshWindow}
          aria-label={showingLimits ? "Refresh limits" : "Refresh usage"}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>{topbarContent}</WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {missingMates.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Not connected, so not counted: {missingMates.map((mate) => mate.name).join(", ")}.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {showingLimits
                ? "Limits are account-wide subscription quotas, shared across projects and Mates. Project and owner filters do not apply."
                : "Agent API-equivalent usage estimate from transcript snapshots; not subscription payments or Zerops resource charges. Attribution uses the current Mate owner."}
            </p>
            {!showingLimits ? (
              <div className="flex justify-end">
                <UsagePriceOverrides usage={environments} />
              </div>
            ) : null}
            {!showingLimits ? (
              <UsageCoverageNotice
                environments={scopedEnvironments}
                nameOf={nameOf}
                duplicateSources={merged.duplicateSources}
                contractMismatches={merged.contractMismatches}
              />
            ) : null}
            {showingLimits ? (
              baseline === "unavailable" ? (
                <p className="text-sm text-muted-foreground">
                  Usage coverage could not be read. Restore HQ access or retry the unavailable
                  source.
                </p>
              ) : (
                <UsageLimitsSection
                  now={limitsNow}
                  identities={identities}
                  environmentIds={permitted}
                  unavailableNames={missingMates.map((mate) => mate.name)}
                  listed={listed && baseline === "resolved"}
                />
              )
            ) : settling ? (
              <>
                {(isPending || isPartial) && environments.length > 1 ? (
                  <UsageDeviceStrip environments={environments} nameOf={nameOf} />
                ) : null}
                <p role="status" className="text-sm text-muted-foreground">
                  {state.message ??
                    "No activity has been confirmed yet; Usage coverage is incomplete."}
                </p>
                <UsageSkeleton />
              </>
            ) : noTotals ? (
              <p className="text-sm text-muted-foreground">{state.message}</p>
            ) : (
              <>
                {state.kind === "partial" ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    Partial snapshot: {answered} of{" "}
                    {Math.max(scopedMates.length, scopedEnvironments.length)} scoped Mates answered;{" "}
                    {state.kind === "partial" && !listed
                      ? "discovery is incomplete"
                      : "some sources are pending or unavailable"}
                    .
                  </p>
                ) : null}
                {scopedEnvironments.some((environment) => environment.isStale) ? (
                  <p className="text-xs text-muted-foreground">
                    Retained snapshot from disconnected Mates; refresh after reconnecting.
                  </p>
                ) : null}

                <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                  <div className="flex min-w-0 flex-col gap-5">
                    <div className="flex flex-col gap-1">
                      <span className="text-4xl font-semibold text-foreground tabular-nums">
                        {metric === "cost"
                          ? merged.costQuality.unpricedShare === 1
                            ? "Unpriced"
                            : formatUsd(merged.costUsd)
                          : formatTokens(merged.totalTokens)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {sessionsLabel}
                        {metric === "cost" && (
                          <>
                            {" · API-equivalent estimate"}
                            {merged.costQuality.unpricedShare > 0 && (
                              <>
                                {" "}
                                <Popover>
                                  <PopoverTrigger
                                    openOnHover
                                    render={<InlineButton tone="muted" />}
                                    aria-label="Unpriced usage details"
                                  >
                                    <InfoIcon className="size-3" aria-hidden />
                                  </PopoverTrigger>
                                  <PopoverPopup side="top" tooltipStyle>
                                    API-equivalent estimate excludes{" "}
                                    {formatPercent(merged.costQuality.unpricedShare)} unpriced
                                    records.
                                  </PopoverPopup>
                                </Popover>
                              </>
                            )}
                          </>
                        )}
                        {whoSummary}
                      </span>
                    </div>

                    {dimensions.visible.person ? (
                      <UsagePeopleSplit people={dimensions.people} metric={dimensionMetric} />
                    ) : null}

                    {activeProviders.map((provider) => {
                      const totals = merged.providers.find((entry) => entry.provider === provider);
                      const share =
                        metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);
                      const providerSessions = totals?.sessions ?? 0;
                      const sessionLabel = `${formatCount(providerSessions)} ${
                        providerSessions === 1 ? "session" : "sessions"
                      }`;
                      return (
                        <div key={provider} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: PROVIDER_PRESENTATION[provider].color,
                                }}
                              />
                              <ProviderMark provider={provider} className="size-4" />
                              <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="truncate">
                                  {PROVIDER_PRESENTATION[provider].label}
                                </span>
                                <span className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground tabular-nums">
                                  {sessionLabel}
                                </span>
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                              {metric === "cost"
                                ? formatUsd(totals?.costUsd ?? 0)
                                : formatTokens(totals?.totalTokens ?? 0)}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {metric === "cost"
                              ? `${formatPercent(share)} of cost · ${formatTokens(totals?.totalTokens ?? 0)} tokens`
                              : `${formatPercent(share)} of tokens · ${formatUsd(totals?.costUsd ?? 0)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex min-w-0 flex-col gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {isPast24Hours ? "Hourly" : "Daily"}{" "}
                      {metric === "tokens" ? "processed tokens" : "cost"}
                    </h2>
                    <UsageProviderChart
                      providers={activeProviders}
                      days={days}
                      daily={merged.daily}
                      hours={hours}
                      hourly={merged.hourly}
                      metric={metric}
                      referenceTime={window.untilTime}
                      resolution={isPast24Hours ? "hour" : "day"}
                      timeZone={window.timeZone}
                    />
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-foreground">Totals</h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
                    <Metric label="Processed tokens" value={formatTokens(merged.totalTokens)} />
                    <Metric label="Cached input" value={formatTokens(merged.cachedInputTokens)} />
                    <Metric
                      label="Uncached input"
                      value={formatTokens(merged.uncachedInputTokens)}
                    />
                    <Metric label="Output" value={formatTokens(merged.outputTokens)} />
                    <Metric
                      label="Estimated cache savings"
                      value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                    />
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium text-foreground">Breakdown</h2>
                    <ToggleGroup
                      aria-label="Usage breakdown"
                      variant="segmented"
                      value={[breakdown]}
                      onValueChange={(next) => {
                        const option = breakdownOptions.find((entry) => entry.value === next[0]);
                        if (option !== undefined) setBreakdown(option.value);
                      }}
                    >
                      {breakdownOptions.map((option) => (
                        <Toggle key={option.value} value={option.value}>
                          {option.label}
                        </Toggle>
                      ))}
                    </ToggleGroup>
                  </div>

                  {breakdown === "person" || breakdown === "project" || breakdown === "mate" ? (
                    <UsageDimensionTable
                      dimension={breakdown}
                      dimensions={dimensions}
                      metric={dimensionMetric}
                      scope={scope}
                      onScopeChange={onScopeChange}
                    />
                  ) : breakdown === "model" ? (
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-2/5" />
                        <col className="w-1/5" />
                        <col className="w-1/5" />
                        <col className="w-1/5" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="py-2 font-normal">Model</th>
                          <th className="py-2 text-right font-normal">Cost</th>
                          <th className="py-2 text-right font-normal">Share</th>
                          <th className="py-2 text-right font-normal">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownModels.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-muted-foreground">
                              {state.kind === "partial"
                                ? "No activity in the answered sources yet."
                                : "No activity in this window."}
                            </td>
                          </tr>
                        ) : (
                          breakdownModels.map((model) => {
                            const share = modelShare(model, dimensionMetric);
                            return (
                              <tr
                                key={`${model.provider}:${model.model}`}
                                className="border-b border-border/50 transition-colors hover:bg-muted/50"
                              >
                                <td className="py-2 text-foreground">
                                  <span className="flex items-center gap-2">
                                    <ProviderMark provider={model.provider} className="size-3.5" />
                                    {model.model}
                                  </span>
                                </td>
                                <td className="py-2 text-right text-foreground tabular-nums">
                                  {isModelCostUnknown(model) ? (
                                    <span className="text-muted-foreground">Unpriced</span>
                                  ) : (
                                    formatUsd(model.costUsd)
                                  )}
                                </td>
                                <td className="py-2 text-right text-muted-foreground tabular-nums">
                                  {share === null ? "—" : formatPercent(share)}
                                </td>
                                <td className="py-2 text-right text-muted-foreground tabular-nums">
                                  {formatTokens(model.totalTokens)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-2/5" />
                        {activeProviders.map((provider) => (
                          <col key={provider} style={{ width: timeValueColumnWidth }} />
                        ))}
                        <col style={{ width: timeValueColumnWidth }} />
                        <col style={{ width: timeValueColumnWidth }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="py-2 font-normal">{isPast24Hours ? "Hour" : "Day"}</th>
                          {activeProviders.map((provider) => (
                            <th key={provider} className="py-2 text-right font-normal">
                              {PROVIDER_PRESENTATION[provider].label}
                            </th>
                          ))}
                          <th className="py-2 text-right font-normal">Total</th>
                          <th className="py-2 text-right font-normal">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownPeriods.length === 0 ? (
                          <tr>
                            <td
                              colSpan={activeProviders.length + 3}
                              className="py-6 text-center text-muted-foreground"
                            >
                              {state.kind === "partial"
                                ? "No activity in the answered sources yet."
                                : "No activity in this window."}
                            </td>
                          </tr>
                        ) : (
                          breakdownPeriods.map((period) => (
                            <tr
                              key={"hourStart" in period ? period.hourStart : period.day}
                              className="border-b border-border/50 transition-colors hover:bg-muted/50"
                            >
                              <td className="py-2 text-foreground">
                                {"hourStart" in period
                                  ? formatHourShort(period.hourStart, window.timeZone)
                                  : formatDayShort(period.day)}
                              </td>
                              {activeProviders.map((provider) => (
                                <td
                                  key={provider}
                                  className="py-2 text-right text-muted-foreground tabular-nums"
                                >
                                  {formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}
                                </td>
                              ))}
                              <td className="py-2 text-right text-foreground tabular-nums">
                                {formatUsd(period.costUsd)}
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {formatTokens(period.totalTokens)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </section>
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_PRESENTATION[provider].mark;
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Labels sampled read times and incomplete scan, pricing and environment coverage.
 */
function UsageCoverageNotice({
  environments,
  nameOf,
  duplicateSources,
  contractMismatches,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly nameOf: (environment: EnvironmentUsageStatus) => string;
  readonly duplicateSources: readonly string[];
  readonly contractMismatches: MergedUsage["contractMismatches"];
}) {
  const degraded = environments.filter(
    (environment) =>
      environment.summary !== null &&
      (environment.summary.sources.some(
        (source) =>
          source.status === "partial" || source.status === "failed" || source.malformedRecords > 0,
      ) ||
        environment.summary.pricing.status !== "fresh"),
  );
  const failed = environments.filter((environment) => environment.error !== null);
  const mismatchByEnvironment = new Map(
    contractMismatches.map((mismatch) => [mismatch.environmentId, mismatch]),
  );
  const incompatible = environments.flatMap((environment) => {
    const mismatch = mismatchByEnvironment.get(environment.environmentId);
    return mismatch === undefined ? [] : [{ environment, mismatch }];
  });
  if (
    environments.every((environment) => environment.summary === null) &&
    failed.length === 0 &&
    incompatible.length === 0 &&
    duplicateSources.length === 0
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border border-border px-3 py-2 text-xs text-muted-foreground">
      {degraded.map((environment) => (
        <span key={`scan:${environment.environmentId}`}>
          {nameOf(environment)}: transcript scan or pricing coverage is incomplete (pricing{" "}
          {environment.summary?.pricing.status}).
        </span>
      ))}
      {failed.map((environment) => (
        <span key={environment.environmentId}>{nameOf(environment)} could not report usage.</span>
      ))}
      {environments
        .filter((environment) => environment.summary !== null)
        .map((environment) => (
          <span key={`read:${environment.environmentId}`}>
            {nameOf(environment)} snapshot read at {environment.summary?.readAt}.
          </span>
        ))}
      {incompatible.map(({ environment, mismatch }) => (
        <span key={environment.environmentId}>
          {formatUsageContractMismatch(nameOf(environment), mismatch)}
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Counted once across environments sharing a transcript directory:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-device progress while the page waits for every environment to answer.
 * Only rendered with two or more devices; a lone device has nothing to
 * enumerate.
 */
function UsageDeviceStrip({
  environments,
  nameOf,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly nameOf: (environment: EnvironmentUsageStatus) => string;
}) {
  const scanning = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  );
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border border-border px-3 py-2 text-xs">
      {environments.map((environment) => {
        if (environment.summary !== null && !environment.isStale) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-foreground"
            >
              <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-300/90" aria-hidden />
              {nameOf(environment)}
            </span>
          );
        }
        if (environment.isStale) {
          return (
            <span key={environment.environmentId} className="text-muted-foreground">
              {nameOf(environment)} · last reported
            </span>
          );
        }
        if (environment.error !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-destructive"
            >
              <XIcon className="size-3" aria-hidden />
              {nameOf(environment)}
            </span>
          );
        }
        return (
          <span
            key={environment.environmentId}
            className="animate-status-pulse text-muted-foreground"
          >
            {nameOf(environment)}…
          </span>
        );
      })}
      <span className="ms-auto text-muted-foreground">
        {scanning.length === 1
          ? "1 device still scanning"
          : `${scanning.length} devices still scanning`}
      </span>
    </div>
  );
}

/** The active scope as breadcrumb chips, each with its own clear button. */
function UsageScopeChips({
  scope,
  identities,
  projects,
  dimensions,
  labels,
  onScopeChange,
}: {
  readonly scope: UsageScope;
  readonly identities: UsageEnvironmentIdentities;
  readonly projects: ReadonlyMap<string, string>;
  readonly dimensions: UsageDimensions;
  readonly labels: ReadonlyMap<EnvironmentId, string>;
  readonly onScopeChange: (scope: UsageScope) => void;
}) {
  const chips: { dimension: UsageDimension; label: string; owner: UsageEnvironmentOwner | null }[] =
    [];
  if (scope.person !== undefined) {
    const owner = scopeOwner(identities, scope.person);
    chips.push({ dimension: "person", label: owner?.name ?? scope.person, owner });
  }
  if (scope.project !== undefined || scope.legacyProject !== undefined) {
    chips.push({
      dimension: "project",
      label:
        scope.legacyProject ??
        projects.get(scope.project ?? "") ??
        scope.project ??
        "Unknown project",
      owner: null,
    });
  }
  if (scope.mate !== undefined) {
    const mate = dimensions.mates.find((row) => row.environmentId === scope.mate);
    chips.push({
      dimension: "mate",
      label: mate?.mateName ?? labels.get(scope.mate) ?? scope.mate,
      owner: null,
    });
  }
  return chips.map((chip) => (
    <span key={chip.dimension} className="contents">
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem className="min-w-0 shrink">
        <span className="flex min-w-0 items-center gap-1.5 text-foreground">
          {chip.owner === null ? null : (
            <Avatar initials={chip.owner.initials} size="xs" src={chip.owner.avatarUrl} />
          )}
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={`Clear ${chip.dimension} filter`}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onScopeChange(withoutScope(scope, chip.dimension))}
          >
            <XIcon className="size-3" aria-hidden />
          </button>
        </span>
      </WorkspaceBreadcrumbItem>
    </span>
  ));
}

/**
 * Owners are current attribution; project choices come from HQ identity rather than activity.
 */
function UsageScopeFilters({
  scope,
  identities,
  projects,
  dimensions,
  onScopeChange,
}: {
  readonly scope: UsageScope;
  readonly identities: UsageEnvironmentIdentities;
  readonly projects: ReadonlyMap<string, string>;
  readonly dimensions: UsageDimensions;
  readonly onScopeChange: (scope: UsageScope) => void;
}) {
  const people = dimensions.people.flatMap((person) =>
    person.owner === null ? [] : [{ value: person.owner.id, label: person.owner.name }],
  );
  const projectOptions = [...projects].map(([id, name]) => ({
    value: id,
    label:
      [...projects.values()].filter((other) => other === name).length > 1
        ? `${name} (${id})`
        : name,
  }));
  const filters = [
    ...(dimensions.visible.person
      ? [{ dimension: "person" as const, all: "All owners", options: people }]
      : []),
    ...(projects.size > 1 || scope.project !== undefined || scope.legacyProject !== undefined
      ? [{ dimension: "project" as const, all: "All projects", options: projectOptions }]
      : []),
  ];
  return filters.map((filter) => {
    const value = scope[filter.dimension] ?? ALL;
    const options =
      value === ALL || filter.options.some((option) => option.value === value)
        ? filter.options
        : [
            ...filter.options,
            {
              value,
              label:
                filter.dimension === "person"
                  ? (scopeOwner(identities, value)?.name ?? value)
                  : (projects.get(value) ?? value),
            },
          ];
    return (
      <Select
        key={filter.dimension}
        value={value}
        onValueChange={(next) => {
          onScopeChange(
            next === ALL || next === null
              ? withoutScope(scope, filter.dimension)
              : {
                  ...scope,
                  ...(filter.dimension === "project" ? { legacyProject: undefined } : {}),
                  [filter.dimension]: next,
                },
          );
        }}
      >
        <SelectTrigger
          aria-label={`Usage ${filter.dimension}`}
          size="compact"
          variant="ghost"
          className="w-auto min-w-0"
        >
          <SelectValue>
            {options.find((option) => option.value === value)?.label ?? filter.all}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          <SelectItem value={ALL}>{filter.all}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  });
}

/**
 * Static stand-in with the loaded page's shape. No shimmer; blocks fill in
 * exactly once when the last device answers.
 */
function UsageSkeleton() {
  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <div className="h-10 w-36 rounded-sm bg-muted" />
            <div className="h-4 w-32 rounded-sm bg-muted" />
          </div>
          {PROVIDER_ORDER.map((provider) => (
            <div key={provider} className="flex flex-col gap-1">
              <div className="flex min-h-5 items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-muted" />
                  <span className="size-4 shrink-0 rounded-full bg-muted" />
                  <div className="h-3.5 w-20 rounded-sm bg-muted" />
                </span>
                <div className="h-3.5 w-14 rounded-sm bg-muted" />
              </div>
              <div className="h-4 w-36 rounded-sm bg-muted" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <div className="h-5 w-24 rounded-sm bg-muted" />
          <div className="flex flex-col gap-1">
            <div className="ml-16 h-56 rounded-sm bg-muted/35" />
            <div className="ml-16 h-4 rounded-sm bg-muted/35" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Totals</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
          {["Processed tokens", "Cached input", "Uncached input", "Output", "Cache savings"].map(
            (label) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{label}</span>
                <div className="h-6 w-16 rounded-sm bg-muted" />
              </div>
            ),
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">Breakdown</h2>
          <div className="h-7 w-28 rounded-lg bg-input/40" />
        </div>
        <div className="h-44 rounded-sm bg-muted/35" />
      </section>
    </>
  );
}
