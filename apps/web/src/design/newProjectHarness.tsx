/**
 * The New project page, its first Mate asked for: the project's name, then the Mate's name,
 * colour and shape beside the face they make — the picker New Mate uses.
 *
 * Served by the dev server at `/design-newproject.html` (`?theme=dark`; `?state=`: `idle` — as
 * the page opens, the Mate's name proposed; `picked` — a project named, the Mate called Mira,
 * Rose and Seal picked; `refused` — the Mate named as another already is, Create pressed;
 * `checking` — the account's Mates' names still being read; `creating` — Create pressed, the
 * first Mate's view on its way; `&locations=2` offers two locations). The page stands beside the left menu at the owner's
 * 435 px, as it does in the app. Open it at 1786 × 1000. `window.__newProjectHarness.created`
 * holds what Create handed over.
 *
 * Fixtures only. Nothing here ships — `design-newproject.html` is not `index.html`, and no route
 * imports this module.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { newMateTint } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  ZeropsNewProjectForm,
  ZeropsNewProjectFrame,
  type NewProjectChoice,
} from "~/components/zerops/ZeropsNewProjectWizard";
import { SidebarProvider } from "~/components/ui/sidebar";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import type { AppRouter } from "~/router";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "idle";
const MENU_WIDTH = 435;

function mate(bot: string): ZeropsCandidate {
  const id = `acme-docs-${bot.toLowerCase()}`;
  return {
    key: `${id}:zcp`,
    group: "ready",
    project: {
      id,
      name: `Acme Docs - ${bot}`,
      status: "ACTIVE",
      tagList: ["mate", "mate:g:acme", "mate:role:dev", `mate:bot:${bot}`],
    },
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  };
}

/** The account's Mates: the proposed face walks past the tints they wear. */
const MATES = [mate("Fen"), mate("Ada"), mate("Nova")];
const LOCATIONS =
  params.get("locations") === "2"
    ? [
        { id: "prg1", name: "Prague" },
        { id: "fra1", name: "Frankfurt" },
      ]
    : [{ id: "prg1", name: "Prague" }];

declare global {
  interface Window {
    __newProjectHarness?: { readonly created: ReadonlyArray<NewProjectChoice> };
  }
}

const created: Array<NewProjectChoice> = [];

/** Types into a field as a person would: React hears the input. */
function typeInto(id: string, value: string): void {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

function Harness() {
  useEffect(() => {
    window.__newProjectHarness = { created };
    if (STATE === "idle" || STATE === "checking") return;
    // Reached the way a person reaches them: the project named, the Mate named and picked.
    const filling = window.setTimeout(() => {
      typeInto("zerops-new-project", "Acme CRM");
      if (STATE === "picked") {
        typeInto("zerops-new-project-mate", "Mira");
        click('[role="radio"][aria-label="Rose"]');
        click('[role="radio"][aria-label="Seal"]');
      }
      if (STATE === "refused") typeInto("zerops-new-project-mate", "Fen");
    }, 200);
    const pressing =
      STATE === "refused"
        ? window.setTimeout(() => {
            click('[data-zerops-new-project="create"]');
          }, 450)
        : undefined;
    return () => {
      window.clearTimeout(filling);
      if (pressing !== undefined) window.clearTimeout(pressing);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SidebarProvider className="flex">
        <aside
          className="h-screen shrink-0 border-e border-border bg-sidebar"
          data-sidebar="sidebar"
          style={{ width: MENU_WIDTH }}
        />
        <ZeropsNewProjectFrame>
          <ZeropsNewProjectForm
            creating={STATE === "creating"}
            defaultBotName="Quinn"
            defaultTintFor={(name) => newMateTint(MATES, name)}
            locationError={null}
            locationId="prg1"
            locationLoading={false}
            locations={LOCATIONS}
            onCreate={(choice) => {
              created.push(choice);
            }}
            onLocation={() => {}}
            takenBotNames={{
              names: ["Fen", "Ada", "Nova"],
              complete: STATE !== "checking",
            }}
          />
        </ZeropsNewProjectFrame>
      </SidebarProvider>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const router = createRouter({
  routeTree: createRootRoute({ component: Harness }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
}) as unknown as AppRouter;

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
