import { Alert } from "~/components/ui/alert";
import { CollectionRead } from "../CollectionRead";
import { ProcessSignalActions } from "./ProcessSignalActions";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ServerProcessDiagnosticsEntry,
  ServerProcessResourceHistorySummary,
  ServerProcessSignal,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { formatRelativeTimeLabel, getRelativeTimeState } from "../../timestampFormat";
import { useSecondsNowMs } from "../../zerops/useNowMs";
import { collectionPresentation, useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { useEnvironment } from "../../state/environments";
import { useLastRouteEnvironmentId } from "../../zerops/accountEnvironments";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Badge } from "../ui/badge";
import { ChartPlot, ChartReadout, ChartReadoutRow } from "../ui/chart";
import { Button, InlineButton } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "~/lib/toasts";
import { EmptyState } from "../ui/empty";
import { Loading } from "../ui/loading";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useAtomCommand } from "../../state/use-atom-command";
import { Text } from "~/components/ui/text";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Separator } from "~/components/ui/separator";

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatRelative(value: DateTime.Utc | null): string {
  if (!value) return "No trace records";
  return formatRelativeTimeLabel(DateTime.formatIso(value));
}

function formatRelativeNoWrap(value: DateTime.Utc | null): string {
  return formatRelative(value).replaceAll(" ", "\u00a0");
}

function shortenTraceId(traceId: string): string {
  if (traceId.length <= 32) return traceId;
  return `${traceId.slice(0, 18)}...${traceId.slice(-10)}`;
}

function isStaleProcessSignalMessage(message: string | undefined): boolean {
  return message?.includes("not a live descendant") ?? false;
}

function StatBlock({
  label,
  value,
  tooltip,
  tone = "default",
}: {
  label: string;
  /** `null` while it is on its way: a stand-in at the figure's size. */
  value: string | null;
  tooltip?: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="min-w-0 border-border/60 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-2xs font-medium uppercase tracking-widest text-muted-foreground/70">
        <span className="min-w-0 truncate">{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <InlineButton aria-label={`${label} details`} tone="muted">
                  <InfoIcon className="size-3" />
                </InlineButton>
              }
            />
            <TooltipPopup side="top">{tooltip}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-title font-semibold tabular-nums text-foreground",
          tone === "warning" && "text-warning-foreground",
          tone === "danger" && "text-status-failed-text",
        )}
      >
        {value ?? <Skeleton aria-label={label} className="my-1.5 h-4 w-16" role="status" />}
      </div>
    </div>
  );
}

function StatsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid grid-cols-2 sm:grid-cols-4">
      <span
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border/60"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border/60 sm:hidden"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-1/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-3/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      {children}
    </div>
  );
}

/** A diagnostics table's rows while they are read, or the one line saying there are none. */
function RowsOrNone({ reading, label, none }: { reading: boolean; label: string; none: string }) {
  return (
    <div className="px-4 py-2 sm:px-5">
      {reading ? (
        <Loading count={3} label={label} shape="lines" />
      ) : (
        <EmptyState size="row">{none}</EmptyState>
      )}
    </div>
  );
}

function ExpandableText({
  text,
  className,
  collapsedClassName = "line-clamp-3",
  expandLabel = "Show full error",
}: {
  text: string;
  className?: string;
  collapsedClassName?: string;
  expandLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 180 || text.includes("\n");

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "whitespace-pre-wrap break-words",
          !expanded && canExpand ? collapsedClassName : null,
        )}
      >
        {text}
      </div>
      {canExpand ? (
        <InlineButton className="mt-1" tone="muted" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : expandLabel}
        </InlineButton>
      ) : null}
    </div>
  );
}

function DiagnosticsTable({
  headers,
  children,
  minTableWidth = "min-w-[640px]",
  columnWidths,
}: {
  headers: ReadonlyArray<string>;
  children: ReactNode;
  minTableWidth?: string;
  columnWidths?: ReadonlyArray<string>;
}) {
  return (
    <ScrollArea
      radius="none"
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="w-full max-w-full"
    >
      <div className={minTableWidth}>
        <Table className={columnWidths ? "table-fixed" : undefined} size="report">
          {columnWidths ? (
            <colgroup>
              {headers.map((header, index) => (
                <col key={header} className={columnWidths[index]} />
              ))}
            </colgroup>
          ) : null}
          <TableHeader>
            <TableRow>
              {headers.map((header, index) => (
                <TableHead
                  className={!columnWidths && index === headers.length - 1 ? "w-px" : undefined}
                  key={header}
                >
                  {header.replaceAll(" ", "\u00a0")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
    </ScrollArea>
  );
}

function TraceIdCell({ traceId }: { traceId: string }) {
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard({
    target: "trace ID",
    timeout: 1_200,
  });

  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 truncate font-mono text-2xs">
              {shortenTraceId(traceId)}
            </span>
          }
        />
        <TooltipPopup side="top" variant="code">
          {traceId}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={copied ? "Copied trace ID" : "Copy trace ID"}
              onClick={() => copyToClipboard(traceId)}
            >
              <CopyIcon />
            </Button>
          }
        />
        <TooltipPopup side="top">{copied ? "Copied" : "Copy full trace ID"}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function formatProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function formatProcessType(process: ServerProcessDiagnosticsEntry): string {
  if (process.depth > 0) return "Subprocess";
  if (/\b(codex|claude|opencode|cursor)\b/i.test(process.command)) return "Agent";
  return "Process";
}

function ProcessNameCell({
  process,
  isExpanded,
  onToggle,
}: {
  process: ServerProcessDiagnosticsEntry;
  isExpanded: boolean;
  onToggle: (pid: number) => void;
}) {
  const name = formatProcessName(process.command);
  const hasChildren = process.childPids.length > 0;
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.5rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(process.depth, 6) * 10}px` }}
    >
      {hasChildren ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => onToggle(process.pid)}
        >
          <ChevronIcon className="size-3.5" />
        </Button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
      <Badge aria-label="Running" dot tone="success" />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup side="top" variant="code">
          {process.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessDiagnosticsTable({
  processes,
  signalingPid,
  onSignal,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
  signalingPid: number | null;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
  emptyLabel?: string;
}) {
  const [collapsedPids, setCollapsedPids] = useState<ReadonlySet<number>>(() => new Set());
  const visibleProcesses = useMemo(() => {
    const visible: ServerProcessDiagnosticsEntry[] = [];
    let hiddenChildDepth: number | null = null;

    for (const process of processes) {
      if (hiddenChildDepth !== null) {
        if (process.depth > hiddenChildDepth) continue;
        hiddenChildDepth = null;
      }

      visible.push(process);
      if (collapsedPids.has(process.pid)) {
        hiddenChildDepth = process.depth;
      }
    }

    return visible;
  }, [collapsedPids, processes]);

  const toggleProcess = useCallback((pid: number) => {
    setCollapsedPids((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  }, []);

  return (
    <>
      <Separator />
      <div>
        <ScrollArea
          radius="none"
          chainVerticalScroll
          scrollFade
          hideScrollbars
          className="max-h-[min(64vh,44rem)] w-full max-w-full"
        >
          <Table className="min-w-[1040px] table-fixed" size="report">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[33%]" />
              <col className="w-[8%]" />
              <col className="w-[11%]" />
              <col className="w-[6%]" />
            </colgroup>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead align="end">CPU</TableHead>
                <TableHead align="end">Memory</TableHead>
                <TableHead>Command</TableHead>
                <TableHead align="end">PID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead align="end">Kill</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProcesses.length === 0 ? (
                <TableRow>
                  <Text className="px-4 py-4 sm:px-5" render={<td colSpan={7} />} variant="note">
                    {emptyLabel ?? "No live descendant processes found."}
                  </Text>
                </TableRow>
              ) : null}
              {visibleProcesses.map((process) => (
                <TableRow key={process.pid}>
                  <TableCell>
                    <ProcessNameCell
                      process={process}
                      isExpanded={!collapsedPids.has(process.pid)}
                      onToggle={toggleProcess}
                    />
                  </TableCell>
                  <TableCell align="end">
                    <Text variant="code">{process.cpuPercent.toFixed(1)}%</Text>
                  </TableCell>
                  <TableCell align="end">
                    <Text variant="code">{formatBytes(process.rssBytes)}</Text>
                  </TableCell>
                  <TableCell tone="muted">
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className="block truncate">{process.command}</span>}
                      />
                      <TooltipPopup side="top" variant="code">
                        {process.command}
                      </TooltipPopup>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="end" tone="muted">
                    <Text variant="code">{process.pid}</Text>
                  </TableCell>
                  <TableCell tone="muted">
                    <span className="block truncate">{formatProcessType(process)}</span>
                  </TableCell>
                  <TableCell>
                    <ProcessSignalActions
                      disabled={signalingPid === process.pid}
                      onSignal={(signal) => onSignal(process.pid, signal)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </>
  );
}

const RESOURCE_HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 30_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 60_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 2 * 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 5 * 60_000 },
] as const;

function formatCpuTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

function formatShortProcessName(command: string): string {
  const name = formatProcessName(command);
  return name.length > 42 ? `${name.slice(0, 39)}...` : name;
}

function ResourceHistoryProcessNameCell({
  process,
  visualDepth,
}: {
  process: ServerProcessResourceHistorySummary;
  visualDepth: number;
}) {
  const name = formatShortProcessName(process.command);

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(visualDepth, 6) * 10}px` }}
      aria-label={`${process.isServerRoot ? "Root" : "Child"} process ${name}`}
    >
      <span className="size-5 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          process.isServerRoot ? "bg-warning/90" : "bg-success/80",
        )}
      />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup side="top" variant="code">
          {process.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** A bucket's CPU: its average in the foreground's ink, its peak a faint column behind it. */
const CPU_AVERAGE = "color-mix(in oklab, var(--color-foreground) 60%, transparent)";
const CPU_PEAK = "color-mix(in oklab, var(--color-foreground) 15%, transparent)";

function ProcessResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<{
    readonly startedAt: DateTime.Utc;
    readonly avgCpuPercent: number;
    readonly maxCpuPercent: number;
  }>;
}) {
  const maxCpuPercent = Math.max(1, ...buckets.map((bucket) => bucket.maxCpuPercent));

  return (
    <>
      <Separator />
      <div className="px-4 py-3 sm:px-5">
        <ChartPlot className="h-28">
          {buckets.map((bucket) => {
            const peakHeight = Math.max(2, (bucket.maxCpuPercent / maxCpuPercent) * 100);
            const averageHeight = Math.max(2, (bucket.avgCpuPercent / maxCpuPercent) * 100);
            return (
              <Tooltip key={DateTime.formatIso(bucket.startedAt)}>
                <TooltipTrigger
                  render={
                    <div className="flex h-full min-w-1 flex-1 items-end">
                      <div
                        className="relative h-full w-full"
                        aria-label={`Average CPU ${bucket.avgCpuPercent.toFixed(1)}%, peak CPU ${bucket.maxCpuPercent.toFixed(1)}%`}
                      >
                        <div
                          className="absolute inset-x-0 bottom-0 rounded-t-mark transition-colors"
                          style={{ height: `${peakHeight}%`, backgroundColor: CPU_PEAK }}
                        />
                        <div
                          className="absolute inset-x-0 bottom-0 rounded-t-mark transition-colors"
                          style={{ height: `${averageHeight}%`, backgroundColor: CPU_AVERAGE }}
                        />
                      </div>
                    </div>
                  }
                />
                <TooltipPopup side="top">
                  <ChartReadout>
                    <ChartReadoutRow
                      color={CPU_AVERAGE}
                      label="CPU average"
                      value={`${bucket.avgCpuPercent.toFixed(1)}%`}
                    />
                    <ChartReadoutRow
                      color={CPU_PEAK}
                      label="CPU peak"
                      value={`${bucket.maxCpuPercent.toFixed(1)}%`}
                    />
                  </ChartReadout>
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </ChartPlot>
      </div>
    </>
  );
}

function ResourceHistoryWindowSelector({
  selectedWindowMs,
  onSelect,
}: {
  selectedWindowMs: number;
  onSelect: (windowMs: number) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Process history period"
      variant="segmented"
      value={[String(selectedWindowMs)]}
      onValueChange={(next) => {
        const selected = RESOURCE_HISTORY_WINDOWS.find(
          (option) => String(option.windowMs) === next[0],
        );
        if (selected) onSelect(selected.windowMs);
      }}
    >
      {RESOURCE_HISTORY_WINDOWS.map((option) => (
        <Toggle key={option.windowMs} value={String(option.windowMs)}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function ProcessResourceHistoryTable({
  processes,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessResourceHistorySummary>;
  emptyLabel: string;
}) {
  const shallowestChildDepth = processes.reduce<number | null>((minDepth, process) => {
    if (process.isServerRoot) return minDepth;
    return minDepth === null ? process.depth : Math.min(minDepth, process.depth);
  }, null);

  return (
    <>
      <Separator />
      <div>
        <ScrollArea
          chainVerticalScroll
          scrollFade
          hideScrollbars
          className="max-h-[min(64vh,44rem)] w-full max-w-full"
        >
          <Table className="min-w-[980px] table-fixed" size="report">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
            </colgroup>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Process</TableHead>
                <TableHead align="end">CPU Time</TableHead>
                <TableHead align="end">Current</TableHead>
                <TableHead align="end">Average</TableHead>
                <TableHead align="end">Peak</TableHead>
                <TableHead align="end">Max Mem</TableHead>
                <TableHead>Command</TableHead>
                <TableHead align="end">PID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processes.length === 0 ? (
                <TableRow>
                  <Text className="px-4 py-4 sm:px-5" render={<td colSpan={8} />} variant="note">
                    {emptyLabel}
                  </Text>
                </TableRow>
              ) : null}
              {processes.map((process) => (
                <TableRow key={process.processKey}>
                  <TableCell>
                    <ResourceHistoryProcessNameCell
                      process={process}
                      visualDepth={
                        process.isServerRoot || shallowestChildDepth === null
                          ? 0
                          : Math.max(1, process.depth - shallowestChildDepth + 1)
                      }
                    />
                  </TableCell>
                  <TableCell align="end">
                    <Text variant="code">{formatCpuTime(process.cpuSecondsApprox)}</Text>
                  </TableCell>
                  <TableCell align="end">
                    <Text variant="code">{process.currentCpuPercent.toFixed(1)}%</Text>
                  </TableCell>
                  <TableCell align="end">
                    <Text variant="code">{process.avgCpuPercent.toFixed(1)}%</Text>
                  </TableCell>
                  <TableCell align="end">
                    <Text variant="code">{process.maxCpuPercent.toFixed(1)}%</Text>
                  </TableCell>
                  <TableCell align="end">
                    <Text variant="code">{formatBytes(process.maxRssBytes)}</Text>
                  </TableCell>
                  <TableCell tone="muted">
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className="block truncate">{process.command}</span>}
                      />
                      <TooltipPopup side="top" variant="code">
                        {process.command}
                      </TooltipPopup>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="end" tone="muted">
                    <Text variant="code">{process.pid}</Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </>
  );
}

function DiagnosticsLastChecked({ checkedAt }: { checkedAt: DateTime.Utc | null }) {
  useSecondsNowMs(checkedAt !== null);
  const relative = getRelativeTimeState(checkedAt ? DateTime.formatIso(checkedAt) : null);

  if (relative.status === "missing") {
    return <span className="text-2xs text-muted-foreground/50">Checking</span>;
  }

  if (relative.status === "invalid") {
    return <span className="text-2xs text-muted-foreground/50">Checked unavailable</span>;
  }

  return (
    <span className="text-2xs text-muted-foreground/60">
      {relative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{relative.value}</span> {relative.suffix}
        </>
      ) : (
        <>Checked {relative.value}</>
      )}
    </span>
  );
}

function DiagnosticsRefreshButton({
  isPending,
  label,
  onClick,
}: {
  isPending: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={isPending}
            onClick={onClick}
            aria-label={label}
          >
            {isPending ? <Spinner size="xs" /> : <RefreshCwIcon className="size-3" />}
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function DiagnosticsSettingsPanel() {
  // The Mate the person is on: the route's environment, else the one it named last.
  const environment = useEnvironment(useLastRouteEnvironmentId());
  const environmentId = environment?.environmentId ?? null;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const observability = config?.observability ?? null;
  const availableEditors = config?.availableEditors ?? null;
  // Read only over a socket that is open: the page never wakes a Mate to report.
  const readEnvironmentId = environment?.connection.phase === "connected" ? environmentId : null;
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, {
    reportFailure: false,
  });
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  const [resourceWindowMs, setResourceWindowMs] = useState(15 * 60_000);
  const selectedResourceWindow =
    RESOURCE_HISTORY_WINDOWS.find((option) => option.windowMs === resourceWindowMs) ??
    RESOURCE_HISTORY_WINDOWS[1];
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    readEnvironmentId === null
      ? null
      : serverEnvironment.traceDiagnostics({ environmentId: readEnvironmentId, input: {} }),
  );
  const {
    data: processData,
    error: processError,
    isPending: isProcessPending,
    refresh: refreshProcesses,
  } = useEnvironmentQuery(
    readEnvironmentId === null
      ? null
      : serverEnvironment.processDiagnostics({ environmentId: readEnvironmentId, input: {} }),
  );
  const {
    data: resourceData,
    error: resourceError,
    isPending: isResourcePending,
    refresh: refreshResources,
  } = useEnvironmentQuery(
    readEnvironmentId === null
      ? null
      : serverEnvironment.processResourceHistory({
          environmentId: readEnvironmentId,
          input: {
            windowMs: selectedResourceWindow.windowMs,
            bucketMs: selectedResourceWindow.bucketMs,
          },
        }),
  );
  const [isOpeningLogsDirectory, setIsOpeningLogsDirectory] = useState(false);
  const [openLogsDirectoryError, setOpenLogsDirectoryError] = useState<string | null>(null);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const signalingPidRef = useRef<number | null>(null);
  const environmentIdRef = useRef(environmentId);
  const processDataRef = useRef(processData);
  environmentIdRef.current = environmentId;
  processDataRef.current = processData;

  const openLogsDirectory = useCallback(() => {
    const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
    // Both come from the Mate's config: unread, it names no folder to open.
    if (!logsDirectoryPath || availableEditors === null) return;

    const editor = resolveAndPersistPreferredEditor(availableEditors);
    if (!editor) {
      setOpenLogsDirectoryError("No available editors found.");
      return;
    }
    if (environmentId === null) {
      setOpenLogsDirectoryError("No environment is selected.");
      return;
    }

    setIsOpeningLogsDirectory(true);
    setOpenLogsDirectoryError(null);
    void (async () => {
      const result = await openInEditor({
        environmentId,
        input: {
          cwd: logsDirectoryPath,
          editor,
        },
      });
      setIsOpeningLogsDirectory(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setOpenLogsDirectoryError(
          error instanceof Error ? error.message : "Unable to open logs folder.",
        );
      }
    })();
  }, [availableEditors, environmentId, observability?.logsDirectoryPath, openInEditor]);

  const isInitialLoading = isPending && data === null;
  const signalProcess = useCallback(
    async (pid: number, signal: ServerProcessSignal) => {
      if (signalingPidRef.current !== null) return;
      signalingPidRef.current = pid;
      setSignalingPid(pid);
      const clearSignaling = () => {
        signalingPidRef.current = null;
        setSignalingPid(null);
      };
      if (signal === "SIGKILL") {
        let confirmed = false;
        try {
          confirmed = await ensureLocalApi().dialogs.confirm(
            `Send SIGKILL to process ${pid}? This cannot be handled by the process.`,
            { variant: "destructive" },
          );
        } catch (error) {
          clearSignaling();
          toastManager.add({
            type: "error",
            title: "Could not confirm signal",
            description: error instanceof Error ? error.message : `Failed to send ${signal}.`,
          });
          return;
        }
        if (!confirmed) {
          clearSignaling();
          return;
        }
      }
      const currentEnvironmentId = environmentIdRef.current;
      if (currentEnvironmentId === null) {
        clearSignaling();
        return;
      }
      const process = processDataRef.current?.processes.find((entry) => entry.pid === pid);
      if (process === undefined) {
        clearSignaling();
        return;
      }

      try {
        const result = await signalServerProcess({
          environmentId: currentEnvironmentId,
          input: { pid, startTimeMs: process.startTimeMs, signal },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: `Could not send ${signal}`,
              description: error instanceof Error ? error.message : `Failed to send ${signal}.`,
            });
          }
          return;
        }
        if (!result.value.signaled) {
          const message = Option.getOrUndefined(result.value.message);
          refreshProcesses();
          if (isStaleProcessSignalMessage(message)) {
            toastManager.add({
              type: "info",
              title: "Process already exited",
              description:
                "The process is not a child of the Zerops Mate server. It might already have exited.",
            });
            return;
          }

          toastManager.add({
            type: "error",
            title: `Could not send ${signal}`,
            description: message ?? `Failed to send ${signal}.`,
          });
          return;
        }
        refreshProcesses();
      } finally {
        clearSignaling();
      }
    },
    [refreshProcesses, signalServerProcess],
  );

  const processDiagnosticsError = processData ? Option.getOrNull(processData.error) : null;
  const processResourceError = resourceData ? Option.getOrNull(resourceData.error) : null;
  const processPresentation = collectionPresentation(
    { data: processData, error: processError, isPending: isProcessPending },
    (data) => data.processes,
    { subject: "Live processes", unavailable: "Live processes unavailable." },
    processDiagnosticsError?.message,
  );
  const resourceQuery = { data: resourceData, error: resourceError, isPending: isResourcePending };
  const resourceLabels = {
    subject: "Process resource samples",
    unavailable: "Process resource history unavailable.",
  };
  const bucketPresentation = collectionPresentation(
    resourceQuery,
    (data) => data.buckets,
    resourceLabels,
    processResourceError?.message,
  );
  const topProcessPresentation = collectionPresentation(
    resourceQuery,
    (data) => data.topProcesses,
    resourceLabels,
    processResourceError?.message,
  );
  const traceDiagnosticsError = data ? Option.getOrNull(data.error) : null;
  const traceDiagnosticsPartialFailure = data
    ? Option.getOrElse(data.partialFailure, () => false)
    : false;

  return (
    <SettingsPageContainer width="wide">
      {readEnvironmentId === null ? null : (
        <ResourceTelemetryDiagnostics environmentId={readEnvironmentId} />
      )}

      <SettingsSection
        title="Live Processes"
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={processData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              isPending={isProcessPending}
              label="Refresh process diagnostics"
              onClick={refreshProcesses}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label="Child Processes"
            value={processData ? formatCount(processData.processCount) : null}
          />
          <StatBlock
            label="CPU"
            value={processData ? `${processData.totalCpuPercent.toFixed(1)}%` : null}
            tooltip="Total CPU across live child processes of the current server process. The desktop shell and other parent processes are not included."
          />
          <StatBlock
            label="Memory"
            value={processData ? formatBytes(processData.totalRssBytes) : null}
            tooltip="Total resident memory across live child processes of the current server process. The desktop shell and other parent processes are not included."
          />
          <StatBlock
            label="Server PID"
            value={processData ? String(processData.serverPid) : null}
          />
        </StatsGrid>
        <CollectionRead presentation={processPresentation}>
          {(processes) => (
            <ProcessDiagnosticsTable
              processes={processes}
              signalingPid={signalingPid}
              onSignal={signalProcess}
              emptyLabel="No live descendant processes found."
            />
          )}
        </CollectionRead>
      </SettingsSection>

      <SettingsSection
        title="Resource History"
        headerAction={
          <div className="flex items-center gap-1.5">
            <ResourceHistoryWindowSelector
              selectedWindowMs={resourceWindowMs}
              onSelect={setResourceWindowMs}
            />
            <DiagnosticsLastChecked checkedAt={resourceData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              isPending={isResourcePending}
              label="Refresh resource history"
              onClick={refreshResources}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label="CPU Time"
            value={resourceData ? formatCpuTime(resourceData.totalCpuSecondsApprox) : null}
            tooltip="Approximate active CPU time for the Zerops Mate server root process and its descendants during the selected window. It grows only while sampled processes use CPU and older samples leave as the window moves."
          />
          <StatBlock
            label="Samples"
            value={resourceData ? formatCount(resourceData.retainedSampleCount) : null}
            tooltip="In-memory process samples retained by the server. This resets when the server restarts."
          />
          <StatBlock
            label="Interval"
            value={resourceData ? formatDuration(resourceData.sampleIntervalMs) : null}
          />
          <StatBlock
            label="Processes"
            value={resourceData ? formatCount(resourceData.topProcesses.length) : null}
          />
        </StatsGrid>
        <CollectionRead
          presentation={bucketPresentation}
          emptyLabel="No process resource samples found for this window."
        >
          {(buckets) => <ProcessResourceHistoryChart buckets={buckets} />}
        </CollectionRead>
        <CollectionRead presentation={topProcessPresentation}>
          {(processes) => (
            <ProcessResourceHistoryTable
              processes={processes}
              emptyLabel="No process resource samples found for this window."
            />
          )}
        </CollectionRead>
      </SettingsSection>

      <SettingsSection
        title="Trace Diagnostics"
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={data?.readAt ?? null} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={!observability?.logsDirectoryPath || isOpeningLogsDirectory}
                    onClick={openLogsDirectory}
                    aria-label="Open logs folder"
                  >
                    <FolderOpenIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">Open logs folder</TooltipPopup>
            </Tooltip>
            <DiagnosticsRefreshButton
              isPending={isPending}
              label="Refresh trace diagnostics"
              onClick={refresh}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock label="Spans" value={data ? formatCount(data.recordCount) : null} />
          <StatBlock
            label="Failures"
            value={data ? formatCount(data.failureCount) : null}
            tone={data && data.failureCount > 0 ? "danger" : "default"}
          />
          <StatBlock
            label="Slow Spans"
            value={data ? formatCount(data.slowSpanCount) : null}
            tooltip={
              data
                ? `Spans with a duration of ${formatDuration(data.slowSpanThresholdMs)} or longer.`
                : "Spans at or above the configured slow-span threshold."
            }
            tone={data && data.slowSpanCount > 0 ? "warning" : "default"}
          />
          <StatBlock
            label="Parse Errors"
            value={data ? formatCount(data.parseErrorCount) : null}
            tone={data && data.parseErrorCount > 0 ? "warning" : "default"}
          />
        </StatsGrid>
        {/* What could not be read, at the card's foot: one band per reading. */}
        {openLogsDirectoryError ? (
          <Alert edge="bottom" icon={<AlertTriangleIcon />} surface="band" variant="error">
            {openLogsDirectoryError}
          </Alert>
        ) : null}
        {traceDiagnosticsError ? (
          <Alert
            edge="bottom"
            icon={<AlertTriangleIcon />}
            surface="band"
            variant={traceDiagnosticsPartialFailure ? "warning" : "error"}
          >
            {traceDiagnosticsPartialFailure
              ? `Some trace files could not be read, so diagnostics may be incomplete. ${traceDiagnosticsError.message}`
              : traceDiagnosticsError.message}
          </Alert>
        ) : null}
        {error ? (
          <Alert edge="bottom" icon={<AlertTriangleIcon />} surface="band" variant="error">
            {error}
          </Alert>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Latest Failures">
        {data && data.latestFailures.length > 0 ? (
          <DiagnosticsTable headers={["Span", "Cause", "Duration", "Ended"]}>
            {data.latestFailures.map((failure) => (
              <TableRow key={`${failure.traceId}:${failure.spanId}`}>
                <TableCell>
                  <span className="font-medium">{failure.name}</span>
                </TableCell>
                <TableCell className="max-w-[360px]" tone="muted">
                  <ExpandableText text={failure.cause} />
                </TableCell>
                <TableCell>
                  <Text variant="code">{formatDuration(failure.durationMs)}</Text>
                </TableCell>
                <TableCell tone="muted">
                  <Text variant="code">{formatRelativeNoWrap(failure.endedAt)}</Text>
                </TableCell>
              </TableRow>
            ))}
          </DiagnosticsTable>
        ) : (
          <RowsOrNone label="Failures" none="No failed spans found." reading={isInitialLoading} />
        )}
      </SettingsSection>

      <SettingsSection title="Most Common Failures">
        {data && data.commonFailures.length > 0 ? (
          <DiagnosticsTable
            headers={["Span", "Count", "Cause", "Last Seen"]}
            minTableWidth="min-w-[760px]"
          >
            {data.commonFailures.map((failure) => (
              <TableRow key={`${failure.name}:${failure.cause}`}>
                <TableCell>
                  <span className="font-medium">{failure.name}</span>
                </TableCell>
                <TableCell>
                  <Text variant="code">{formatCount(failure.count)}</Text>
                </TableCell>
                <TableCell className="max-w-[360px]" tone="muted">
                  <ExpandableText text={failure.cause} />
                </TableCell>
                <TableCell className="w-px" tone="muted">
                  <Text variant="code">{formatRelativeNoWrap(failure.lastSeenAt)}</Text>
                </TableCell>
              </TableRow>
            ))}
          </DiagnosticsTable>
        ) : (
          <RowsOrNone
            label="Failure groups"
            none="No repeated failures found."
            reading={isInitialLoading}
          />
        )}
      </SettingsSection>

      <SettingsSection title="Slowest Spans">
        {data && data.slowestSpans.length > 0 ? (
          <DiagnosticsTable
            headers={["Span", "Duration", "Ended", "Trace"]}
            minTableWidth="min-w-[900px]"
            columnWidths={["w-[44%]", "w-[14%]", "w-[12%]", "w-[30%]"]}
          >
            {data.slowestSpans.map((span) => (
              <TableRow key={`${span.traceId}:${span.spanId}`}>
                <TableCell>
                  <span className="font-medium">{span.name}</span>
                </TableCell>
                <TableCell>
                  <Text variant="code">{formatDuration(span.durationMs)}</Text>
                </TableCell>
                <TableCell className="w-px" tone="muted">
                  <Text variant="code">{formatRelativeNoWrap(span.endedAt)}</Text>
                </TableCell>
                <TableCell className="min-w-0" tone="muted">
                  <TraceIdCell traceId={span.traceId} />
                </TableCell>
              </TableRow>
            ))}
          </DiagnosticsTable>
        ) : (
          <RowsOrNone label="Slow spans" none="No spans found." reading={isInitialLoading} />
        )}
      </SettingsSection>

      <SettingsSection title="Span Logs">
        {data && data.latestWarningAndErrorLogs.length > 0 ? (
          <ScrollArea
            radius="none"
            chainVerticalScroll
            scrollFade
            hideScrollbars
            className="w-full max-w-full"
          >
            <div className="min-w-[920px]">
              <Table className="table-fixed" size="report">
                <colgroup>
                  <col className="w-[11%]" />
                  <col className="w-[9%]" />
                  <col className="w-[24%]" />
                  <col className="w-[26%]" />
                  <col className="w-[30%]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Span</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Trace</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.latestWarningAndErrorLogs.map((event) => (
                    <TableRow
                      key={`${event.traceId}:${event.spanId}:${DateTime.formatIso(event.seenAt)}:${event.message}`}
                    >
                      <TableCell tone="muted">
                        <Text variant="code">{formatRelativeNoWrap(event.seenAt)}</Text>
                      </TableCell>
                      <TableCell>
                        <Text chip className="inline-flex" variant="code">
                          {event.level.toUpperCase()}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <div className="truncate font-medium text-foreground">{event.spanName}</div>
                      </TableCell>
                      <TableCell tone="muted">
                        <ExpandableText
                          collapsedClassName="line-clamp-2"
                          expandLabel="Show full message"
                          text={event.message}
                        />
                      </TableCell>
                      <TableCell className="min-w-0" tone="muted">
                        <TraceIdCell traceId={event.traceId} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        ) : (
          <RowsOrNone
            label="Recent logs"
            none="No warnings or errors found."
            reading={isInitialLoading}
          />
        )}
      </SettingsSection>

      <SettingsSection title="Top Span Names">
        {data && data.topSpansByCount.length > 0 ? (
          <DiagnosticsTable
            headers={["Span", "Count", "Failures", "Average", "Max"]}
            minTableWidth="min-w-[760px]"
            columnWidths={["w-[48%]", "w-[13%]", "w-[13%]", "w-[13%]", "w-[13%]"]}
          >
            {data.topSpansByCount.map((span) => (
              <TableRow key={span.name}>
                <TableCell>
                  <span className="font-medium">{span.name}</span>
                </TableCell>
                <TableCell>
                  <Text variant="code">{formatCount(span.count)}</Text>
                </TableCell>
                <TableCell>
                  <Text variant="code">{formatCount(span.failureCount)}</Text>
                </TableCell>
                <TableCell>
                  <Text variant="code">{formatDuration(span.averageDurationMs)}</Text>
                </TableCell>
                <TableCell>
                  <Text variant="code">{formatDuration(span.maxDurationMs)}</Text>
                </TableCell>
              </TableRow>
            ))}
          </DiagnosticsTable>
        ) : (
          <RowsOrNone label="Span names" none="No spans found." reading={isInitialLoading} />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
