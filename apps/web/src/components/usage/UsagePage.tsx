import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type UsageProviderKind } from "@t3tools/contracts";
import { InfoIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

import {
  isModelCostUnknown,
  type DailyTotals,
  type HourlyTotals,
  type ModelTotals,
} from "@t3tools/shared/usageMerge";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { shortcutLabelForCommand } from "../../keybindings";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useAgentUsage } from "../../state/usage";
import { usageNativeCosts } from "../../state/usage.logic";
import { useAtomCommand } from "../../state/use-atom-command";
import type {
  UsageEnvironmentIdentities,
  UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";
import { useUsageEnvironmentIdentities } from "../../zerops/useUsageEnvironmentIdentities";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
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
  usageDimensions,
  type UsageDimension,
  type UsageDimensions,
  type UsageScope,
} from "./usageDimensions";
import { UsageDimensionTable, UsagePeopleSplit } from "./UsageDimensionViews";
import { createUsageIdentityIndex, usagePageState } from "./usagePage.logic";
import { UsageCoverage } from "./UsageCoverage";
import { UsageLimitsSection } from "./UsageLimits";
import { UsageProviderChart } from "./UsageProviderChart";
import {
  METRIC_OPTIONS,
  WINDOW_OPTIONS,
  resolveUsageShortcut,
  type UsageMetric,
} from "./usageShortcuts";
import { modelShare, sortModelsByTokens, type UsageTotal } from "./usageBreakdown";
import { UsageModelDialog } from "./UsageModelDialog";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION, providersWithUsage } from "./usageProviders";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsagePagePreferences,
} from "./usagePagePreferences";

function isUsageMetric(value: string | null | undefined): value is UsageMetric {
  return METRIC_OPTIONS.some((option) => option.value === value);
}

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
  useEscapeToGoBack();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutOf = (option: (typeof METRIC_OPTIONS)[number] | (typeof WINDOW_OPTIONS)[number]) =>
    shortcutLabelForCommand(keybindings, option.command, { context: { usagePageOpen: true } });
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
  const [provenance, setProvenance] = useState<"live-responses" | "legacy-scanner">(
    "live-responses",
  );
  const [breakdownChoice, setBreakdown] = useState<UsageBreakdown | "auto">("auto");
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const identityRead = useUsageEnvironmentIdentities();
  const { listed, baseline, projects } = identityRead;
  const permitted = useMemo(
    () => new Set(identityRead.identities.keys()),
    [identityRead.identities],
  );
  const {
    merged,
    overall,
    read,
    report,
    overallReport,
    detailPending,
    detailUnavailable,
    stale,
    refresh,
  } = useAgentUsage(window, scope, !showingLimits, provenance);
  const { identities, labels } = useMemo(
    () =>
      createUsageIdentityIndex({
        report,
        registered: identityRead.identities,
        people: identityRead.people,
        projects,
      }),
    [identityRead.identities, identityRead.people, report, projects],
  );
  const overallIndex = useMemo(
    () =>
      createUsageIdentityIndex({
        report: overallReport,
        registered: identityRead.identities,
        people: identityRead.people,
        projects,
      }),
    [identityRead.identities, identityRead.people, overallReport, projects],
  );
  const dimensionMetric = metric === "tokens" ? "tokens" : "cost";
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
        identities: overallIndex.identities,
        labels: overallIndex.labels,
        metric: dimensionMetric,
      }),
    [dimensionMetric, overallIndex, overall.byEnvironment],
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

  const nativeCosts = usageNativeCosts(report);
  const state = usagePageState({ read, scope, projects });
  const settling = state.kind === "reading";
  const noTotals =
    state.kind === "unavailable" || state.kind === "invalid" || state.kind === "empty";
  const sessionsLabel = `${formatCount(merged.records)} ${provenance === "legacy-scanner" ? "records" : merged.records === 1 ? "turn" : "turns"}`;

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
  const [openModel, setOpenModel] = useState<ModelTotals | null>(null);
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
  const onUsageKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      isCommandPaletteOpen() ||
      isModelPickerOpen()
    )
      return;
    const command = resolveUsageShortcut(event, keybindings);
    const metricOption = METRIC_OPTIONS.find((option) => option.command === command);
    const periodOption = WINDOW_OPTIONS.find((option) => option.command === command);
    if (!metricOption && !periodOption) return;
    event.preventDefault();
    event.stopPropagation();
    if (metricOption) selectMetric(metricOption.value);
    if (periodOption && !showingLimits) selectWindow(periodOption.days);
  });
  useEffect(() => {
    globalThis.window.addEventListener("keydown", onUsageKeyDown, true);
    return () => globalThis.window.removeEventListener("keydown", onUsageKeyDown, true);
  }, []);

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
              dimensions={dimensions}
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
            identities={overallIndex.identities}
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
            <ShortcutHint key={option.value} shortcut={shortcutOf(option)}>
              <Toggle value={option.value}>{option.label}</Toggle>
            </ShortcutHint>
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
            <ShortcutHint key={option.days} shortcut={shortcutOf(option)}>
              <Toggle
                value={String(option.days)}
                disabled={provenance === "legacy-scanner" && option.days === 1}
              >
                {option.label}
              </Toggle>
            </ShortcutHint>
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
              <SelectItem
                key={option.days}
                value={String(option.days)}
                disabled={provenance === "legacy-scanner" && option.days === 1}
              >
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
            {showingLimits ? null : (
              <ToggleGroup
                aria-label="Usage history"
                variant="segmented"
                value={[provenance]}
                onValueChange={(values) => {
                  const next = values[0];
                  if (next !== "live-responses" && next !== "legacy-scanner") return;
                  if (next === "legacy-scanner" && windowDays === 1) selectWindow(7);
                  setProvenance(next);
                }}
              >
                <Toggle value="live-responses">Mate turns</Toggle>
                <Toggle value="legacy-scanner">Earlier history</Toggle>
              </ToggleGroup>
            )}
            {!showingLimits && provenance === "legacy-scanner" ? (
              <p role="status" className="text-xs text-muted-foreground">
                Earlier history uses the previous collection method and may include activity outside
                Mate. It is separate from recorded Mate turns and cannot establish exact
                consumption.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {showingLimits
                ? "Limits are account-wide subscription quotas, shared across projects and Mates. Project and owner filters do not apply."
                : "Recorded consumption by agents and subagents running in Mate. Cost is an API-equivalent estimate; attribution uses the current Mate owner."}
            </p>
            {showingLimits ? (
              baseline === "unavailable" ? (
                <p className="text-sm text-muted-foreground">
                  Usage coverage could not be read. Restore HQ access or retry the unavailable
                  source.
                </p>
              ) : (
                <UsageLimitsSection
                  now={limitsNow}
                  identities={identityRead.identities}
                  environmentIds={permitted}
                  unavailableNames={[]}
                  listed={listed && baseline === "resolved"}
                />
              )
            ) : settling ? (
              <>
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
                {report?.coverageMore || report?.groupsMore ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    This report contains more sources or groups than can be shown.
                  </p>
                ) : null}
                {read.kind === "read" && read.updateRequired ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    Update HQ to read current Mate usage. The retained report is last-known.
                  </p>
                ) : null}
                {stale ? (
                  <p className="text-xs text-muted-foreground">
                    Last-known HQ report; reconnect or refresh HQ access.
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
                            {" · API-equivalent estimate for priced usage"}
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
                                    {formatPercent(merged.costQuality.unpricedShare)} unpriced model
                                    entries.
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
                      if (totals === undefined) return null;
                      const share =
                        metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);
                      const providerSessions = totals?.sessions ?? 0;
                      const sessionLabel = `${formatCount(providerSessions)} ${provenance === "legacy-scanner" ? "records" : providerSessions === 1 ? "turn" : "turns"}`;
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
                                ? totals?.costKnown === false
                                  ? "Unpriced"
                                  : formatUsd(totals?.costUsd ?? 0)
                                : formatTokens(totals?.totalTokens ?? 0)}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {metric === "cost"
                              ? `${totals.costKnown === false ? "Unpriced" : `${formatPercent(share)} of priced cost`} · ${formatTokens(totals.totalTokens)} tokens`
                              : `${formatPercent(share)} of tokens · ${totals?.costKnown === false ? "Unpriced" : formatUsd(totals?.costUsd ?? 0)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex min-w-0 flex-col gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {isPast24Hours ? "Hourly" : "Daily"}{" "}
                      {metric === "tokens" ? "processed tokens" : "priced cost"}
                    </h2>
                    {metric === "cost" && merged.costQuality.unpricedShare === 1 ? (
                      <p className="text-sm text-muted-foreground">
                        Recorded tokens have no usable prices.
                      </p>
                    ) : (
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
                    )}
                  </div>
                </section>

                {nativeCosts.length === 0 ? null : (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium text-foreground">Provider-reported costs</h2>
                    {nativeCosts.map((cost) => (
                      <p key={cost.key} className="text-sm tabular-nums">
                        {cost.value}
                      </p>
                    ))}
                  </section>
                )}
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-foreground">Totals</h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
                    <Metric label="Processed tokens" value={formatTokens(merged.totalTokens)} />
                    <Metric
                      label="Cached input"
                      value={
                        report?.totals.unknownComponents !== "0"
                          ? "Unknown"
                          : formatTokens(merged.cachedInputTokens)
                      }
                    />
                    <Metric
                      label="Uncached input"
                      value={
                        report?.totals.unknownComponents !== "0"
                          ? "Unknown"
                          : formatTokens(merged.uncachedInputTokens)
                      }
                    />
                    <Metric
                      label="Output"
                      value={
                        report?.totals.unknownComponents !== "0"
                          ? "Unknown"
                          : formatTokens(merged.outputTokens)
                      }
                    />
                    <Metric
                      label="Cache write"
                      value={
                        report?.totals.unknownComponents !== "0"
                          ? "Unknown"
                          : formatTokens(merged.cacheCreationTokens)
                      }
                    />
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  {detailPending ? (
                    <p role="status">Reading recorded usage breakdown…</p>
                  ) : detailUnavailable ? (
                    <p role="status">Usage breakdown is unavailable. Retry HQ access.</p>
                  ) : null}
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

                  {breakdown === "model" && provenance === "live-responses" ? (
                    <p className="text-xs text-muted-foreground">
                      A turn can use several models. Each model row shows its own consumption.
                    </p>
                  ) : null}
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
                          <th className="py-2 text-right font-normal">Priced cost</th>
                          <th className="py-2 text-right font-normal">Share</th>
                          <th className="py-2 text-right font-normal">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownModels.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-muted-foreground">
                              {detailPending
                                ? "Reading model usage…"
                                : detailUnavailable
                                  ? "Model usage unavailable. Retry HQ access."
                                  : "No recorded model data."}
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
                                  <button
                                    type="button"
                                    className="flex max-w-full cursor-pointer items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
                                    aria-label={`Open ${model.model}`}
                                    onClick={() => setOpenModel(model)}
                                  >
                                    <ProviderMark provider={model.provider} className="size-3.5" />
                                    <span className="truncate">{model.model}</span>
                                  </button>
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
                          <th className="py-2 text-right font-normal">Priced cost</th>
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
                              {detailPending
                                ? "Reading model usage…"
                                : detailUnavailable
                                  ? "Model usage unavailable. Retry HQ access."
                                  : "No recorded model data."}
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
                                  {period.byProvider.get(provider) === undefined
                                    ? "No data"
                                    : period.byProvider.get(provider)?.costKnown === false
                                      ? "Unpriced"
                                      : formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}
                                </td>
                              ))}
                              <td className="py-2 text-right text-foreground tabular-nums">
                                {period.costKnown === false
                                  ? "Unpriced"
                                  : formatUsd(period.costUsd)}
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
            {!showingLimits && !settling && report !== null ? (
              <UsageCoverage report={report} labels={labels} now={Date.now()} />
            ) : null}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
      {openModel === null ? null : (
        <UsageModelDialog
          model={openModel}
          input={window}
          scope={scope}
          provenance={provenance}
          metric={dimensionMetric}
          chartWindow={{
            days,
            hours,
            resolution: isPast24Hours ? "hour" : "day",
            timeZone: window.timeZone,
            referenceTime: window.untilTime,
          }}
          onClose={() => setOpenModel(null)}
        />
      )}
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

/** The Totals row's grid, shared with the loading skeleton so nothing moves when it settles. */
const USAGE_TOTALS_GRID = "grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-4 lg:grid-cols-7";

/** The Totals the skeleton holds room for: every row but fast mode, which only some windows have. */
const USAGE_TOTAL_LABELS = [
  "Processed tokens",
  "Uncached input",
  "Cached input",
  "Cache writes",
  "Output",
  "Estimated cache savings",
] as const;

function Metric({
  label,
  value,
  detail,
}: Omit<UsageTotal, "detail"> & { readonly detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground tabular-nums">{value}</span>
      <span className="truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
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
/** A control's keyboard shortcut in a tooltip, when it has one. */
function ShortcutHint({
  shortcut,
  children,
}: {
  readonly shortcut: string | null;
  readonly children: React.ReactElement;
}) {
  if (shortcut === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="bottom">{shortcut}</TooltipPopup>
    </Tooltip>
  );
}

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
        <div className={USAGE_TOTALS_GRID}>
          {USAGE_TOTAL_LABELS.map((label) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <div className="h-6 w-16 rounded-sm bg-muted" />
              <div className="h-4 w-12 rounded-sm bg-muted/60" />
            </div>
          ))}
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
