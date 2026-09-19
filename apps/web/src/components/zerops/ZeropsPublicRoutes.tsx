/**
 * Where an environment is reachable from outside: its public routes
 * (`derivePublicRoutes`), in the two places the product offers them.
 *
 * In a menu, as a group: one item per route — the service as the developer
 * names it (`app`, `api`; with its port when one service answers on several),
 * the host in a muted hand, a click that opens it. Six public services are
 * six items in a menu that scrolls, never six chips in a row and never a
 * column of hostnames; and when nobody can reach the environment yet, the
 * group says so instead of vanishing, so a person learns where to look next
 * time. The icon menu is the left menu's, where there is room for one glyph
 * beside a name.
 */
import type { ZeropsPublicRoute, ZeropsRouteOffer } from "@t3tools/client-runtime/zerops";
import { ExternalLinkIcon, GlobeIcon } from "lucide-react";

import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ZeropsRouteMenuEntry {
  readonly key: string;
  readonly service: string;
  /** Written only where one service answers on several ports; one port needs no number. */
  readonly port: number | undefined;
  readonly host: string;
  readonly url: string;
}

/**
 * The menu's items, in the order `derivePublicRoutes` sorted the routes.
 *
 * A port is written only where it tells the two apart — where one service
 * answers on more than one of them. A service reached at four domains on the
 * same port is the ordinary shape of a production, and `app:80` written four
 * times over says nothing while looking like it does.
 */
export function routeMenuEntries(
  routes: ReadonlyArray<ZeropsPublicRoute>,
): ReadonlyArray<ZeropsRouteMenuEntry> {
  const ports = new Map<string, Set<number>>();
  for (const route of routes) {
    const seen = ports.get(route.service) ?? new Set<number>();
    seen.add(route.port);
    ports.set(route.service, seen);
  }
  return routes.map((route) => ({
    key: route.url,
    service: route.service,
    port: (ports.get(route.service)?.size ?? 0) > 1 ? route.port : undefined,
    host: route.host,
    url: route.url,
  }));
}

/**
 * The public-access group of a menu: a label, then a route per item, then
 * whatever could be published and is not.
 *
 * An offer is an ordinary item, not a recovery affordance tucked away: the
 * question "where is this reachable" and "why is it not" are the same question,
 * and a person asking the first is exactly the person who needs the second.
 * "None yet" is only honest when there is also nothing to offer.
 */
export function ZeropsRouteMenuItems({
  routes,
  offers = [],
  onEnable,
  enablingServiceId = null,
  label = "Public access",
}: {
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** Services that serve HTTP with their subdomain off (`publicRoutes.ts`). */
  readonly offers?: ReadonlyArray<ZeropsRouteOffer>;
  readonly onEnable?: (offer: ZeropsRouteOffer) => void;
  readonly enablingServiceId?: string | null;
  readonly label?: string;
}) {
  const entries = routeMenuEntries(routes);
  const offered = onEnable === undefined ? [] : offers;
  return (
    <MenuGroup data-zerops-surface="public-routes">
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {entries.length === 0 && offered.length === 0 ? (
        <MenuItem data-zerops-surface="public-routes-empty" disabled>
          None yet
        </MenuItem>
      ) : (
        entries.map((entry) => (
          <MenuItem
            data-zerops-surface="public-route"
            key={entry.key}
            render={<a href={entry.url} rel="noreferrer" target="_blank" />}
          >
            <span className="shrink-0 font-medium">
              {entry.service}
              {entry.port === undefined ? null : (
                <span className="font-normal text-muted-foreground">:{entry.port}</span>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.host}</span>
            <ExternalLinkIcon aria-hidden="true" />
          </MenuItem>
        ))
      )}
      {offered.map((offer) => (
        <MenuItem
          closeOnClick={false}
          data-zerops-surface="public-route-offer"
          disabled={enablingServiceId !== null}
          key={`offer:${offer.serviceId}`}
          onClick={() => onEnable?.(offer)}
        >
          <GlobeIcon aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {enablingServiceId === offer.serviceId ? "Publishing" : "Publish"}{" "}
            <span className="font-medium">{offer.service}</span>
          </span>
        </MenuItem>
      ))}
    </MenuGroup>
  );
}

/**
 * The left menu's public-access control: a globe and **how many**.
 *
 * Neither of the two obvious answers survives ten routes. Writing the host out
 * spends most of a 256px row on one of them and looks ridiculous at ten (the
 * owner, 2026-09-19). A bare arrow fits any number and says nothing about any
 * of them — "the open in new is ambiguous, everything could have more public
 * urls/ips" — and, worse, two routes and ten drew identically, so the menu hid
 * the very fact a person opens it to learn.
 *
 * The count is the smallest thing that is honest at both ends: it is the same
 * width at 1 and at 10, it never claims a URL it is not opening, and it says
 * there are others before the person has to guess. One route still opens
 * directly, because a menu holding a single item is a click spent on nothing;
 * its host is the hover.
 */
export function ZeropsRoutesMenu({
  routes,
  label,
}: {
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** Whose routes these are — read by assistive technology. */
  readonly label: string;
}) {
  if (routes.length === 0) return null;
  const [only] = routes;
  if (routes.length === 1 && only !== undefined) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              aria-label={`${label}: ${only.host}`}
              className={ROUTE_COUNT_CLASS}
              data-zerops-surface="public-routes-menu"
              href={only.url}
              rel="noreferrer"
              target="_blank"
            />
          }
        >
          <GlobeIcon aria-hidden="true" className="size-3.5" />
          <span className="tabular-nums">1</span>
        </TooltipTrigger>
        <TooltipPopup side="right">{only.host}</TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${label}: ${routes.length} public URLs`}
        className={ROUTE_COUNT_CLASS}
        data-zerops-surface="public-routes-menu"
      >
        <GlobeIcon aria-hidden="true" className="size-3.5" />
        <span className="tabular-nums">{routes.length}</span>
      </MenuTrigger>
      <MenuPopup align="end" className="max-w-[24rem] min-w-48">
        <ZeropsRouteMenuItems routes={routes} />
      </MenuPopup>
    </Menu>
  );
}

const ROUTE_COUNT_CLASS =
  "inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 text-[11px] leading-none text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";
