import { useLocation } from "@tanstack/react-router";

import { BOOT_WAIT_LINE_MS, routePendingLine } from "~/zerops/waitLine.logic";
import { Loading } from "./ui/loading";
import { PageWaitLine } from "./zerops/WaitLine";

/**
 * The router's wait while a route's code loads (`routePendingLine`): the overview's route says the
 * overview's own line at the page's centre, from the page's load as the boot frame says it; any
 * other route holds its room and paints nothing it would take back.
 */
export function RoutePending() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const line = routePendingLine(pathname);
  if (line === null) return <Loading label="The page" shape="room" />;
  return <PageWaitLine delayMs={BOOT_WAIT_LINE_MS} from="load" text={line} />;
}
