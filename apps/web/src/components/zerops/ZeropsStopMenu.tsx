import { useAddressesSheet } from "~/zerops/addressesSheet";
import { usePublicAccess } from "~/zerops/usePublicAccess";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { StopPublicAccessStatus } from "./StopPublicAccess";
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { StopView } from "@t3tools/client-runtime/zerops/flow";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { MoreHorizontalIcon } from "lucide-react";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ZeropsRouteMenuItems } from "./ZeropsPublicRoutes";

/**
 * A stop's own menu — the thing the rows did not have.
 *
 * "Still there is no more menu on prod / stage that would allow me to do
 * stuff" (the owner, 2026-09-19). It holds what a row has no width for: what
 * is actually running, spelled out, and every public URL, which is also the
 * keyboard's way to them. The changes a stop does not run yet are its
 * distance's to list, opened on the left menu's row itself.
 *
 * One menu wherever a stop is drawn: the left menu's row and the stop's own
 * page open the same one, each trigger in its own surface's hand.
 */
export function ZeropsStopMenu({
  name,
  stop,
  routes,
  projectId,
  groupId,
  onOpenStop,
  triggerClassName,
  rollBack,
}: {
  readonly name: string;
  /** What the stop runs, or the line that stands in for it while that is not known. */
  readonly stop: StopView;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly projectId: string;
  /** The application whose places the addresses sheet's switch offers; absent outside one. */
  readonly groupId?: string | undefined;
  readonly onOpenStop: (() => void) | undefined;
  /** The trigger's look, which is the surface's: sidebar tokens there, page tokens on a page. */
  readonly triggerClassName: string;
  /**
   * A production's way back: the release it rolls back to, whose review opens from the item. Only
   * the production's own page offers it, never the project's road.
   */
  readonly rollBack?: {
    readonly tag: string;
    readonly onRollBack: (from: HTMLElement) => void;
  };
}) {
  const publicAccess = usePublicAccess(projectId);
  const orgId = useAccountOrgId();
  routes = publicAccess.bound ? publicAccess.routes : routes;
  // `v1.4.0 · 77ab0e1 · tagged by ada` — the whole of what one row abbreviates.
  const version = stop.version;
  const detail =
    version?.label === undefined
      ? stop.line
      : [
          version.label,
          version.name === undefined ? undefined : version.commit,
          version.taggedBy === undefined ? undefined : `tagged by ${version.taggedBy}`,
        ]
          .filter((part) => part !== undefined)
          .join(" · ");
  return (
    <Menu>
      <MenuTrigger
        aria-label={`More for ${name}`}
        className={triggerClassName}
        data-zerops-surface="stop-menu"
      >
        <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" className="max-w-[24rem] min-w-56">
        <MenuGroup data-zerops-surface="stop-menu-running">
          <MenuGroupLabel>Running</MenuGroupLabel>
          {/* A fact, not a door: the environment's own page is right below. */}
          <MenuItem disabled>{detail}</MenuItem>
          {/* The question people actually ask of a version is what came before
              it, and a commit page answers only for one. */}
          {onOpenStop === undefined ? null : (
            <MenuItem onClick={onOpenStop}>Open this environment</MenuItem>
          )}
        </MenuGroup>
        <MenuSeparator />
        {rollBack === undefined ? null : (
          <>
            <MenuItem
              onClick={(event) => {
                rollBack.onRollBack(event.currentTarget);
              }}
            >
              Roll back to {rollBack.tag}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {orgId === null ? null : (
          <MenuItem
            onClick={() => {
              useAddressesSheet
                .getState()
                .open({ orgId, projectId, ...(groupId === undefined ? {} : { groupId }) });
            }}
          >
            Addresses
          </MenuItem>
        )}
        <MenuItem
          render={<a href={zeropsProjectUrl(projectId)} rel="noreferrer" target="_blank" />}
        >
          Open in Zerops
        </MenuItem>
        <StopPublicAccessStatus access={publicAccess} />
        {routes.length === 0 ? null : (
          <>
            <MenuSeparator />
            <ZeropsRouteMenuItems routes={routes} />
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
