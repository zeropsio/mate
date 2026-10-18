/**
 * A place's column on the project page's road — Stage or Production — under its stop's name: what
 * runs there large, since when and by whom, one health line, its address, its services as compact
 * tiles (each one's name and port, what it is, its cores, RAM and disk against what it holds, and
 * its last day), and one quiet row of what can be done. What went wrong is lifted on its own
 * sub-card with its buttons, still saying what runs.
 *
 * Addresses beyond the one that stands for the place, and putting it on a domain, are the page's
 * Access card's: one fact in one place.
 */
import {
  EMPTY_PROJECT_TOPOLOGY_SNAPSHOT,
  inventoryTopology,
  usageOwnerOf,
} from "@t3tools/client-runtime/data";
import {
  buildZeropsServiceMap,
  type ZeropsServiceMetric,
  type ZeropsServiceRow,
} from "@t3tools/client-runtime/zerops/serviceMap";
import { Atom } from "effect/reactivity";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Skeleton } from "~/components/ui/skeleton";
import { useAccountDataOptional, useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";
import { MicroLabel } from "../primitives";
import { ResourceGraph } from "../ZeropsServiceMap";
import { PlaceDot } from "./ProjectRoad";
import type { PlaceLine } from "./projectCard.logic";

const NO_TOPOLOGY = Atom.make(EMPTY_PROJECT_TOPOLOGY_SNAPSHOT);

const METERS: ReadonlyArray<{ readonly id: "cores" | "memory" | "disk"; readonly label: string }> =
  [
    { id: "cores", label: "CPU" },
    { id: "memory", label: "RAM" },
    { id: "disk", label: "Disk" },
  ];

/** One resource against what the service holds: "0.4 / 1 GB", its fill under it. */
function Meter({
  label,
  metric,
  read,
}: {
  readonly label: string;
  readonly metric: ZeropsServiceMetric | undefined;
  readonly read: boolean;
}) {
  const fraction = metric?.fraction;
  return (
    <span className="pp-road-meter">
      <MicroLabel>{label}</MicroLabel>
      {!read ? (
        <Skeleton className="h-3 w-12" />
      ) : metric?.value === undefined ? (
        <span className="pp-road-meter-figure">—</span>
      ) : (
        <span className="pp-road-meter-figure">
          {metric.used === undefined ? metric.value : `${metric.used} / ${metric.value}`}
          {metric.unit === undefined ? null : (
            <span className="pp-road-meter-unit">{metric.unit}</span>
          )}
        </span>
      )}
      <span aria-hidden="true" className="pp-road-meter-track">
        <span
          className="pp-road-meter-fill"
          style={{ inlineSize: `${String(Math.round(Math.min(1, fraction ?? 0) * 100))}%` }}
        />
      </span>
    </span>
  );
}

/** A service as a compact tile: name and port, what it is, three meters and its last day. */
export function ServiceTile({
  row,
  usageRead,
}: {
  readonly row: ZeropsServiceRow;
  readonly usageRead: boolean;
}) {
  const trend = row.trends?.cores;
  return (
    <li className="pp-road-svc" data-zerops-road-service={row.service.hostname}>
      <span className="pp-road-svc-head">
        <span className="pp-road-svc-name">
          {row.title}
          {row.portLabel === undefined ? null : (
            <span className="pp-road-svc-port">{row.portLabel}</span>
          )}
        </span>
        {row.typeShort === undefined ? null : (
          <span className="pp-road-svc-type">{row.typeShort}</span>
        )}
      </span>
      <span className="pp-road-svc-meters">
        {METERS.map((meter) => (
          <Meter
            key={meter.id}
            label={meter.label}
            metric={row.metrics.find((metric) => metric.id === meter.id)}
            read={usageRead}
          />
        ))}
      </span>
      <span className="pp-road-svc-day">
        <MicroLabel>24 h</MicroLabel>
        {trend === undefined ? (
          <Skeleton className="h-3.5 w-12" />
        ) : (
          <ResourceGraph id={`road-${row.service.serviceId}`} trend={trend} />
        )}
      </span>
    </li>
  );
}

/** A place's services as tiles; their room held while they are read. */
export function ServiceTiles({
  rows,
  usageRead,
}: {
  readonly rows: ReadonlyArray<ZeropsServiceRow> | undefined;
  readonly usageRead: boolean;
}) {
  if (rows === undefined)
    return (
      <ul className="pp-road-svcs" aria-hidden="true">
        <li className="pp-road-svc" data-held="">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full" />
        </li>
      </ul>
    );
  if (rows.length === 0) return null;
  return (
    <ul className="pp-road-svcs">
      {rows.map((row) => (
        <ServiceTile key={row.service.serviceId} row={row} usageRead={usageRead} />
      ))}
    </ul>
  );
}

/**
 * A place's services from the account's store — the service map's own join of its services,
 * their use now and their last day — demanded while the page shows them.
 */
export function PlaceServiceTiles({ projectId }: { readonly projectId: string | undefined }) {
  const account = useAccountDataOptional();
  const orgId = account?.orgId ?? null;
  const owner = orgId === null || projectId === undefined ? null : usageOwnerOf(orgId, projectId);
  useDetailDemand("usage", undefined, owner);
  useDetailDemand("usageHistory", undefined, owner);
  const snapshot = useProjection(
    inventoryTopology,
    orgId === null || projectId === undefined
      ? null
      : { orgId, projectId, viewer: account?.viewer },
    NO_TOPOLOGY,
  );
  const map = buildZeropsServiceMap(snapshot.view);
  const rows = map?.groups.flatMap((group) => group.rows.filter((row) => !row.isControlPlane));
  return <ServiceTiles rows={rows} usageRead={map?.usageRead ?? false} />;
}

export interface RoadPlaceModel {
  readonly line: PlaceLine;
  /** What runs there, large; `undefined` where nothing does, or where the road's row says it. */
  readonly version: string | undefined;
  /** "Released 6d ago by Nova Dev": production's release, when it is known. */
  readonly released: string | undefined;
  /** "up 6d". */
  readonly up: string | undefined;
  /** How many services serve there; `undefined` while unread. */
  readonly services: number | undefined;
  /** The one address that stands for it. */
  readonly address: { readonly host: string; readonly url: string } | undefined;
  /** A stage's one line: "follows main · deployed 25m ago". */
  readonly follows: string | undefined;
  /** What went wrong, in sentences. */
  readonly note: { readonly text: string; readonly tone: "attention" | "failed" } | undefined;
}

/** A place's column on the road. `actions` are the page's: Roll back, or a failure's fixes. */
export function RoadPlace({
  model,
  tiles,
  actions,
}: {
  readonly model: RoadPlaceModel;
  readonly tiles: ReactNode;
  readonly actions: ReactNode;
}) {
  const { line } = model;
  const health = [
    line.words[0],
    model.up === undefined ? undefined : `up ${model.up}`,
    model.services === undefined
      ? undefined
      : `${String(model.services)} service${model.services === 1 ? "" : "s"}`,
  ].filter((word) => word !== undefined);
  const trouble = model.note !== undefined;
  return (
    <div className="pp-road-place" data-zerops-surface="road-place">
      {model.version === undefined ? null : (
        <b className="pp-road-place-version">{model.version}</b>
      )}
      {model.released === undefined ? null : (
        <span className="pp-road-place-quiet">{model.released}</span>
      )}
      {line.kind === "production" && !trouble ? (
        <span className="pp-road-place-health">
          <PlaceDot dot={line.dot} />
          {health.join(" · ")}
        </span>
      ) : null}
      {model.address === undefined ? null : (
        <a className="pp-road-place-link" href={model.address.url} rel="noreferrer" target="_blank">
          {model.address.host}
          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </a>
      )}
      {model.note === undefined ? null : (
        <div className="pp-road-place-lift">
          <p data-tone={model.note.tone}>{model.note.text}</p>
          <div className="pp-road-place-acts">{actions}</div>
        </div>
      )}
      {tiles}
      {model.follows === undefined ? null : (
        <span className="pp-road-place-quiet">{model.follows}</span>
      )}
      {trouble ? null : <div className="pp-road-place-acts">{actions}</div>}
    </div>
  );
}
