/**
 * A service, the one drawing of a service on a place's page and in a Mate's Zerops panel: its name
 * with its repository or ports under it, what it is, its state, its CPU, RAM and disk against what it
 * holds (each with its last day), and its ··· menu.
 *
 * - `table` (the place's page): one row of columns, the meters in their own column.
 * - `compact` (a Mate's panel): the name and what is under it on one line, the meters under them.
 *
 * Read from `placeServiceRows(code, platform)`; a Mate's own services are
 * `placeServiceRows([], zeropsServiceRows)`.
 */
import type {
  ZeropsServiceMetric,
  ZeropsServiceRow,
} from "@t3tools/client-runtime/zerops/serviceMap";
import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import type { PlaceServiceRow } from "../place/place.logic";
import { ResourceGraph } from "../ZeropsServiceMap";
import { serviceRowState } from "./ServiceRow.logic";

const METERS: ReadonlyArray<{ readonly id: "cores" | "memory" | "disk"; readonly label: string }> =
  [
    { id: "cores", label: "CPU" },
    { id: "memory", label: "RAM" },
    { id: "disk", label: "Disk" },
  ];

/**
 * Props: `row` (`PlaceServiceRow`); `usageRead` (the platform's use is read: until then the meters
 * hold their room); `density` (default `table`); `state` (drawn in place of the row's own state
 * cell, e.g. a job under way); `menuItems` (`MenuItem`s before *Open in Zerops* in its ···);
 * `children` (under the row: what the row has no width for — a job's line, a deploy log).
 * Renders an `<li>`: put it in a `ServiceList`.
 */
export function ServiceRow({
  row,
  usageRead,
  density = "table",
  state,
  menuItems,
  children,
}: {
  readonly row: PlaceServiceRow;
  readonly usageRead: boolean;
  readonly density?: "table" | "compact";
  readonly state?: ReactNode;
  readonly menuItems?: ReactNode;
  readonly children?: ReactNode;
}) {
  const said = state ?? <ServiceState row={row} />;
  const meters =
    row.compute && row.platform !== undefined ? (
      <ServiceMeters row={row.platform} usageRead={usageRead} />
    ) : null;
  const menu = <ServiceMenu menuItems={menuItems} row={row} />;
  if (density === "compact")
    return (
      <li
        className="flex flex-col gap-1 border-t border-border/60 py-2 first:border-t-0"
        data-zerops-service-row="compact"
        data-zerops-place-service={row.hostname}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-body font-medium text-foreground">
            {row.hostname}
          </span>
          {row.under === undefined ? null : (
            <span className="min-w-0 truncate text-caption text-muted-foreground">{row.under}</span>
          )}
          <span className="ms-auto flex shrink-0 items-center gap-2">
            {said}
            {menu}
          </span>
        </div>
        {meters}
        {children}
      </li>
    );
  return (
    <li
      className="flex flex-col gap-1.5 border-t border-border/60 py-2.5 first:border-t-0"
      data-zerops-service-row="table"
      data-zerops-place-service={row.hostname}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 @2xl/services:grid-cols-[minmax(7rem,1.1fr)_minmax(6rem,0.9fr)_minmax(7rem,1fr)_minmax(14rem,1.7fr)_auto]">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium text-foreground">{row.hostname}</span>
          {row.under === undefined ? null : (
            <span className="truncate text-caption text-muted-foreground">{row.under}</span>
          )}
        </span>
        <span className="hidden min-w-0 truncate text-body text-muted-foreground @2xl/services:block">
          {row.type}
        </span>
        <span className="hidden min-w-0 @2xl/services:flex">{said}</span>
        <span className="hidden min-w-0 @2xl/services:flex">{meters}</span>
        <span className="flex items-center justify-end">{menu}</span>
        {/* Narrower than the table: what it is and its state under its name, the meters under them. */}
        <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @2xl/services:hidden">
          {row.type === undefined ? null : (
            <span className="text-body text-muted-foreground">{row.type}</span>
          )}
          {said}
          {meters}
        </span>
      </div>
      {children}
    </li>
  );
}

/**
 * A list of `ServiceRow`s. In `table` density it is the container whose width decides whether a
 * row is one line of columns or stacked.
 */
export function ServiceList({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) {
  return (
    <div className="@container/services min-w-0">
      <ul aria-label={label} className="m-0 flex list-none flex-col p-0">
        {children}
      </ul>
    </div>
  );
}

function ServiceState({ row }: { readonly row: PlaceServiceRow }) {
  const state = serviceRowState(row);
  if (state === undefined) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      {state.tone === undefined ? (
        <span className="min-w-0 text-body text-muted-foreground">{state.word}</span>
      ) : (
        <span className="text-body text-foreground">
          <Badge dot tone={state.tone}>
            {state.word}
          </Badge>
        </span>
      )}
      {state.age === undefined ? null : (
        <span className="text-caption text-muted-foreground">{state.age}</span>
      )}
    </span>
  );
}

function ServiceMenu({
  row,
  menuItems,
}: {
  readonly row: PlaceServiceRow;
  readonly menuItems: ReactNode;
}) {
  const dashboard = row.platform?.dashboardUrl;
  const opens = dashboard !== undefined && dashboard !== "";
  if (!opens && (menuItems === undefined || menuItems === null)) return null;
  return (
    <Menu>
      <MenuTrigger
        render={<Button aria-label={`More for ${row.hostname}`} size="icon-sm" variant="ghost" />}
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        {menuItems}
        {opens ? (
          <MenuItem render={<a href={dashboard} rel="noreferrer" target="_blank" />}>
            Open in Zerops
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/**
 * A compute service's CPU, RAM and disk on one line, each against what it holds with its last day
 * beside it. Props: `row` (the platform's `ZeropsServiceRow`); `usageRead`.
 */
export function ServiceMeters({
  row,
  usageRead,
}: {
  readonly row: ZeropsServiceRow;
  readonly usageRead: boolean;
}) {
  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1"
      data-zerops-place-meters=""
    >
      {METERS.map((meter) => (
        <ServiceMeter
          id={`service-${row.service.serviceId}-${meter.id}`}
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

/** One resource against what the service holds, `0.08/2 GB`, and its last day beside it. */
function ServiceMeter({
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
      <span className="text-caption text-muted-foreground">{label}</span>
      {!usageRead ? (
        <Skeleton className="h-3 w-10" />
      ) : (
        <span className="truncate text-caption font-medium text-foreground tabular-nums">
          {metric?.value === undefined
            ? "—"
            : metric.used === undefined
              ? metric.value
              : `${metric.used}/${metric.value}`}
          {metric?.unit === undefined || metric.value === undefined ? null : (
            <span className="ml-0.5 font-normal text-muted-foreground">{metric.unit}</span>
          )}
        </span>
      )}
      {trend === undefined || trend.length === 0 ? null : <ResourceGraph id={id} trend={trend} />}
    </span>
  );
}
