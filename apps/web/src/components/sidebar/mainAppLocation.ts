import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

// Settings, a project's settings and Usage replace the sidebar account row with
// a Back button. Everything else is the main app, the projects screen (/zerops)
// included: it is the root of a Zerops account, not somewhere else.
export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    /^\/projects\/[^/]+\/?$/.test(pathname) ||
    pathname === "/usage"
  );
}

let mainAppHref: string | null = null;

// Mount once in the app shell. Records the latest main app URL so Back can
// return there no matter how many utility pages were visited since.
export function MainAppLocationTracker() {
  const href = useLocation({
    select: (location) => (isSidebarUtilityPage(location.pathname) ? null : location.href),
  });
  useEffect(() => {
    if (href !== null) mainAppHref = href;
  }, [href]);
  return null;
}

// Leaves a utility page for the last main app URL, or the thread list when
// the app was opened directly on a utility page.
export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return useCallback(() => navigate({ href: mainAppHref ?? "/" }), [navigate]);
}
