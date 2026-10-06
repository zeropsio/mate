import { usePublicAccess } from "~/zerops/usePublicAccess";
import { StopPublicAccessStatus } from "./StopPublicAccess";
/**
 * The quiet actions on the projects screen — a Mate's, an environment's, a
 * project's. One trigger, a short menu: the environment's public access
 * first, as a group, when the caller knows it; then the actions. What each
 * action does belongs to the caller.
 */
import type { ZeropsPublicRoute, ZeropsRouteOffer } from "@t3tools/client-runtime/zerops";
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ZeropsRouteMenuItems } from "./ZeropsPublicRoutes";

export interface ZeropsMenuAction {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  /** Shown but not clickable — e.g. a check already running. */
  readonly disabled?: boolean;
  /** A verb that takes something away for good: drawn in red, last, a line apart. */
  readonly variant?: "destructive";
  /** Why the verb is offered, where its label alone does not say: its tooltip. */
  readonly why?: string;
}

/** A line between two groups of actions — the quick ones above, the quiet ones below. */
export interface ZeropsMenuSeparator {
  readonly id: string;
  readonly separator: true;
}

export type ZeropsMenuEntry = ZeropsMenuAction | ZeropsMenuSeparator;

export function ZeropsProjectMenu({
  label,
  projectId,
  actions,
  routes,
  offers,
  onEnableRoute,
  enablingServiceId,
}: {
  /** What the trigger is for, read by assistive tech. */
  readonly label: string;
  readonly projectId?: string | undefined;
  readonly actions: ReadonlyArray<ZeropsMenuEntry>;
  /**
   * The environment's public routes. Absent means unknown, and the group is
   * left out; an empty list is known, and the group says so.
   */
  readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
  /** What could be published and is not (`publicRoutes.ts`). */
  readonly offers?: ReadonlyArray<ZeropsRouteOffer> | undefined;
  readonly onEnableRoute?: (offer: ZeropsRouteOffer) => void;
  readonly enablingServiceId?: string | null;
}): ReactNode {
  const publicAccess = usePublicAccess(projectId);
  routes = publicAccess.bound ? publicAccess.routes : routes;
  offers = publicAccess.bound ? publicAccess.offers : offers;
  if (actions.length === 0 && routes === undefined && projectId === undefined) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={label}
            className="size-7 text-muted-foreground"
            size="icon"
            variant="ghost"
          />
        }
      >
        <EllipsisIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-48 max-w-[24rem]">
        <StopPublicAccessStatus access={publicAccess} />
        {routes === undefined ||
        (publicAccess.bound && publicAccess.state !== "ready" && routes.length === 0) ? null : (
          <ZeropsRouteMenuItems
            enablingServiceId={enablingServiceId ?? null}
            offers={offers ?? []}
            routes={routes}
            {...(onEnableRoute === undefined ? {} : { onEnable: onEnableRoute })}
          />
        )}
        {routes !== undefined && actions.length > 0 ? <MenuSeparator /> : null}
        {actions.map((entry) =>
          "separator" in entry ? (
            <MenuSeparator key={entry.id} />
          ) : (
            <MenuItem
              key={entry.id}
              disabled={entry.disabled === true}
              onClick={entry.onSelect}
              title={entry.why}
              variant={entry.variant ?? "default"}
            >
              {entry.label}
            </MenuItem>
          ),
        )}
      </MenuPopup>
    </Menu>
  );
}
