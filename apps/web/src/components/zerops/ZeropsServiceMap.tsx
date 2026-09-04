/**
 * The Zerops service map: what exists in the project, grouped and live.
 *
 * Presentational only — every rule it renders is decided in
 * `@t3tools/client-runtime/zerops/serviceMap` and tested there. It mutates nothing: the agent
 * owns every change to the project, and the one action offered here opens a URL
 * the feed already carries.
 */
import { ExternalLinkIcon } from "lucide-react";

import type {
  ZeropsServiceMapGroup,
  ZeropsServiceMapView,
  ZeropsServiceRow,
  ZeropsServiceTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import type { ProjectTopologyLiveness } from "../../zerops/projectTopologyWatcher";
import { FlatCard, LivenessLine, MicroLabel, MintPanel, StatusDot } from "./primitives";

const STATUS_TONE: Record<ZeropsServiceTone, "busy" | "failed" | "ok"> = {
  error: "failed",
  warning: "busy",
  outline: "ok",
};

function ServiceLine({
  service,
  tone,
  typeLabel,
  nameLabel,
}: {
  service: ZeropsTopologyService;
  tone: ZeropsServiceTone;
  typeLabel?: string;
  nameLabel?: string;
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex min-w-0 max-w-full flex-1 flex-col">
        <span className="min-w-0 max-w-full break-all text-sm font-medium text-foreground">
          {nameLabel ?? service.hostname}
        </span>
        {typeLabel === undefined ? null : (
          <span className="min-w-0 max-w-full break-words text-xs text-muted-foreground">
            {typeLabel}
          </span>
        )}
      </div>
      <StatusDot
        data-zerops-service-tone={tone}
        data-zerops-service-transient={service.transient ? "true" : undefined}
        label={service.status}
        pulse={service.transient}
        tone={STATUS_TONE[tone]}
      />
      {service.subdomainUrl === undefined ? null : (
        <a
          className="inline-flex items-center gap-1 text-xs font-medium text-info-foreground hover:underline"
          href={service.subdomainUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLinkIcon className="size-3" />
          Open
        </a>
      )}
    </div>
  );
}

function ServiceRow({ row }: { row: ZeropsServiceRow }) {
  // `adoptionState` is gone (a `zcp studio topology`-only fact); the
  // infrastructure group is, by the client projection's own grouping rule,
  // the zcp container and nothing else.
  const isControlPlane = row.service.group === "infrastructure";
  const content = (
    <>
      <ServiceLine
        {...(isControlPlane ? { nameLabel: "Zerops Control Plane" } : {})}
        service={row.service}
        tone={row.tone}
        typeLabel={row.typeLabel}
      />
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
    </>
  );

  return (
    <li data-zerops-service-row={isControlPlane ? "control-plane" : "service"}>
      {isControlPlane ? (
        <MintPanel className="px-3 py-2.5">{content}</MintPanel>
      ) : (
        <FlatCard className="px-3 py-2.5">{content}</FlatCard>
      )}
    </li>
  );
}

function ServiceGroup({ group }: { group: ZeropsServiceMapGroup }) {
  return (
    <section className="space-y-2" data-zerops-service-group={group.group}>
      <h3>
        <MicroLabel>{group.title}</MicroLabel>
      </h3>
      <ul className="space-y-1.5">
        {group.rows.map((row) => (
          <ServiceRow key={row.service.hostname} row={row} />
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
    <div className="space-y-4" data-zerops-service-map>
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
