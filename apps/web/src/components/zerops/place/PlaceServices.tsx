/**
 * A place's services as one table that holds six and more: each service's name with its repository
 * or ports under it, what it is, what it runs, its state and age, where it answers, and its own
 * verbs at the row's end — then, under a service that runs in a container, its CPU, RAM and disk
 * against what it holds, each with its last day. A bucket or a shared disk has no container to
 * meter, so it says what it is and nothing more.
 *
 * Under the row, what the row has no width for: its newest job where that is not what runs, the
 * version HQ did not make it run, and its deploy, opened from *View deploy*.
 */
import type { DeployAnswerJob } from "@t3tools/client-runtime/zerops/hq";
import { flowVerbLabel, shortCommit, type GroupRowTone } from "@t3tools/client-runtime/zerops";
import { NOT_PUBLIC_YET, type RunAgain } from "@t3tools/client-runtime/zerops/flow";
import type {
  ZeropsServiceMetric,
  ZeropsServiceRow,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { usePublicAccess } from "~/zerops/usePublicAccess";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { MiddleTruncate } from "../../ui/middle-truncate";
import { Skeleton } from "../../ui/skeleton";
import { MicroLabel, STATUS_BADGE_TONE } from "../primitives";
import { StopPublicAccessStatus } from "../StopPublicAccess";
import { DeployLogDetails, useDeployLogUnavailable } from "../ZeropsDeployLog";
import { ResourceGraph } from "../ZeropsServiceMap";
import type { PlaceServiceRow } from "./place.logic";

/** A row's dot, by the tone its state reads in. */
export const PLACE_DOT_TONE: Record<GroupRowTone, ServiceStatusToneId | undefined> = {
  good: "ok",
  pending: "busy",
  bad: "failed",
  neutral: undefined,
};

/**
 * *Deploy … again* on a service that runs a version HQ did not make for it (`StopServiceDrift`):
 * HQ's live commit there, asked again by whoever may *Run again* (the deploy-jobs design).
 */
export interface StopDeployAgain {
  /** Whether it is under way for the service. */
  readonly running: (service: string) => boolean;
  readonly onDeployAgain: (redeploy: RunAgain) => void;
}

/**
 * The table's columns: name, type, what runs, state, addresses, verbs — one row per service from
 * its container's 42rem. Narrower (a phone), a row is three lines, never one fact per line: name,
 * type and state with the verbs at its end; what runs and where it answers; then the meters.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,auto)_minmax(0,auto)_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 @2xl/place:grid-cols-[minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,1.35fr)_7.5rem]";
/** Each cell's place: narrow first, then its column in the one-row table. */
const AT = {
  name: "col-start-1 row-start-1 min-w-0",
  type: "col-start-2 row-start-1 min-w-0 @2xl/place:col-start-2",
  runs: "col-span-2 col-start-1 row-start-2 min-w-0 @2xl/place:col-span-1 @2xl/place:col-start-3 @2xl/place:row-start-1",
  state: "col-start-3 row-start-1 min-w-0 @2xl/place:col-start-4",
  addresses:
    "col-span-2 col-start-3 row-start-2 min-w-0 @2xl/place:col-span-1 @2xl/place:col-start-5 @2xl/place:row-start-1",
  actions: "col-start-4 row-start-1 @2xl/place:col-start-6",
} as const;

const METERS: ReadonlyArray<{ readonly id: "cores" | "memory" | "disk"; readonly label: string }> =
  [
    { id: "cores", label: "CPU" },
    { id: "memory", label: "RAM" },
    { id: "disk", label: "Disk" },
  ];

export function PlaceServiceTable({
  projectId,
  rows,
  usageRead,
  answered,
  said,
  onEnableRoute,
  enablingServiceId,
  deployAgain,
}: {
  readonly projectId: string;
  readonly rows: ReadonlyArray<PlaceServiceRow>;
  /** Whether the platform's use of the services has been read: until then meters hold their room. */
  readonly usageRead: boolean;
  /** HQ's answer to the last verb pressed here, by service. */
  readonly answered: ReadonlyMap<string | null, DeployAnswerJob>;
  /** What the verdict over the table already says: HQ's words for a failure, never said twice. */
  readonly said: string | undefined;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
  readonly deployAgain: StopDeployAgain | undefined;
}) {
  return (
    <div className="@container/place" data-zerops-surface="place-services">
      <div
        aria-hidden="true"
        className={`${ROW_GRID} hidden pb-1.5 @2xl/place:grid`}
        data-zerops-place-head=""
      >
        <MicroLabel>Service</MicroLabel>
        <MicroLabel>Type</MicroLabel>
        <MicroLabel>Runs</MicroLabel>
        <MicroLabel>State</MicroLabel>
        <MicroLabel>Addresses</MicroLabel>
        <span />
      </div>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <PlaceServiceLine
            answer={answered.get(row.hostname)}
            deployAgain={deployAgain}
            enablingServiceId={enablingServiceId}
            key={row.hostname}
            onEnableRoute={onEnableRoute}
            projectId={projectId}
            row={row}
            said={said}
            usageRead={usageRead}
          />
        ))}
      </ul>
    </div>
  );
}

function PlaceServiceLine({
  projectId,
  row,
  usageRead,
  onEnableRoute,
  enablingServiceId,
  deployAgain,
  answer,
  said,
}: {
  readonly projectId: string;
  readonly row: PlaceServiceRow;
  readonly usageRead: boolean;
  readonly answer: DeployAnswerJob | undefined;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
  readonly deployAgain: StopDeployAgain | undefined;
  readonly said: string | undefined;
}) {
  const [deployOpen, setDeployOpen] = useState(false);
  const code = row.code;
  const deployLog =
    code === undefined
      ? undefined
      : answer === undefined
        ? code.deployLog
        : answer.jobId === code.deployLog?.jobId
          ? code.deployLog
          : answer.deployLog;
  const again = code?.drift?.redeploy;
  const viewDeploy =
    deployLog === undefined ? undefined : (
      <ViewDeploy
        onToggle={() => setDeployOpen(!deployOpen)}
        open={deployOpen}
        projectId={projectId}
        target={deployLog}
      />
    );
  const state =
    code === undefined ? (
      row.platform === undefined || !row.platform.statusNeedsWord ? undefined : (
        <span className="text-body text-muted-foreground">{row.platform.statusLabel}</span>
      )
    ) : code.status === undefined ||
      (answer !== undefined && (code.runs === undefined || code.job !== undefined)) ? undefined : (
      <PlaceState status={code.status} tone={code.tone} />
    );
  return (
    <li
      className="flex flex-col gap-1.5 border-t border-border/60 py-2.5"
      data-zerops-place-service={row.hostname}
    >
      <div className={ROW_GRID}>
        <span className={`${AT.name} flex flex-col`}>
          <span className="truncate text-body font-medium text-foreground">{row.hostname}</span>
          {row.under === undefined ? null : (
            <span className="truncate text-caption text-muted-foreground">{row.under}</span>
          )}
        </span>
        {/* Only cells with something to say: a stacked row keeps no gap for an empty one. */}
        {row.type === undefined ? null : (
          <span className={`${AT.type} text-body text-muted-foreground`}>{row.type}</span>
        )}
        {code === undefined ? null : (
          <span className={`${AT.runs} flex flex-col`}>
            <PlaceRuns row={code} />
            {viewDeploy === undefined ? null : (
              <span className="flex @2xl/place:hidden">{viewDeploy}</span>
            )}
          </span>
        )}
        {state === undefined ? null : <span className={`${AT.state} flex`}>{state}</span>}
        {code === undefined ? null : (
          <span className={`${AT.addresses} flex flex-col gap-1`}>
            <PlaceAddresses
              enablingServiceId={enablingServiceId}
              onEnableRoute={onEnableRoute}
              projectId={projectId}
              row={code}
            />
          </span>
        )}
        <span className={`${AT.actions} flex items-center justify-end gap-1`}>
          {/* At the row's end in the table; under what runs where a row is narrow. */}
          {viewDeploy === undefined ? null : (
            <span className="hidden @2xl/place:contents">{viewDeploy}</span>
          )}
          {row.platform?.dashboardUrl === undefined || row.platform.dashboardUrl === "" ? null : (
            <Menu>
              <MenuTrigger
                render={
                  <Button aria-label={`More for ${row.hostname}`} size="icon-sm" variant="ghost" />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  render={<a href={row.platform.dashboardUrl} rel="noreferrer" target="_blank" />}
                >
                  Open in Zerops
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
        </span>
      </div>
      {row.compute && row.platform !== undefined ? (
        <PlaceMeters row={row.platform} usageRead={usageRead} />
      ) : null}
      {code === undefined ? null : answer !== undefined ? (
        <span className="text-caption text-muted-foreground" data-zerops-job-state={answer.state}>
          {answer.line}
        </span>
      ) : code.job === undefined ? null : (
        <span
          className="flex min-w-0 flex-col items-start text-caption text-muted-foreground"
          data-zerops-surface="stop-service-job"
          data-zerops-job-state={code.job.state}
        >
          <span className="truncate">{code.job.line}</span>
          {code.job.redeploy === undefined || deployAgain === undefined ? null : (
            <Button
              disabled={deployAgain.running(code.job.redeploy.service)}
              onClick={() =>
                code.job?.redeploy !== undefined && deployAgain.onDeployAgain(code.job.redeploy)
              }
              size="sm"
              variant="secondary"
            >
              {flowVerbLabel("redeploy", deployAgain.running(code.job.redeploy.service))}
            </Button>
          )}
          {code.job.reason === undefined || code.job.reason === said ? null : (
            <span>{code.job.reason}</span>
          )}
        </span>
      )}
      {(answer === undefined ? code?.sourceArchive : answer.sourceArchive) === undefined ? null : (
        <span className="text-caption text-muted-foreground">
          {answer === undefined ? code?.sourceArchive : answer.sourceArchive}
        </span>
      )}
      {/* What it runs, where HQ did not make it run that: never overwritten, said here. */}
      {code?.drift === undefined ? null : (
        <span
          className="flex min-w-0 flex-wrap items-center gap-2 text-caption"
          data-zerops-surface="stop-service-drift"
        >
          <span className="text-status-attention-text">{code.drift.line}</span>
          {deployAgain === undefined || again === undefined ? null : (
            <Button
              disabled={deployAgain.running(again.service)}
              onClick={() => deployAgain.onDeployAgain(again)}
              size="sm"
              variant="secondary"
            >
              {deployAgain.running(again.service)
                ? flowVerbLabel("redeploy", true)
                : `Deploy ${shortCommit(again.sha)} again`}
            </Button>
          )}
          {code.drift.zerops === undefined ? null : (
            <a
              className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
              href={code.drift.zerops}
              rel="noreferrer"
              target="_blank"
            >
              Open in Zerops
              <ExternalLinkIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </a>
          )}
        </span>
      )}
      {deployLog === undefined || !deployOpen ? null : (
        <DeployLogDetails
          key={deployLog.jobId}
          projectId={projectId}
          service={row.hostname}
          target={deployLog}
        />
      )}
    </li>
  );
}

/** What a code service runs: its commit, or what stands for it, and how it got there. */
function PlaceRuns({ row }: { readonly row: NonNullable<PlaceServiceRow["code"]> }) {
  return (
    <>
      {/* No commit and a state: what runs is not stated yet, so nothing is claimed. */}
      {row.commit !== undefined ? (
        <span className="truncate font-mono text-body text-foreground tabular-nums">
          {row.commit}
        </span>
      ) : row.status === undefined ? (
        <span className="truncate text-body text-muted-foreground">{row.word}</span>
      ) : null}
      {row.line === undefined ? null : (
        <span className="truncate text-caption text-muted-foreground">{row.line}</span>
      )}
    </>
  );
}

function PlaceState({ status, tone }: { readonly status: string; readonly tone: GroupRowTone }) {
  const dot = PLACE_DOT_TONE[tone];
  // `Deployed · 2h ago`: the word beside its dot, its age under it in the table as the name sits
  // over its repository; on one line with it where a row is narrow.
  const [word = status, ...rest] = status.split(" · ");
  const age = rest.join(" · ");
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 @2xl/place:flex-col @2xl/place:items-start">
      {dot === undefined ? (
        <span className="min-w-0 text-body break-words text-muted-foreground">{word}</span>
      ) : (
        <span className="text-body text-foreground">
          <Badge dot tone={STATUS_BADGE_TONE[dot]}>
            {word}
          </Badge>
        </span>
      )}
      {age === "" ? null : <span className="text-caption text-muted-foreground">{age}</span>}
    </span>
  );
}

/**
 * Where a code service answers: its addresses, wrapped and each cut to the cell; else, where it
 * serves HTTP and answers to nobody, the sentence that says so and the way to open it.
 */
function PlaceAddresses({
  projectId,
  row,
  onEnableRoute,
  enablingServiceId,
}: {
  readonly projectId: string;
  readonly row: NonNullable<PlaceServiceRow["code"]>;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
}) {
  const publicAccess = usePublicAccess(projectId);
  // Nothing to offer where the caller cannot act on it — a row with a button
  // that does nothing is worse than no row.
  const offers = onEnableRoute === undefined ? [] : row.offers;
  return (
    <>
      {(!publicAccess.bound || publicAccess.state === "ready") &&
      row.routes.length === 0 &&
      offers.length === 0 ? (
        <span className="truncate text-body text-muted-foreground">{NOT_PUBLIC_YET}</span>
      ) : null}
      <StopPublicAccessStatus access={publicAccess} serviceId={row.serviceId ?? null} />
      {row.routes.length === 0 ? null : (
        <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
          {row.routes.map((route) => (
            <a
              className="flex max-w-full min-w-0 items-center gap-1 text-body text-foreground underline-offset-2 hover:underline"
              href={route.url}
              key={route.host}
              rel="noreferrer"
              target="_blank"
            >
              <MiddleTruncate value={route.host} />
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            </a>
          ))}
        </span>
      )}
      {offers.map((offer) => {
        const opening = enablingServiceId === offer.serviceId;
        return (
          <span
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
            data-zerops-surface="stop-route-offer"
            key={offer.serviceId}
          >
            <span className="text-caption text-muted-foreground">
              Answers on {offer.port}, not from outside.
            </span>
            <Button
              disabled={opening || enablingServiceId !== null}
              onClick={() => onEnableRoute?.(offer.serviceId)}
              size="sm"
              variant="secondary"
            >
              {opening ? "Opening…" : "Open to the internet"}
            </Button>
          </span>
        );
      })}
    </>
  );
}

/** *View deploy* at the row's end; what it opens stands under the row. */
function ViewDeploy({
  projectId,
  target,
  open,
  onToggle,
}: {
  readonly projectId: string;
  readonly target: NonNullable<NonNullable<PlaceServiceRow["code"]>["deployLog"]>;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const unavailable = useDeployLogUnavailable(projectId, target);
  return (
    <Button
      aria-expanded={open}
      data-zerops-deploy-job={target.jobId}
      onClick={onToggle}
      size="sm"
      variant="ghost"
    >
      {open ? "Hide deploy" : unavailable ? "Check deploy history" : "View deploy"}
    </Button>
  );
}

/** One resource against what the service holds, `0.08/2`, and its last day beside it. */
function PlaceMeter({
  label,
  metric,
  trend,
  id,
  usageRead,
}: {
  readonly label: string;
  readonly metric: ZeropsServiceMetric | undefined;
  readonly trend: Parameters<typeof ResourceGraph>[0]["trend"] | undefined;
  readonly id: string;
  readonly usageRead: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-zerops-place-meter={label}>
      <MicroLabel>{label}</MicroLabel>
      {!usageRead ? (
        <Skeleton className="h-3 w-10" />
      ) : (
        <span className="truncate text-caption text-foreground tabular-nums">
          {metric?.value === undefined
            ? "—"
            : metric.used === undefined
              ? metric.value
              : `${metric.used}/${metric.value}`}
          {metric?.unit === undefined || metric.value === undefined ? null : (
            <span className="ml-0.5 text-muted-foreground">{metric.unit}</span>
          )}
        </span>
      )}
      {trend === undefined || trend.length === 0 ? null : <ResourceGraph id={id} trend={trend} />}
    </span>
  );
}

/** A compute service's CPU, RAM and disk on one compact line, under its row. */
function PlaceMeters({
  row,
  usageRead,
}: {
  readonly row: ZeropsServiceRow;
  readonly usageRead: boolean;
}) {
  return (
    <span
      className="flex flex-wrap items-center gap-x-4 gap-y-1 @2xl/place:grid @2xl/place:grid-cols-[repeat(auto-fill,10.5rem)]"
      data-zerops-place-meters=""
    >
      {METERS.map((meter) => (
        <PlaceMeter
          id={`place-${row.service.serviceId}-${meter.id}`}
          key={meter.id}
          label={meter.label}
          metric={row.metrics.find((metric) => metric.id === meter.id)}
          trend={row.trends?.[meter.id]}
          usageRead={usageRead}
        />
      ))}
    </span>
  );
}
