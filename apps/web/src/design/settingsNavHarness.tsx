/**
 * The settings nav (`SettingsSidebarNav`) at the owner's 435 px: its sections grouped by whose
 * settings they are, Appearance open, for a made-up viewer in the organization Acme.
 *
 * Served by the dev server at `/design-settings-nav.html` (`?theme=dark`); open it at
 * 1786 × 1000. `?org=none` signed in without an organization: Team and Personas leave the nav.
 * `?page=` another section's path (`/settings/zerops`).
 * Fixtures only: no route imports this module.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";

import { SettingsSidebarNav } from "~/components/settings/SettingsSidebarNav";
import { Sidebar, SidebarProvider } from "~/components/ui/sidebar";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import type { ZeropsSessionValue } from "~/zerops/ZeropsSessionProvider";
import { ZeropsSessionContext } from "~/zerops/sessionContext";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const page = params.get("page") ?? "/settings/appearance";
const MENU_WIDTH = 435;

const VIEWER = {
  user: { id: "u-dana" },
  activeOrganization:
    params.get("org") === "none" ? null : { id: "org-acme", name: "Acme", roleCode: "OWNER" },
} as unknown as ZeropsSessionValue;

function HarnessPage() {
  return (
    <ZeropsSessionContext.Provider value={VIEWER}>
      <SidebarProvider
        className="flex h-dvh"
        style={{ "--sidebar-width": `${String(MENU_WIDTH)}px` } as CSSProperties}
      >
        <Sidebar side="left">
          <SettingsSidebarNav pathname={page} />
        </Sidebar>
        <main className="min-w-0 flex-1" />
      </SidebarProvider>
    </ZeropsSessionContext.Provider>
  );
}

const rootRoute = createRootRoute({ component: HarnessPage });
const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/settings/$section" }),
  ]),
  history: createMemoryHistory({ initialEntries: [page] }),
});

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
