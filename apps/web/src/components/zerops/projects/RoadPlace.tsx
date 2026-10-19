/**
 * A place's block on the project page — production, or a stage — under the row that names it and
 * opens its page: its status line, its addresses (`blockAddresses`), what went wrong lifted with its buttons, and its
 * services as compact rows (each one's name and port, what it is, its CPU and RAM now with their
 * last day; a service that only stores, its kind alone), however many it runs. What else can be
 * done there sits behind the block's ···.
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
import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useProjection,
} from "~/zerops/ZeropsAccountData";
import { ResourceGraph } from "../ZeropsServiceMap";
import { usePlaceAddresses } from "./PlacePanel";
import { PlaceWords } from "./ProjectCards";
import { PlaceDot } from "./ProjectState";
import { serviceRowReading } from "./placeServices.logic";
import { blockAddresses, type PlaceLine } from "./projectCard.logic";

const NO_TOPOLOGY = Atom.make(EMPTY_PROJECT_TOPOLOGY_SNAPSHOT);

/** One resource now, "0.2 / 1 core", and its last day beside it. */
function Meter({
  label,
  metric,
  trend,
  read,
  id,
}: {
  readonly label: string;
  readonly metric: ZeropsServiceMetric | undefined;
  readonly trend: NonNullable<ZeropsServiceRow["trends"]>["cores"] | undefined;
  readonly read: boolean;
  readonly id: string;
}) {
  return (
    <span className="pp-svc-meter">
      <span className="pp-svc-label">{label}</span>
      {!read ? (
        <Skeleton className="h-3 w-12" />
      ) : (
        <span className="pp-svc-figure">
          {metric?.value === undefined
            ? "—"
            : metric.used === undefined
              ? metric.value
              : `${metric.used} / ${metric.value}`}
          {metric?.unit === undefined || metric.value === undefined ? null : (
            <span className="pp-svc-unit">{metric.unit}</span>
          )}
        </span>
      )}
      {trend === undefined ? null : <ResourceGraph id={id} trend={trend} />}
    </span>
  );
}

/** A service as a compact row: name and port, what it is, its CPU and RAM — or its kind alone. */
export function ServiceTile({
  row,
  usageRead,
}: {
  readonly row: ZeropsServiceRow;
  readonly usageRead: boolean;
}) {
  const reading = serviceRowReading({ type: row.service.type, typeShort: row.typeShort });
  const metric = (id: ZeropsServiceMetric["id"]) => row.metrics.find((entry) => entry.id === id);
  return (
    <li className="pp-svc" data-zerops-road-service={row.service.hostname}>
      <span className="pp-svc-name">
        <i aria-hidden="true" className="ov-service-dot" data-tone={row.tone} />
        <span className="truncate">{row.title}</span>
        {row.portLabel === undefined ? null : <span className="pp-svc-port">{row.portLabel}</span>}
      </span>
      {reading.kind === "storage" ? (
        <span className="pp-svc-kind">{reading.words}</span>
      ) : (
        <>
          <span className="pp-svc-kind">{row.typeShort}</span>
          <Meter
            id={`cpu-${row.service.serviceId}`}
            label="CPU"
            metric={metric("cores")}
            read={usageRead}
            trend={row.trends?.cores}
          />
          <Meter
            id={`ram-${row.service.serviceId}`}
            label="RAM"
            metric={metric("memory")}
            read={usageRead}
            trend={row.trends?.memory}
          />
        </>
      )}
    </li>
  );
}

/** A place's services as compact rows; their room held while they are read. */
export function ServiceTiles({
  rows,
  usageRead,
}: {
  readonly rows: ReadonlyArray<ZeropsServiceRow> | undefined;
  readonly usageRead: boolean;
}) {
  if (rows === undefined)
    return (
      <ul className="pp-svcs" aria-hidden="true">
        <li className="pp-svc" data-held="">
          <Skeleton className="h-4 w-full" />
        </li>
      </ul>
    );
  if (rows.length === 0) return null;
  return (
    <ul aria-label="Services" className="pp-svcs">
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
  /** Its line, in the words its block says (`productionWords`, `stageWords`). */
  readonly line: PlaceLine;
  /** What went wrong, in sentences. */
  readonly note: { readonly text: string; readonly tone: "attention" | "failed" } | undefined;
}

/**
 * A place's block. `actions` are what went wrong's buttons, beside its note; `menu` the block's
 * quiet ··· (Roll back).
 */
export function RoadPlace({
  model,
  tiles,
  actions,
  menu,
}: {
  readonly model: RoadPlaceModel;
  readonly tiles: ReactNode;
  readonly actions: ReactNode;
  readonly menu?: ReactNode;
}) {
  const { line } = model;
  const addresses = blockAddresses({
    listed: line.addresses,
    place: usePlaceAddresses(useAccountOrgId(), line.projectId),
  });
  return (
    <div className="pp-road-place" data-zerops-surface="road-place">
      <div className="pp-road-place-top">
        <span className="pp-road-place-health" data-tone={line.trouble ? "failed" : undefined}>
          <PlaceDot dot={line.dot} />
          <PlaceWords line={line} />
        </span>
        {menu}
      </div>
      {addresses.length === 0 ? null : (
        <span className="pp-road-place-links">
          {addresses.map((address) => (
            <a
              className="pp-road-place-link"
              href={address.url}
              key={address.url}
              rel="noreferrer"
              target="_blank"
            >
              {address.host}
              <ArrowUpRightIcon aria-hidden="true" className="size-3" />
            </a>
          ))}
        </span>
      )}
      {model.note === undefined ? null : (
        <div className="pp-road-place-lift">
          <p data-tone={model.note.tone}>{model.note.text}</p>
          <div className="pp-road-place-acts">{actions}</div>
        </div>
      )}
      {tiles}
    </div>
  );
}
