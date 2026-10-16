/**
 * The views Create and Add land on, loaded while their dialog is open: the press paints the next
 * view at once — never a blank page while its code loads (run 2, 2026-10-16: the page went blank
 * after Add, and again at the hand-over to the Mate's own view).
 */
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

const MATE_VIEWS = ["/_chat/mate/new/$birthId", "/_chat/mate/$projectId"] as const;

export function usePreloadMateViews(): void {
  const router = useRouter();
  useEffect(() => {
    for (const id of MATE_VIEWS) {
      const route = router.routesById[id];
      if (route !== undefined) void router.loadRouteChunk(route);
    }
  }, [router]);
}
