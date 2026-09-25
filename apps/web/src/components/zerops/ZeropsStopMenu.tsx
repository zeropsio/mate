import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { StopView } from "@t3tools/client-runtime/zerops/flow";
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
  onOpenProject,
  onOpenStop,
  triggerClassName,
}: {
  readonly name: string;
  /** What the stop runs, or the line that stands in for it while that is not known. */
  readonly stop: StopView;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly onOpenProject: () => void;
  readonly onOpenStop: (() => void) | undefined;
  /** The trigger's look, which is the surface's: sidebar tokens there, page tokens on a page. */
  readonly triggerClassName: string;
}) {
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
          {/* A fact, not a door: the commit's page in Gitea is a sign-in page
              for everybody, and the environment's own page is right below. */}
          <MenuItem disabled>{detail}</MenuItem>
          {/* The question people actually ask of a version is what came before
              it, and a commit page answers only for one — and, with no Gitea
              session in the browser, answers it with a sign-in page. */}
          {onOpenStop === undefined ? null : (
            <MenuItem onClick={onOpenStop}>Open this environment</MenuItem>
          )}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={onOpenProject}>Open in Zerops</MenuItem>
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
