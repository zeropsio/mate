import { useLocation } from "@tanstack/react-router";

import { BOOT_WAIT_LINE_MS, LOADING_LINE, routePendingLine } from "~/zerops/waitLine.logic";
import { PageWaitLine, WaitLine } from "./zerops/WaitLine";

/** Keep the requested surface's space while its code is being loaded. */
export function SurfaceLoading() {
  return (
    <div className="flex h-full min-h-32 flex-1 items-center justify-center" role="status">
      <WaitLine text={LOADING_LINE} />
    </div>
  );
}

/**
 * The router's wait while a route's code loads (`routePendingLine`): the overview's route says the
 * overview's own line at the page's centre, from the page's load as the boot frame says it.
 */
export function RoutePending() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const line = routePendingLine(pathname);
  if (line === LOADING_LINE) return <SurfaceLoading />;
  return <PageWaitLine delayMs={BOOT_WAIT_LINE_MS} from="load" text={line} />;
}
