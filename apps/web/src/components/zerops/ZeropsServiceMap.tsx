/**
 * The Zerops service map: what exists in the project, grouped and live.
 *
 * Presentational only — every rule it renders is decided in
 * `@t3tools/client-runtime/zerops/serviceMap` and tested there. It mutates
 * nothing: the only links offered open URLs the feed already carries (a
 * service's public routes, and its own page in the Zerops dashboard).
 *
 * One small card per service, read as the dashboard's: the status word,
 * then the name with its port and what it is (`app :3000 Node.js 22`), one
 * button per public route at the right; then the three resources it holds —
 * cores, RAM, disk — each a figure beside its own inline graph of the last
 * day. Everything the dashboard shows around those — how it was deployed,
 * where it answers, what is in use of its allocation and the autoscaling
 * range it moves in — waits in a pop that opens on hover. A service holding
 * nothing (not deployed yet) has no resources line.
 *
 * The control plane's card is also the Mate's home: under its resources it
 * says who lives there — the face wearing the conversation's state, the name
 * — and the coding agents' card, the agents the Mate works through, grows out
 * of its bottom edge rather than standing on its own further down the panel.
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { ArrowUpRightIcon, ExternalLinkIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import type {
  ZeropsServiceFact,
  ZeropsServiceMapGroup,
  ZeropsServiceMapView,
  ZeropsServiceMetric,
  ZeropsServiceRow,
  ZeropsServiceTone,
  ZeropsServiceTrends,
  ZeropsTrendPoint,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type {
  ZeropsServiceRoute,
  ZeropsTopologyService,
} from "@t3tools/client-runtime/zerops/topology";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { ProjectTopologyLiveness } from "../../zerops/projectTopologyWatcher";
import { FlatCard, LivenessLine, MateFace, MicroLabel, MintPanel, StatusDot } from "./primitives";
import { sparklineGeometry } from "./sparkline";

const STATUS_TONE: Record<ZeropsServiceTone, "busy" | "failed" | "ok" | "off"> = {
  error: "failed",
  warning: "busy",
  outline: "ok",
  muted: "off",
};

/** A graph's box, in its own units; the stroke does not scale with it. */
const GRAPH_WIDTH = 48;
const GRAPH_HEIGHT = 14;

/** The three resources, in the dashboard's order. */
const RESOURCES: ReadonlyArray<{
  readonly id: "cores" | "memory" | "disk";
  readonly label: string;
}> = [
  { id: "cores", label: "Cores" },
  { id: "memory", label: "RAM" },
  { id: "disk", label: "Disk" },
];

const HOVER_OPEN_DELAY_MS = 220;
const HOVER_CLOSE_DELAY_MS = 120;

/** Who lives in the control plane, as the caller knows them: the name, the colour, today's face. */
export interface ZeropsMateOnMap {
  readonly name: string;
  readonly tint: MateTintId;
  readonly face: MateMarkState;
}

function ServiceStatus({
  service,
  tone,
  label,
}: {
  service: ZeropsTopologyService;
  tone: ZeropsServiceTone;
  label: string;
}) {
  return (
    <StatusDot
      className="shrink-0"
      data-zerops-service-tone={tone}
      data-zerops-service-transient={service.transient ? "true" : undefined}
      label={label}
      pulse={service.transient}
      tone={STATUS_TONE[tone]}
    />
  );
}

const factText = (fact: ZeropsServiceFact): string =>
  fact.at === undefined ? fact.label : `${fact.label} ${formatRelativeTimeLabel(fact.at)}`;

/** The name with its port. `as` decides whether it is the card's title or the pop's link. */
function ServiceName({ row, className }: { row: ZeropsServiceRow; className?: string }) {
  return (
    <span className={cn("flex min-w-0 max-w-full items-baseline gap-1", className)}>
      <span className="min-w-0 max-w-full break-all font-semibold tracking-tight">{row.title}</span>
      {row.portLabel === undefined ? null : (
        <span className="shrink-0 font-normal text-muted-foreground">{row.portLabel}</span>
      )}
    </span>
  );
}

/** One resource's graph: what was used over the last day as a filled curve, the last hour marked. */
function ResourceGraph({ trend, id }: { trend: ReadonlyArray<ZeropsTrendPoint>; id: string }) {
  const geometry = sparklineGeometry(trend, GRAPH_WIDTH, GRAPH_HEIGHT, 1.5);
  const gradientId = `zerops-graph-${id}`;
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-12 shrink-0 self-end text-info"
      data-zerops-service-graph="live"
      preserveAspectRatio="none"
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {geometry.area === "" ? null : <path d={geometry.area} fill={`url(#${gradientId})`} />}
      {geometry.line === "" ? null : (
        <path
          d={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {geometry.end === undefined ? null : (
        <circle cx={geometry.end.x} cy={geometry.end.y} fill="currentColor" r="1.5" />
      )}
    </svg>
  );
}

/** A figure the card can show: an allocation the service holds right now. */
interface ResourceFigure {
  readonly id: ZeropsServiceMetric["id"];
  readonly value: string;
  readonly unit: string | undefined;
}

const figureOf = (metric: ZeropsServiceMetric | undefined): ResourceFigure | undefined =>
  metric === undefined || metric.value === undefined
    ? undefined
    : { id: metric.id, value: metric.value, unit: metric.unit };

/** One resource on the line: its label, the figure it holds, and its graph beside it. */
function ResourceItem({
  label,
  figure,
  trend,
  graphId,
}: {
  label: string;
  figure: ResourceFigure | undefined;
  trend: ReadonlyArray<ZeropsTrendPoint> | undefined;
  graphId: string;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-baseline gap-1.5"
      data-zerops-service-resource={figure?.id ?? label.toLowerCase()}
    >
      <MicroLabel>{label}</MicroLabel>
      {figure === undefined ? (
        <Skeleton className="h-3 w-8 self-center" data-zerops-service-figure="pending" />
      ) : (
        <span
          className="text-xs leading-none font-medium text-foreground tabular-nums"
          data-zerops-service-figure="live"
        >
          {figure.value}
          {figure.unit === undefined ? null : (
            <span className="ml-0.5 font-normal text-muted-foreground">{figure.unit}</span>
          )}
        </span>
      )}
      {trend === undefined ? (
        <Skeleton
          className="h-3.5 w-12 self-center rounded-sm"
          data-zerops-service-graph="pending"
        />
      ) : (
        <ResourceGraph id={graphId} trend={trend} />
      )}
    </span>
  );
}

/**
 * The resources line under the name. Its shape is reserved until the reads
 * answer; a service holding nothing — not deployed yet, stopped — shows no
 * resources at all once usage is known.
 */
function ServiceResources({ row, usageRead }: { row: ZeropsServiceRow; usageRead: boolean }) {
  // The envelope alone (`range` without `value`) is the pop's, not the card's.
  if (usageRead && row.metrics.every((metric) => metric.value === undefined)) {
    return null;
  }
  const trends: ZeropsServiceTrends | undefined = row.trends;
  return (
    <div
      className="mt-2 flex min-w-0 max-w-full flex-wrap items-baseline gap-x-5 gap-y-1.5"
      data-zerops-service-resources
    >
      {RESOURCES.map((resource) => (
        <ResourceItem
          graphId={`${row.service.serviceId}-${resource.id}`}
          key={resource.id}
          figure={
            usageRead
              ? figureOf(row.metrics.find((metric) => metric.id === resource.id))
              : undefined
          }
          label={resource.label}
          trend={trends?.[resource.id]}
        />
      ))}
    </div>
  );
}

/**
 * A public route as a button at the card's right — the one thing a person
 * reaches for without hovering, so it gets a real target. The click stays
 * the link's: it must not toggle the card's pop underneath.
 */
function RouteButton({ route }: { route: ZeropsServiceRoute }) {
  return (
    <Button
      aria-label={route.host}
      data-zerops-service-route-button
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      render={<a href={route.url} rel="noreferrer" target="_blank" />}
      size="icon-sm"
      variant="outline"
    >
      <ExternalLinkIcon aria-hidden="true" />
    </Button>
  );
}

function RouteLink({ href, label }: { href: string; label: string }) {
  return (
    <li className="flex min-w-0 max-w-full">
      <a
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm text-xs text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        href={href}
        rel="noreferrer"
        target="_blank"
      >
        <span className="min-w-0 break-all">{label}</span>
        <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
      </a>
    </li>
  );
}

/** Where the service answers from outside: every public route, and the production projects it feeds. */
function ServiceRoutes({
  row,
  routes,
}: {
  row?: ZeropsServiceRow;
  routes: ReadonlyArray<ZeropsServiceRoute>;
}) {
  const production = row?.production ?? [];
  if (routes.length === 0 && production.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 flex min-w-0 max-w-full flex-col gap-1" data-zerops-service-routes>
      {routes.map((route) => (
        <RouteLink href={route.url} key={route.url} label={route.host} />
      ))}
      {production.map((link) =>
        link.url === undefined ? (
          <li className="text-xs text-muted-foreground" key={link.label}>
            Production · {link.label}
          </li>
        ) : (
          <RouteLink href={link.url} key={link.label} label={`Production · ${link.label}`} />
        ),
      )}
    </ul>
  );
}

/** The autoscaling range a figure moves in, as the dashboard's panel states it. */
function MetricRange({ metric }: { metric: ZeropsServiceMetric }) {
  if (metric.range === undefined) return null;
  const unit = metric.unit === undefined ? "" : ` ${metric.unit}`;
  const mode = metric.cpuMode === undefined ? "" : ` · ${metric.cpuMode}`;
  return (
    <span
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
      data-zerops-service-metric-range
    >
      {`${metric.range}${unit}${mode}`}
    </span>
  );
}

function MetricRow({ metric }: { metric: ZeropsServiceMetric }) {
  return (
    <div
      className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3"
      data-zerops-service-metric={metric.id}
    >
      <MicroLabel>{metric.label}</MicroLabel>
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs text-foreground tabular-nums">
          {metric.value === undefined ? (
            <span />
          ) : (
            <span>
              {metric.used === undefined ? null : (
                <>
                  <span>{metric.used}</span>
                  <span className="text-muted-foreground"> / </span>
                </>
              )}
              <span>{metric.value}</span>
              {metric.unit === undefined ? null : (
                <span className="ml-1 text-muted-foreground">{metric.unit}</span>
              )}
            </span>
          )}
          <MetricRange metric={metric} />
        </div>
        {metric.fraction === undefined ? null : (
          <div aria-hidden="true" className="mt-1 h-0.5 w-full rounded-full bg-border">
            <div
              className="h-full rounded-full bg-info"
              data-zerops-service-metric-fill
              style={{ width: `${Math.round(metric.fraction * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What the pop holds: the dashboard card's chrome, in reading order. The
 * name as the way into the Zerops dashboard, what the service is and how
 * it was deployed, where it answers, then used against allocated.
 */
export function ZeropsServiceDetail({ row }: { row: ZeropsServiceRow }) {
  return (
    <div className="flex w-72 max-w-full flex-col text-sm" data-zerops-service-detail>
      <a
        className="group flex min-w-0 max-w-full items-baseline gap-1 text-foreground"
        data-zerops-service-dashboard
        href={row.dashboardUrl}
        rel="noreferrer"
        target="_blank"
      >
        <ServiceName className="flex-1" row={row} />
        <ArrowUpRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 self-center text-muted-foreground transition-[translate] duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
        />
      </a>
      {row.meta.length === 0 ? null : (
        <p
          className="mt-0.5 min-w-0 max-w-full break-words text-xs text-muted-foreground"
          data-zerops-service-meta
        >
          {row.meta.map(factText).join(" · ")}
        </p>
      )}
      <ServiceRoutes routes={row.service.routes} row={row} />
      {row.stage === undefined ? null : <ServiceRoutes routes={row.stage.routes} />}
      {row.metrics.length === 0 ? null : (
        <div
          className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3"
          data-zerops-service-metrics
        >
          {row.metrics.map((metric) => (
            <MetricRow key={metric.id} metric={metric} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The stage half of a dev service, folded into the dev card as one quiet line. */
function StageLine({
  stage,
  tone,
  label,
}: {
  stage: ZeropsTopologyService;
  tone: ZeropsServiceTone;
  label: string;
}) {
  return (
    <div
      className="mt-2 flex min-w-0 max-w-full items-baseline justify-between gap-3 border-t border-border/60 pt-2"
      data-zerops-service-stage
    >
      <span className="min-w-0 max-w-full break-all text-sm font-medium text-foreground">
        {stage.hostname}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">stage</span>
      </span>
      <ServiceStatus label={label} service={stage} tone={tone} />
    </div>
  );
}

/** Who lives here: the Mate's face in its colour, wearing the conversation's state, and the sentence. */
function MateHome({ mate }: { mate: ZeropsMateOnMap }) {
  return (
    <div className="mt-2.5 flex min-w-0 max-w-full items-center gap-2" data-zerops-mate-home>
      <MateFace size="sm" state={mate.face} tint={mate.tint} />
      <span className="min-w-0 text-sm leading-snug">
        <span className="font-medium text-foreground">{mate.name}</span>
        <span className="text-muted-foreground"> lives here</span>
      </span>
    </div>
  );
}

/**
 * What every card has: the status word over the name line — the name with
 * its port and what the service is — the route buttons at the right, the
 * resources, plus the stage line a dev service folds in. Inside the hover
 * pop's trigger.
 */
function ServiceCardBody({ row, usageRead }: { row: ZeropsServiceRow; usageRead: boolean }) {
  return (
    <>
      <div className="flex min-w-0 max-w-full items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <ServiceStatus label={row.statusLabel} service={row.service} tone={row.tone} />
          <div className="mt-0.5 flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2">
            <ServiceName className="text-sm leading-snug" row={row} />
            {row.typeShort === undefined ? null : (
              <span className="text-xs text-muted-foreground">{row.typeShort}</span>
            )}
          </div>
        </div>
        {row.service.routes.length === 0 ? null : (
          <div className="flex shrink-0 items-center gap-1" data-zerops-service-routes-buttons>
            {row.service.routes.map((route) => (
              <RouteButton key={route.url} route={route} />
            ))}
          </div>
        )}
      </div>
      <ServiceResources row={row} usageRead={usageRead} />
      {row.stage === undefined ||
      row.stageTone === undefined ||
      row.stageStatusLabel === undefined ? null : (
        <StageLine label={row.stageStatusLabel} stage={row.stage} tone={row.stageTone} />
      )}
    </>
  );
}

const TRIGGER_CLASS =
  "block w-full cursor-default text-left outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ServiceCard({
  row,
  usageRead,
  children,
  render,
}: {
  row: ZeropsServiceRow;
  usageRead: boolean;
  children?: ReactNode;
  render: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className={TRIGGER_CLASS}
        closeDelay={HOVER_CLOSE_DELAY_MS}
        delay={HOVER_OPEN_DELAY_MS}
        nativeButton={false}
        openOnHover
        render={render}
      >
        <ServiceCardBody row={row} usageRead={usageRead} />
        {children}
      </PopoverTrigger>
      <PopoverPopup align="start" side="left" sideOffset={8}>
        <ZeropsServiceDetail row={row} />
      </PopoverPopup>
    </Popover>
  );
}

/**
 * The control plane's card: the mint panel, the Mate's home. The hover pop's
 * trigger is the card's text alone; the agents card is slotted into the
 * panel's bottom edge — pulled up over the mint's last 12 px, inset from its
 * sides — so it reads as growing out of the container it signs in to, and a
 * hand on it never opens the control plane's pop.
 */
function ControlPlaneRow({
  row,
  usageRead,
  mate,
  agents,
}: {
  row: ZeropsServiceRow;
  usageRead: boolean;
  mate: ZeropsMateOnMap | undefined;
  agents: ReactNode;
}) {
  const hangs = agents !== undefined && agents !== null;
  return (
    <li data-zerops-service-row="control-plane">
      <MintPanel className={hangs ? "pb-3" : undefined}>
        <ServiceCard render={<div className="px-3.5 py-2.5" />} row={row} usageRead={usageRead}>
          {mate === undefined ? null : <MateHome mate={mate} />}
        </ServiceCard>
      </MintPanel>
      {hangs ? (
        <div className="relative -mt-3 mx-3" data-zerops-agent-auth-tray>
          {agents}
        </div>
      ) : null}
    </li>
  );
}

function ServiceRow({ row, usageRead }: { row: ZeropsServiceRow; usageRead: boolean }) {
  return (
    <li data-zerops-service-row="service">
      <ServiceCard
        render={<FlatCard className="px-3.5 py-2.5" />}
        row={row}
        usageRead={usageRead}
      />
    </li>
  );
}

function ServiceGroup({
  group,
  usageRead,
  mate,
  agents,
}: {
  group: ZeropsServiceMapGroup;
  usageRead: boolean;
  mate: ZeropsMateOnMap | undefined;
  agents: ReactNode;
}) {
  return (
    <section className="space-y-1.5" data-zerops-service-group={group.group}>
      <h3 className="flex items-baseline gap-1.5">
        <MicroLabel>{group.title}</MicroLabel>
        {group.rows.length < 2 ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">{group.rows.length}</span>
        )}
      </h3>
      <ul className="space-y-1.5">
        {group.rows.map((row) =>
          // The infrastructure group is, by the client projection's own
          // grouping rule, the zcp container and nothing else.
          row.service.group === "infrastructure" ? (
            <ControlPlaneRow
              agents={agents}
              key={row.service.hostname}
              mate={mate}
              row={row}
              usageRead={usageRead}
            />
          ) : (
            <ServiceRow key={row.service.hostname} row={row} usageRead={usageRead} />
          ),
        )}
      </ul>
    </section>
  );
}

export function ZeropsServiceMap({
  view,
  liveness,
  error,
  mate,
  agents,
}: {
  readonly view: ZeropsServiceMapView | undefined;
  /** The platform-websocket connection's own state — `useProjectTopology`'s signal, not the view's. */
  readonly liveness?: ProjectTopologyLiveness | undefined;
  /** The most recent `listProjectServices` read's failure, if the last one failed. */
  readonly error?: string | undefined;
  /** Who lives in the control plane, when the caller knows — it is written on the control plane's card. */
  readonly mate?: ZeropsMateOnMap | undefined;
  /** The coding agents' card, which grows out of the control plane's card. Nothing when there is none to show. */
  readonly agents?: ReactNode;
}) {
  // No view yet — no session, no resolved project, or the first read still pending.
  if (view === undefined) {
    return null;
  }

  return (
    <div className="space-y-6" data-zerops-service-map>
      {error !== undefined ? (
        <LivenessLine data-zerops-map-degraded="true" label={error} state="last-read-failed" />
      ) : liveness === "live" ? (
        <LivenessLine
          data-zerops-map-liveness="live"
          label="Live · updated just now"
          state="live"
        />
      ) : liveness === "polling" ? (
        <LivenessLine
          data-zerops-map-liveness="polling"
          label="Live updates reconnecting · polling"
          state="polling"
        />
      ) : (
        <LivenessLine state="absent" />
      )}
      {view.runningTool === undefined ? null : (
        <StatusDot
          data-zerops-running-tool={view.runningTool}
          label={`${view.runningTool} running`}
          tone="busy"
        />
      )}
      {view.isEmpty ? (
        <p className="text-muted-foreground text-sm" data-zerops-map-empty>
          No services yet. Ask the agent to build something and they will appear here.
        </p>
      ) : (
        view.groups.map((group) => (
          <ServiceGroup
            agents={agents}
            group={group}
            key={group.group}
            mate={mate}
            usageRead={view.usageRead}
          />
        ))
      )}
      {view.warnings.map((warning) => (
        <p className="text-muted-foreground text-xs" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}
