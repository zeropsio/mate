/**
 * The New project page (the owner, 2026-11-23): "What do you want to build?", the project's name
 * and *Start a project*, in the main column beside the left menu — and folded under *Advanced
 * options*, its first Mate's name and look, who can open it, and the region it runs in, as tiles
 * with this browser's latency to each.
 *
 * Served by the dev server at `/design-newproject.html` (`?theme=dark`; `?state=`: `idle` — as
 * it opens; `advanced` — *Advanced options* open; `picked` — a project named, the options open,
 * the Mate called Mira, Rose and Seal picked; `refused` — the Mate named as another already is,
 * Start pressed; `checking` — the account's Mates' names still being read; `creating` — Start
 * pressed, the first Mate's view on its way; `closed` — the person may not add projects here, the
 * reason in the form's place; `pressing` — Start pressed: the page gives way to the first Mate's
 * page at once, the steps this tab runs advancing under the project's row (`pressPage.tsx`,
 * `&fail=` stops one); `&locations=1` offers one region, which is then no choice). Its *Project
 * access* holds eighteen people of nineteen, one line until *Change who can open it*. The die at
 * the name's end rolls another name. The menu beside it is the owner's 435 px, as in the app.
 * Open it at 1786 × 1000. `window.__newProjectHarness.created` holds what Create handed over.
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
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ZeropsNewProjectPage,
  type NewProjectChoice,
} from "~/components/zerops/ZeropsNewProjectForm";
import { SidebarProvider } from "~/components/ui/sidebar";
import {
  draftChoose,
  draftSummary,
  draftView,
  type DraftInput,
} from "~/components/zerops/projects/accessDraft.logic";
import {
  AccessDraftFold,
  ProjectAccessChips,
} from "~/components/zerops/projects/ProjectAccessChips";
import { beginHarnessPress, HarnessPressPage } from "./pressPage";
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
      name: bot,
      status: "ACTIVE",
      tagList: ["mate"],
      hq: { appId: "acme", appName: "Acme Docs", kind: "mate", mate: { face: "" } },
    },
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  };
}

/** The account's Mates: the proposed face walks past the tints they wear. */
const MATES = [mate("Fen"), mate("Ada"), mate("Nova")];
const LOCATIONS =
  params.get("locations") === "1"
    ? [{ id: "prg1", name: "EU Central (prg1)" }]
    : [
        { id: "prg1", name: "EU Central (prg1)", latencyMs: 54 },
        { id: "ny1", name: "US East (ny1)", latencyMs: 145 },
        { id: "sea1", name: "US West (sea1)", latencyMs: 214 },
      ];
/** What the die rolls, in turn: never the name it was rolled from. */
const ROLLS = ["Vera", "Wren", "Milo"];

/** Eighteen people, as the owner's organization has: you, sixteen admins, one developer. */
const PEOPLE = [
  ["me", "Mia Moss", "ADMIN"],
  ["ada", "Ada Lind", "ADMIN"],
  ["bo", "Bo Hale", "ADMIN"],
  ["cy", "Cyril Nord", "ADMIN"],
  ["di", "Dita Park", "ADMIN"],
  ["ed", "Edo Moon", "ADMIN"],
  ["fay", "Fay Linn", "ADMIN"],
  ["gus", "Gus Orr", "ADMIN"],
  ["hal", "Hal Pike", "ADMIN"],
  ["ivy", "Ivy Rowe", "ADMIN"],
  ["jo", "Jo Sand", "ADMIN"],
  ["kit", "Kit Tate", "ADMIN"],
  ["lu", "Lu Vale", "ADMIN"],
  ["mo", "Mo West", "ADMIN"],
  ["ned", "Ned Yoke", "ADMIN"],
  ["ola", "Ola Zorn", "ADMIN"],
  ["pia", "Pia Ames", "ADMIN"],
  ["rex", "Rex", "BASIC_USER"],
  ["sal", "Sal Quill", "NO_ACCESS"],
] as const;
const MEMBERS = PEOPLE.map(([id, fullName, roleCode]) => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id: `u-${id}`, fullName },
}));
const DRAFT: Omit<DraftInput, "list"> = {
  members: { known: true, status: "ready", refused: false, list: MEMBERS },
  kind: "mate",
  app: { projects: [], grants: {}, owners: {} },
  pictures: {},
  creator: { membershipId: "cu-me", userId: "u-me" },
};

/** *Project access* as the host draws it, from the fixtures: one line, the chips to change it. */
function HarnessAccess({
  onChange,
}: {
  readonly onChange: (list: ReadonlyArray<ProjectGrant>) => void;
}) {
  const [list, setList] = useState<ReadonlyArray<ProjectGrant>>([]);
  const view = useMemo(() => draftView({ ...DRAFT, list }), [list]);
  useEffect(() => onChange(list), [list, onChange]);
  const summary = draftSummary({ view, organization: "Mate s.r.o.", prefill: [], list });
  if (summary === null) return null;
  return (
    <AccessDraftFold label="Project access" summary={summary}>
      <ProjectAccessChips
        heading={false}
        label="Project access"
        onAdd={(picks) =>
          setList((held) =>
            picks.reduce(
              (next, { candidate, level }) =>
                draftChoose(next, MEMBERS, candidate.clientUserId, level),
              held,
            ),
          )
        }
        onChoose={(person, choice) => {
          const change = person.change;
          if (change === null) return;
          setList((held) =>
            draftChoose(
              held,
              MEMBERS,
              change.clientUserId,
              choice === "withdraw" ? "remove" : choice,
            ),
          );
        }}
        view={view}
      />
    </AccessDraftFold>
  );
}

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
  const [locationId, setLocationId] = useState("prg1");
  // Create pressed: the page gives way to the first Mate's page, at once.
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    window.__newProjectHarness = { created };
    if (STATE === "idle" || STATE === "checking" || STATE === "closed") return;
    // Reached the way a person reaches them: the options opened, the project named, the Mate
    // named and picked.
    const opening =
      STATE === "advanced" || STATE === "picked" || STATE === "refused"
        ? window.setTimeout(() => {
            click('.new-project-advanced [data-slot="collapsible-trigger"]');
          }, 100)
        : undefined;
    if (STATE === "advanced") return () => window.clearTimeout(opening);
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
      STATE === "refused" || STATE === "pressing"
        ? window.setTimeout(() => {
            click('[data-zerops-new-project="create"]');
          }, 450)
        : undefined;
    return () => {
      if (opening !== undefined) window.clearTimeout(opening);
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
        <main className="h-screen min-w-0 flex-1">
          {landed === null ? (
            <ZeropsNewProjectPage
              access={(onChange) => <HarnessAccess onChange={onChange} />}
              closed={
                STATE === "closed"
                  ? "Only the organization's owners and admins add projects. You can open every project of Mate s.r.o. you have been given."
                  : undefined
              }
              creating={STATE === "creating"}
              defaultBotName="Quinn"
              defaultTintFor={(name) => newMateTint(MATES, name)}
              locationError={null}
              locationId={locationId}
              loading={false}
              locations={LOCATIONS}
              onCreate={(choice) => {
                created.push(choice);
                setLanded(
                  beginHarnessPress({
                    flow: "new-project",
                    project: choice.name,
                    botName: choice.botName,
                    face: choice.face,
                  }),
                );
              }}
              onLocation={setLocationId}
              proposeAnotherName={(current) => ROLLS.find((name) => name !== current) ?? current}
              takenBotNames={{
                names: ["Fen", "Ada", "Nova"],
                complete: STATE !== "checking",
              }}
            />
          ) : (
            <HarnessPressPage birthId={landed} />
          )}
        </main>
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
