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
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { ExternalLinkIcon } from "lucide-react";

import { Button } from "../ui/button";
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

/** The menu's items, in the order `derivePublicRoutes` sorted the routes. */
export function routeMenuEntries(
  routes: ReadonlyArray<ZeropsPublicRoute>,
): ReadonlyArray<ZeropsRouteMenuEntry> {
  const counts = new Map<string, number>();
  for (const route of routes) counts.set(route.service, (counts.get(route.service) ?? 0) + 1);
  return routes.map((route) => ({
    key: route.url,
    service: route.service,
    port: (counts.get(route.service) ?? 0) > 1 ? route.port : undefined,
    host: route.host,
    url: route.url,
  }));
}

/** The public-access group of a menu: a label, then a route per item. */
export function ZeropsRouteMenuItems({
  routes,
  label = "Public access",
}: {
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly label?: string;
}) {
  const entries = routeMenuEntries(routes);
  return (
    <MenuGroup data-zerops-surface="public-routes">
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {entries.length === 0 ? (
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
    </MenuGroup>
  );
}

const ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** The left menu's glyph beside an environment: the route itself, or the routes as a menu. */
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
              className={ICON_BUTTON_CLASS}
              data-zerops-surface="public-routes-menu"
              href={only.url}
              rel="noreferrer"
              target="_blank"
            />
          }
        >
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">{only.host}</TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={label}
            className="size-6 text-muted-foreground hover:text-foreground"
            data-zerops-surface="public-routes-menu"
            size="icon"
            variant="ghost"
          />
        }
      >
        <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-48 max-w-[24rem]">
        <ZeropsRouteMenuItems routes={routes} />
      </MenuPopup>
    </Menu>
  );
}
