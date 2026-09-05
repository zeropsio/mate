/**
 * The Zerops service map: what exists in the project, grouped and live.
 *
 * Presentational only — every rule it renders is decided in
 * `@t3tools/client-runtime/zerops/serviceMap` and tested there. It mutates
 * nothing: the agent owns every change to the project, and the only links
 * offered here open URLs the feed already carries (a service's public
 * routes, and its own page in the Zerops dashboard).
 *
 * One card per service, the Zerops dashboard's service card compressed for a
 * side panel: the name with its port and the status word on one line, one
 * line of what it is and how it got there, its public routes, and the live
 * strip — containers, cores, RAM, disk — with how much of each is in use.
 */
import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";

import type {
  ZeropsServiceFact,
  ZeropsServiceMapGroup,
  ZeropsServiceMapView,
  ZeropsServiceMetric,
  ZeropsServiceRow,
  ZeropsServiceTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type {
  ZeropsServiceRoute,
  ZeropsTopologyService,
} from "@t3tools/client-runtime/zerops/topology";
import { Skeleton } from "~/components/ui/skeleton";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { ProjectTopologyLiveness } from "../../zerops/projectTopologyWatcher";
import { FlatCard, LivenessLine, MicroLabel, MintPanel, StatusDot } from "./primitives";

const STATUS_TONE: Record<ZeropsServiceTone, "busy" | "failed" | "ok" | "off"> = {
  error: "failed",
  warning: "busy",
  outline: "ok",
  muted: "off",
};

/** The strip's shape, so a card holds its height while the first usage read is out. */
const STRIP_PLACEHOLDER = ["container", "Cores", "RAM", "Disk"] as const;

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

function RouteLink({ href, label }: { href: string; label: string }) {
  return (
    <li className="flex min-w-0 max-w-full">
      <a
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden motion-reduce:transition-none"
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
    <ul
      className="mt-1.5 flex min-w-0 max-w-full flex-wrap gap-x-3 gap-y-1"
      data-zerops-service-routes
    >
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

/** The name, a link into the Zerops dashboard, with its port; the status word at the end of the line. */
function ServiceHeader({ row }: { row: ZeropsServiceRow }) {
  return (
    <div className="flex min-w-0 max-w-full items-start justify-between gap-3">
      <a
        className="group flex min-w-0 max-w-full items-baseline gap-1 text-foreground"
        data-zerops-service-dashboard
        href={row.dashboardUrl}
        rel="noreferrer"
        target="_blank"
      >
        <span className="min-w-0 max-w-full break-all text-base leading-snug font-semibold tracking-tight">
          {row.title}
        </span>
        {row.portLabel === undefined ? null : (
          <span className="shrink-0 text-base leading-snug font-normal text-muted-foreground">
            {row.portLabel}
          </span>
        )}
        <ArrowRightIcon
          aria-hidden="true"
          className="ml-0.5 size-3.5 shrink-0 self-center text-muted-foreground opacity-0 transition-[opacity,translate] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        />
      </a>
      <ServiceStatus label={row.statusLabel} service={row.service} tone={row.tone} />
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
    <div className="mt-2.5 border-t border-border/60 pt-2.5" data-zerops-service-stage>
      <div className="flex min-w-0 max-w-full items-baseline justify-between gap-3">
        <span className="min-w-0 max-w-full break-all text-sm font-medium text-foreground">
          {stage.hostname}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">stage</span>
        </span>
        <ServiceStatus label={label} service={stage} tone={tone} />
      </div>
      <ServiceRoutes routes={stage.routes} />
    </div>
  );
}

function MetricCell({ metric }: { metric: ZeropsServiceMetric }) {
  return (
    <div className="min-w-0" data-zerops-service-metric={metric.id}>
      <MicroLabel>{metric.label}</MicroLabel>
      <div className="mt-0.5 text-sm leading-tight font-medium text-foreground tabular-nums">
        {metric.value}
        {metric.unit === undefined ? null : (
          <span className="ml-1 text-xs font-normal text-muted-foreground">{metric.unit}</span>
        )}
      </div>
      {metric.fraction === undefined ? null : (
        <div aria-hidden="true" className="mt-1.5 h-0.5 w-full rounded-full bg-border">
          <div
            className="h-full rounded-full bg-[var(--zerops-status-ok)]"
            data-zerops-service-metric-fill
            style={{ width: `${Math.round(metric.fraction * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The live strip: what the service holds right now. Until the first usage
 * read answers, the strip's shape is reserved so nothing appears from
 * nothing; once it has, a service with no container shows no strip at all.
 */
function ServiceStrip({ row, usageRead }: { row: ZeropsServiceRow; usageRead: boolean }) {
  if (usageRead && row.metrics.length === 0) {
    return null;
  }
  return (
    <div
      className="mt-3 grid grid-cols-4 gap-3 border-t border-border/60 pt-2.5"
      data-zerops-service-strip={usageRead ? "live" : "pending"}
    >
      {usageRead
        ? row.metrics.map((metric) => <MetricCell key={metric.id} metric={metric} />)
        : STRIP_PLACEHOLDER.map((label) => (
            <div className="min-w-0" key={label}>
              <MicroLabel>{label}</MicroLabel>
              <Skeleton className="mt-1 h-4 w-10" />
            </div>
          ))}
    </div>
  );
}

function ServiceRow({ row, usageRead }: { row: ZeropsServiceRow; usageRead: boolean }) {
  // The infrastructure group is, by the client projection's own grouping
  // rule, the zcp container and nothing else — it gets the mint panel.
  const isControlPlane = row.service.group === "infrastructure";
  const content = (
    <>
      <ServiceHeader row={row} />
      {row.meta.length === 0 ? null : (
        <p
          className="mt-0.5 min-w-0 max-w-full break-words text-xs text-muted-foreground"
          data-zerops-service-meta
        >
          {row.meta.map(factText).join(" · ")}
        </p>
      )}
      <ServiceRoutes routes={row.service.routes} row={row} />
      {row.stage === undefined ||
      row.stageTone === undefined ||
      row.stageStatusLabel === undefined ? null : (
        <StageLine label={row.stageStatusLabel} stage={row.stage} tone={row.stageTone} />
      )}
      <ServiceStrip row={row} usageRead={usageRead} />
    </>
  );
  const cardClassName = "px-4 py-3";

  return (
    <li data-zerops-service-row={isControlPlane ? "control-plane" : "service"}>
      {isControlPlane ? (
        <MintPanel className={cardClassName}>{content}</MintPanel>
      ) : (
        <FlatCard className={cardClassName}>{content}</FlatCard>
      )}
    </li>
  );
}

function ServiceGroup({ group, usageRead }: { group: ZeropsServiceMapGroup; usageRead: boolean }) {
  return (
    <section className="space-y-2" data-zerops-service-group={group.group}>
      <h3 className="flex items-baseline gap-1.5">
        <MicroLabel>{group.title}</MicroLabel>
        {group.rows.length < 2 ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">{group.rows.length}</span>
        )}
      </h3>
      <ul className="space-y-2">
        {group.rows.map((row) => (
          <ServiceRow key={row.service.hostname} row={row} usageRead={usageRead} />
        ))}
      </ul>
    </section>
  );
}

export function ZeropsServiceMap({
  view,
  liveness,
  error,
}: {
  readonly view: ZeropsServiceMapView | undefined;
  /** The platform-websocket connection's own state — `useProjectTopology`'s signal, not the view's. */
  readonly liveness?: ProjectTopologyLiveness | undefined;
  /** The most recent `listProjectServices` read's failure, if the last one failed. */
  readonly error?: string | undefined;
}) {
  // No view yet — no session, no resolved project, or the first read still pending.
  if (view === undefined) {
    return null;
  }

  return (
    <div className="space-y-5" data-zerops-service-map>
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
          <ServiceGroup group={group} key={group.group} usageRead={view.usageRead} />
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
