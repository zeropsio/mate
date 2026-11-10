/**
 * A service, the one drawing of a service on a place's page and in a Mate's Zerops panel: a card of
 * its own — its name and what it is on top, one quiet line under them, its ··· at the right — and
 * its CPU, RAM and disk as three labelled bars, each against what the service holds.
 *
 * - `page` (the place's aside): what it is beside its name; under them what it runs (`facts`) or
 *   its ports.
 * - `panel` (a Mate's panel): its ports beside what it is, on the name's line; nothing under it but
 *   what the caller hands in.
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
import { cn } from "~/lib/utils";
import type { PlaceServiceRow } from "../place/place.logic";
import { meterFill, meterReading, serviceRowState } from "./ServiceRow.logic";

const METERS: ReadonlyArray<{ readonly id: "cores" | "memory" | "disk"; readonly label: string }> =
  [
    { id: "cores", label: "CPU" },
    { id: "memory", label: "RAM" },
    { id: "disk", label: "Disk" },
  ];

/**
 * Props: `row` (`PlaceServiceRow`); `usageRead` (the platform's use is read: until then the meters
 * hold their room); `density` (default `page`); `facts` (the quiet line under the name, in place of
 * its ports: what it runs); `state` (drawn in place of the row's own state word, e.g. a job under
 * way); `actions` (before the ···: a service's address buttons, a database's Data); `menuItems`
 * (`MenuItem`s before *Open in Zerops* in its ···); `children` (under the meters: what is not calm —
 * a job's line, a deploy log). Renders an `<li>`: put it in a `ServiceList`.
 */
export function ServiceRow({
  row,
  usageRead,
  density = "page",
  facts,
  state,
  actions,
  menuItems,
  children,
}: {
  readonly row: PlaceServiceRow;
  readonly usageRead: boolean;
  readonly density?: "page" | "panel";
  readonly facts?: ReactNode;
  readonly state?: ReactNode;
  readonly actions?: ReactNode;
  readonly menuItems?: ReactNode;
  readonly children?: ReactNode;
}) {
  const said = state === undefined ? <ServiceState row={row} /> : state;
  const panel = density === "panel";
  const kind = panel
    ? [row.type, row.under].filter((part) => part !== undefined && part !== "").join(" · ")
    : row.type;
  const under = panel ? facts : (facts ?? row.under);
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border/70 bg-card",
        panel ? "gap-3 px-3.5 pt-3 pb-3.5" : "gap-3.5 px-4 pt-3.5 pb-4",
      )}
      data-zerops-service-row={density}
      data-zerops-place-service={row.hostname}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* Its hostname, a real thing's own name: the mono face (`.real-name`). */}
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              <span className="real-name">{row.hostname}</span>
            </span>
            {kind === undefined || kind === "" ? null : (
              <span className="min-w-0 truncate text-caption text-muted-foreground">{kind}</span>
            )}
            {said}
          </div>
          {under === undefined || under === null ? null : (
            <div className="min-w-0 truncate text-caption text-muted-foreground/80">{under}</div>
          )}
        </div>
        <span className="-me-1.5 -mt-0.5 flex shrink-0 items-center gap-0.5">
          {actions}
          <ServiceMenu menuItems={menuItems} row={row} />
        </span>
      </div>
      {row.compute && row.platform !== undefined ? (
        <ServiceMeters row={row.platform} usageRead={usageRead} />
      ) : null}
      {children}
    </li>
  );
}

/** A list of `ServiceRow`s, each its own card with room between them. */
export function ServiceList({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) {
  return (
    <ul aria-label={label} className="m-0 flex min-w-0 list-none flex-col gap-2.5 p-0">
      {children}
    </ul>
  );
}

/** A state that is not calm, in its words beside the name; a calm one says nothing. */
function ServiceState({ row }: { readonly row: PlaceServiceRow }) {
  const state = serviceRowState(row);
  if (state === undefined) return null;
  return (
    <Badge tone={state.tone ?? "neutral"}>
      {state.age === undefined ? state.word : `${state.word} · ${state.age}`}
    </Badge>
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
 * A compute service's CPU, RAM and disk as three labelled bars side by side, each `used / limit
 * unit` over its bar, filled by use and amber once nearly full. Props: `row` (the platform's
 * `ZeropsServiceRow`); `usageRead`; `tone` (the bars' ink: `info`, or `ok` on a Mate's home).
 */
export function ServiceMeters({
  row,
  usageRead,
  tone = "info",
}: {
  readonly row: ZeropsServiceRow;
  readonly usageRead: boolean;
  readonly tone?: "info" | "ok" | undefined;
}) {
  return (
    <div
      className="@container/meters grid min-w-0 grid-cols-3 items-end gap-x-4 gap-y-2"
      data-zerops-place-meters=""
      data-zerops-service-resources=""
    >
      {METERS.map((meter) => (
        <ServiceMeter
          key={meter.id}
          label={meter.label}
          metric={row.metrics.find((metric) => metric.id === meter.id)}
          tone={tone}
          usageRead={usageRead}
        />
      ))}
    </div>
  );
}

/** One resource against what the service holds, `0.19 / 2 GB`, over its bar. */
function ServiceMeter({
  label,
  metric,
  tone,
  usageRead,
}: {
  readonly label: string;
  readonly metric: ZeropsServiceMetric | undefined;
  readonly tone: "info" | "ok";
  readonly usageRead: boolean;
}) {
  const reading = meterReading(metric);
  const fill = usageRead ? meterFill(metric) : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-zerops-place-meter={label}>
      {/* Where the three do not fit their figures beside their labels (the box is under 448 px),
          all three stand them under: one meter wrapping alone left its label a line higher than
          its neighbours'. */}
      <div className="flex min-w-0 flex-col items-start text-caption @md/meters:flex-row @md/meters:items-baseline @md/meters:justify-between @md/meters:gap-x-2">
        <span className="shrink-0 text-muted-foreground">{label}</span>
        {!usageRead ? (
          <Skeleton className="h-3 w-12" />
        ) : (
          <span className="whitespace-nowrap text-foreground tabular-nums">
            {reading.used}
            {reading.of === undefined ? null : (
              <span className="text-muted-foreground">{` / ${reading.of}`}</span>
            )}
          </span>
        )}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "h-1 overflow-hidden rounded-full",
          tone === "ok" ? "bg-status-ok/15" : "bg-muted-foreground/15",
        )}
      >
        {fill === undefined ? null : (
          <div
            className={cn(
              "h-full w-full origin-left rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none",
              fill.high ? "bg-status-attention" : tone === "ok" ? "bg-status-ok" : "bg-info",
            )}
            data-zerops-meter-high={fill.high || undefined}
            style={{ transform: `scaleX(${String(fill.fraction)})` }}
          />
        )}
      </div>
    </div>
  );
}
