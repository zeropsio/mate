/**
 * Where an environment is reachable from outside: its public routes
 * (`derivePublicRoutes`), in the two shapes the product needs.
 *
 * Chips are the projects screen's: one chip per service, named as the
 * developer names it (`app`, `api`), that opens the service's public URL —
 * or offers them, when one service answers on several ports. An environment
 * with six public services is six small words, not six hostnames; the host
 * is a tooltip away and a click away, never a column. The icon menu is the
 * left menu's, where there is room for one glyph beside a name.
 */
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { ExternalLinkIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Routes by service, in the order `derivePublicRoutes` sorted them. */
export function groupRoutesByService(
  routes: ReadonlyArray<ZeropsPublicRoute>,
): ReadonlyArray<{ readonly service: string; readonly routes: ReadonlyArray<ZeropsPublicRoute> }> {
  const byService = new Map<string, Array<ZeropsPublicRoute>>();
  for (const route of routes) {
    const bucket = byService.get(route.service);
    if (bucket) bucket.push(route);
    else byService.set(route.service, [route]);
  }
  return [...byService.entries()].map(([service, entries]) => ({ service, routes: entries }));
}

const CHIP_CLASS =
  "relative z-[1] inline-flex h-6 max-w-40 items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 text-xs text-foreground/80 transition-colors hover:border-border hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export function ZeropsRouteChips({
  routes,
  label,
  className,
}: {
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** Whose routes these are — read by assistive technology. */
  readonly label: string;
  readonly className?: string;
}) {
  if (routes.length === 0) {
    return (
      // A dash where a table has a column for it; on a phone, where the cell
      // is a line of its own, nothing is the quieter answer.
      <span
        aria-label={`${label}: none`}
        className={cn("hidden text-xs text-muted-foreground/50 md:inline", className)}
        data-zerops-surface="public-routes-empty"
      >
        —
      </span>
    );
  }
  return (
    <ul
      aria-label={label}
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
      data-zerops-surface="public-routes"
    >
      {groupRoutesByService(routes).map(({ service, routes: entries }) => {
        const [only] = entries;
        return (
          <li className="flex min-w-0" key={service}>
            {entries.length === 1 && only !== undefined ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <a
                      className={CHIP_CLASS}
                      data-zerops-surface="public-route"
                      href={only.url}
                      rel="noreferrer"
                      target="_blank"
                    />
                  }
                >
                  <span className="truncate">{service}</span>
                  <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
                </TooltipTrigger>
                <TooltipPopup>{only.host}</TooltipPopup>
              </Tooltip>
            ) : (
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      aria-label={`${service}: ${entries.length} public ports`}
                      className={CHIP_CLASS}
                      data-zerops-surface="public-route"
                      type="button"
                    />
                  }
                >
                  <span className="truncate">{service}</span>
                  <span className="text-muted-foreground">{entries.length}</span>
                  <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
                </MenuTrigger>
                <MenuPopup align="start">
                  {entries.map((route) => (
                    <MenuItem
                      key={route.url}
                      render={<a href={route.url} rel="noreferrer" target="_blank" />}
                    >
                      <span className="truncate">{route.host}</span>
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

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
      <MenuPopup align="end">
        {routes.map((route) => (
          <MenuItem
            key={route.url}
            render={<a href={route.url} rel="noreferrer" target="_blank" />}
          >
            <span className="truncate">
              {route.service} · {route.host}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
