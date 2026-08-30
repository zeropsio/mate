/**
 * The Zerops service map: what exists in the project, grouped and live.
 *
 * Presentational only — every rule it renders is decided in
 * `@t3tools/client-runtime/zerops/serviceMap` and tested there. It mutates nothing: the agent
 * owns every change to the project, and the one action offered here opens a URL
 * the feed already carries.
 */
import { ExternalLinkIcon, FolderOpenIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import type {
  ZeropsServiceMapGroup,
  ZeropsServiceMapView,
  ZeropsServiceRow,
  ZeropsServiceTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { ZeropsService } from "@t3tools/contracts";

function ServiceLine({
  service,
  tone,
  typeLabel,
}: {
  service: ZeropsService;
  tone: ZeropsServiceTone;
  typeLabel?: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="truncate text-sm font-medium text-foreground">{service.hostname}</span>
      {typeLabel === undefined ? null : (
        <span className="truncate text-xs text-muted-foreground">{typeLabel}</span>
      )}
      <Badge
        data-zerops-service-tone={tone}
        data-zerops-service-transient={service.transient ? "" : undefined}
        size="sm"
        variant={tone}
      >
        {service.status}
      </Badge>
      {service.mounted ? (
        <Badge size="sm" variant="secondary">
          <FolderOpenIcon />
          {service.mountPath ?? "mounted"}
        </Badge>
      ) : null}
      {service.subdomainUrl === undefined ? null : (
        <a
          className="inline-flex items-center gap-1 text-xs font-medium text-info-foreground hover:underline"
          href={service.subdomainUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLinkIcon />
          Open
        </a>
      )}
    </div>
  );
}

function ServiceRow({ row }: { row: ZeropsServiceRow }) {
  return (
    <li className="rounded-xl border border-border/55 bg-card/20 px-4 py-3">
      <ServiceLine service={row.service} tone={row.tone} typeLabel={row.typeLabel} />
      {row.stage === undefined || row.stageTone === undefined ? null : (
        <div className="mt-2 border-border/40 border-l pl-3">
          <ServiceLine service={row.stage} tone={row.stageTone} />
        </div>
      )}
      {row.production.length === 0 ? null : (
        <p className="mt-1.5 text-muted-foreground text-xs">
          production:{" "}
          {row.production.map((link, index) => (
            <span key={link.label}>
              {index === 0 ? null : ", "}
              {link.url === undefined ? (
                link.label
              ) : (
                <a className="hover:underline" href={link.url} rel="noreferrer" target="_blank">
                  {link.label}
                </a>
              )}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

function ServiceGroup({ group }: { group: ZeropsServiceMapGroup }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-foreground text-sm">{group.title}</h3>
      <ul className="space-y-2">
        {group.rows.map((row) => (
          <ServiceRow key={row.service.hostname} row={row} />
        ))}
      </ul>
    </section>
  );
}

export function ZeropsServiceMap({ view }: { view: ZeropsServiceMapView | undefined }) {
  // No feed, or not a Zerops environment: the panel is absent, not empty.
  if (view === undefined) {
    return null;
  }

  return (
    <div className="space-y-4" data-zerops-service-map>
      {view.runningTool === undefined ? null : (
        <div className="text-muted-foreground text-xs" data-zerops-running-tool={view.runningTool}>
          {view.runningTool} running
        </div>
      )}
      {view.liveness === "polling" ? (
        <p className="text-muted-foreground text-xs" data-zerops-map-liveness="polling">
          Live updates are reconnecting; the map is refreshing on a timer.
        </p>
      ) : null}
      {view.degraded ? (
        <p
          className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-warning-foreground text-xs"
          data-zerops-map-degraded
        >
          {view.degradedReason ?? "The last read of the project failed; retrying."}
        </p>
      ) : null}
      {view.isEmpty ? (
        <p className="text-muted-foreground text-sm">
          No services yet. Ask the agent to build something and they will appear here.
        </p>
      ) : (
        view.groups.map((group) => <ServiceGroup group={group} key={group.group} />)
      )}
      {view.warnings.map((warning) => (
        <p className="text-muted-foreground text-xs" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}
