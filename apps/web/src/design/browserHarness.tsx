/**
 * The Browser tab in the right panel as the app lays it out at the owner's size: 1786 wide, the
 * left menu at 435 (`?menu=` for another), the panel at its default 540 beside the conversation.
 * `?tab=list` (the default) shows the sites list; `?tab=site` an open site's tab. `?theme=dark`
 * for dark.
 *
 * The real `BrowserSites`, `ZeropsBrowserPanel` and `ServiceBrowserPanels` in the real
 * `RightPanelTabs`, over nextstore's invented sites. Served by the dev server at
 * `/design-browser.html`. Fixtures only: nothing here ships, and no route imports this module.
 */
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RightPanelPage } from "~/components/RightPanelPage";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { ServiceBrowserPanels } from "~/components/ServiceBrowserPanel";
import { ZeropsBrowserPanel } from "~/components/zerops/ZeropsBrowserPanel";
import { BrowserSites } from "~/components/zerops/ZeropsBrowserSurface";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import type { RightPanelSurface } from "~/rightPanelStore";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { mateAddresses } from "~/zerops/mateAddresses.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const TAB = params.get("tab") ?? "list";
const MENU = Number(params.get("menu") ?? 435);
const noop = () => {};

const THREAD_REF = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const url = (host: string) => `https://${host}.prg1.zerops.app`;
const service = (hostname: string, host: string): ZeropsTopologyService => ({
  hostname,
  serviceId: hostname,
  type: "nodejs@22",
  status: "ACTIVE",
  group: "runtimes",
  transient: false,
  ports: [],
  routes: [{ url: url(host), host: `${host}.prg1.zerops.app`, port: 8000 }],
});

const SERVICES = [
  service("medusadev", "medusadev-a1b2-9000"),
  service("medusastage", "medusastage-a1b2-9000"),
  service("nextstoredev", "nextstoredev-a1b2-8000"),
  service("nextstorestage", "nextstorestage-a1b2-8000"),
  service("mailpit", "mailpit-a1b2-8025"),
];

const ADDRESSES = mateAddresses({
  services: SERVICES,
  environments: [
    {
      projectId: "p-prod",
      name: "nextstore production",
      role: "prod",
      routes: [
        { service: "medusa", url: url("medusa-c3d4-9000") },
        { service: "nextstore", url: url("nextstore-c3d4-8000") },
      ],
    },
  ],
});

const SITE = ADDRESSES.find((address) => address.service === "nextstore production")!;
const SURFACES: RightPanelSurface[] = [
  { id: "browser", kind: "browser" },
  { id: `service:${SITE.service}`, kind: "browser", service: SITE.service, url: SITE.url },
];

function Harness() {
  const active = TAB === "site" ? SURFACES[1]!.id : "browser";
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1" />
      <RightPanelTabs
        activeSurfaceId={active}
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: "applied",
        })}
        defaultWidth={540}
        liveAgentCount={0}
        maximized={false}
        mode="inline"
        onActivate={noop}
        onAdd={noop}
        onAddTerminal={noop}
        onCloseAllSurfaces={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurface={noop}
        onCloseSurfacesToRight={noop}
        onCopyFilePath={noop}
        pendingSurfaceIds={new Set()}
        surfaces={SURFACES}
        terminalLabelsById={new Map()}
        widthStorageKey="mate:design-browser:panel-width"
      >
        {TAB === "site" ? null : (
          <RightPanelPage kind="browser" mate="Juno">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-6 px-4 pt-4 pb-6">
                <BrowserSites addresses={ADDRESSES} threadRef={THREAD_REF} />
                <ZeropsBrowserPanel mateName="Juno" threadRef={THREAD_REF} />
              </div>
            </div>
          </RightPanelPage>
        )}
        <ServiceBrowserPanels
          activeSurfaceId={active}
          addresses={ADDRESSES}
          services={SERVICES}
          surfaces={SURFACES}
        />
      </RightPanelTabs>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
