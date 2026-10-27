import { useLocation } from "@tanstack/react-router";

import { overviewStandsIn } from "~/zerops/waitLine.logic";
import { Loading } from "./ui/loading";
import { SidebarInset } from "./ui/sidebar";
import { OverviewStandIn } from "./zerops/projects/OverviewStandIn";

/**
 * What a page that cannot draw yet stands in with (`overviewStandsIn`): on the overview's route the
 * overview's own shape, painted once; on any other its room, held, with nothing painted that it
 * would take back. The router's pending page, the chat layout's, the door's and HQ's member read
 * all wait with it.
 */
export function PageStandIn() {
  const pathname = useLocation({ select: (location) => location.pathname });
  if (overviewStandsIn(pathname)) return <OverviewStandIn />;
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
      <Loading label="The page" shape="room" />
    </SidebarInset>
  );
}

/** The router's wait while a route's code loads. */
export function RoutePending() {
  const pathname = useLocation({ select: (location) => location.pathname });
  if (overviewStandsIn(pathname)) return <OverviewStandIn />;
  return <Loading label="The page" shape="room" />;
}
