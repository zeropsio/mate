/**
 * An account's first run, walked through: the whole window with no menu — Mate's mark, the account
 * in the corner — meeting its first Mate (`FirstRunView`), the New project form as the page's card,
 * and Create landing on the first Mate's page as `mate-birth` does, the face going from the
 * screen's hero to the page's seat, the steps a fake press moves advancing under it
 * (`pressPage.tsx`). In the app the menu arrives with that page.
 *
 * Served by the dev server at `/design-firstrun.html` (`?theme=dark`; `?role=developer` — one who
 * starts projects but reaches only the ones given; `reader` — one who sees every project but starts
 * none; `guest` — one who sees only what is shared; `?places=2` — an account with two places).
 * Open it at the owner's 1786 × 1000. `window.__firstRunHarness.create()` names the project and
 * presses Create, for a script that records the transition.
 *
 * Fixtures only. Nothing here ships — `design-firstrun.html` is not `index.html`, and no route
 * imports this module.
 */
import { newMateTint, zeropsAccountDisplay } from "@t3tools/client-runtime/zerops";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { SidebarProvider } from "~/components/ui/sidebar";
import { FirstRunFormView, FirstRunView } from "~/components/zerops/projects/FirstRun";
import { SidebarZeropsAccount } from "~/components/zerops/SidebarZeropsAccount";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import type { AppRouter } from "~/router";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";
import { beginHarnessPress, HarnessPressPage } from "./pressPage";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const ROLE = params.get("role");
const CREATES = ROLE !== "reader" && ROLE !== "guest";
const REACHES_EVERY_PROJECT = ROLE !== "developer" && ROLE !== "guest";
const PLACES =
  params.get("places") === "2"
    ? [
        { id: "prg1", name: "Prague" },
        { id: "ams1", name: "Amsterdam" },
      ]
    : [{ id: "prg1", name: "Prague" }];

const ACCOUNT = zeropsAccountDisplay({
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  firstName: "Ada",
});
const ORGANIZATION = { id: "org-acme", name: "Acme", membershipId: "m-acme", roleCode: "OWNER" };

/** *Project access* in an organization of one: its line, nothing to change. */
function harnessAccess() {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">Project access</span>
      <p className="text-sm text-muted-foreground">
        Only you can open it: you're the only person in Acme so far.
      </p>
    </div>
  );
}

/** Create's landing as the router's `mate-birth` transition plays it in the app. */
function birthTransition(update: () => void): void {
  if (!("startViewTransition" in document) || prefersReducedMotion()) return update();
  document.startViewTransition({ update: () => flushSync(update), types: ["mate-birth"] });
}

/** The account in the screen's corner, as the app wires it. */
const account = (
  <SidebarZeropsAccount
    account={ACCOUNT}
    activeOrganization={ORGANIZATION}
    destination={null}
    destinationIcon={() => null}
    onGo={() => {}}
    onSelectOrganization={() => {}}
    onSignOut={() => {}}
    organizations={[ORGANIZATION]}
    unlisted
  />
);

function Harness() {
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    (window as unknown as { __firstRunHarness: unknown }).__firstRunHarness = {
      create: () => {
        const field = document.getElementById("zerops-new-project") as HTMLInputElement | null;
        if (field !== null) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            field,
            "Acme CRM",
          );
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
        window.setTimeout(() => {
          document.querySelector<HTMLButtonElement>('[data-zerops-new-project="create"]')?.click();
        }, 150);
      },
    };
  }, []);
  return (
    <div className="flex h-screen bg-background text-foreground">
      <SidebarProvider className="flex h-screen">
        {landed !== null ? (
          <main className="h-screen min-w-0 flex-1 overflow-y-auto" data-slot="sidebar-inset">
            <HarnessPressPage birthId={landed} />
          </main>
        ) : CREATES ? (
          <FirstRunFormView
            account={account}
            input={{
              access: harnessAccess,
              closed: undefined,
              creating: false,
              defaultBotName: "Quinn",
              defaultTintFor: (name) => newMateTint([], name),
              locationError: null,
              locationId: "prg1",
              loading: false,
              locations: PLACES,
              onCreate: (choice) =>
                birthTransition(() =>
                  setLanded(
                    beginHarnessPress({
                      flow: "new-project",
                      project: choice.name,
                      botName: choice.botName,
                      face: choice.face,
                    }),
                  ),
                ),
              onLocation: () => {},
              proposeAnotherName: (current) =>
                ["Vera", "Wren", "Milo"].find((name) => name !== current) ?? current,
              takenBotNames: { names: [], complete: true },
            }}
            reachesEveryProject={REACHES_EVERY_PROJECT}
          />
        ) : (
          <FirstRunView
            account={account}
            form={undefined}
            reachesEveryProject={REACHES_EVERY_PROJECT}
          />
        )}
      </SidebarProvider>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const rootRoute = createRootRoute({ component: Harness });
const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/zerops" }),
  ]),
  history: createMemoryHistory({ initialEntries: ["/zerops"] }),
}) as unknown as AppRouter;

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
