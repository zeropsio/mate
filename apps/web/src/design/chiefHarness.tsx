/**
 * The Chief as the owner sees it (1786 wide, the left menu at 435, `?menu=` for another): the
 * menu's top row in the state `?top=` names — `none` (no Chief yet: its place, the mark and
 * what waits on you), `setting-up`, `stopped`,
 * `rest`, `working`, `asks`, `sign-in` or `coming` — with what waits on you counted
 * beside the squares (`?waiting=0` for none), and the Chief page beside it in the state `?page=`
 * names: `offer`, `blocked`, `project` or `hq` (that step running), `failed-project` or
 * `failed-hq` (that step stopped, with Try again). Set up Chief
 * walks the steps 700 ms apart. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-chief.html`. Fixtures only: nothing here ships, and no route
 * imports this module.
 */
import type { MateMarkState } from "@t3tools/shared/brand";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { RunShimmer } from "~/components/chat/RunShimmer";
import { SidebarProvider } from "~/components/ui/sidebar";
import { ChiefStage } from "~/components/zerops/chief/ChiefPage";
import {
  CHIEF_SETUP_IDLE,
  chiefSetupAfter,
  type ChiefSetup,
  type ChiefSetupStep,
} from "~/components/zerops/chief/chiefSetup.logic";
import type { ChiefPageView } from "~/components/zerops/chief/chiefTop.logic";
import {
  ChiefSetupRowLine,
  SidebarChiefPlace,
  SidebarChiefRow,
} from "~/components/zerops/chief/SidebarChiefRow";
import { MateFaceAsMark } from "~/components/zerops/primitives";
import { waitingItemsOf, type WaitingItem } from "~/components/zerops/SidebarWaiting.logic";
import { SidebarChromeHeader, SidebarCreateButton } from "~/components/sidebar/SidebarChrome";
import { SidebarScopeButton } from "~/components/zerops/SidebarScopeButton";
import { SidebarJumpButton } from "~/components/zerops/SidebarJumpButton";
import { MateComingHeader } from "~/components/zerops/ZeropsMateComingPage";
import type { AppRouter } from "~/router";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const MENU = Number(params.get("menu") ?? 435);
const TOP = params.get("top") ?? "rest";
const PAGE = params.get("page") ?? "offer";
const WAITING = params.get("waiting") !== "0";

const REASONS: Readonly<Record<ChiefSetupStep, string>> = {
  project: "Zerops refused the project: the organization has no room for another one.",
  hq: "HQ is not answering right now.",
};

function setupOf(name: string): ChiefSetup {
  const [phase, step] = name.startsWith("failed-")
    ? (["failed", name.slice("failed-".length)] as const)
    : (["running", name] as const);
  if (!(step in REASONS)) return CHIEF_SETUP_IDLE;
  const at = step as ChiefSetupStep;
  const projectId = at === "project" ? null : "p-chief";
  return phase === "failed"
    ? { phase, step: at, birthId: "b1", projectId, reason: REASONS[at] }
    : { phase, step: at, birthId: "b1", projectId };
}

const ITEMS: ReadonlyArray<WaitingItem> = waitingItemsOf({
  mates: [
    {
      projectId: "rhea",
      name: "Rhea",
      tint: "violet",
      shape: "squircle",
      face: "needs",
      kind: "question",
      environmentId: "env",
      threadId: "thread",
      text: "Stripe or Adyen?",
    },
  ],
  releases: [{ groupId: "tea", name: "Tea Shop", ahead: 3 }],
});

const line = (words: ReactNode, ink: "muted" | "ink") => (
  <span
    className={
      ink === "ink"
        ? "menu-line2 truncate text-sidebar-foreground"
        : "menu-line2 truncate text-muted-foreground"
    }
  >
    {words}
  </span>
);

/** The top row's states: its face, and its line where it has one. */
const TOPS: Readonly<Record<string, { readonly face?: MateMarkState; readonly line?: ReactNode }>> =
  {
    none: {},
    "setting-up": { line: <ChiefSetupRowLine state="running" /> },
    stopped: { line: <ChiefSetupRowLine state="stopped" /> },
    rest: { face: "idle" },
    working: {
      face: "working",
      line: line(
        <RunShimmer inline sweeps>
          Reading every project's last release
        </RunShimmer>,
        "muted",
      ),
    },
    asks: { face: "needs", line: line("Should I ask Rhea to roll the Tea Shop back?", "ink") },
    "sign-in": { line: line("Waiting for your sign-in", "ink") },
    coming: { face: "waking", line: line("Coming up · 0:42", "muted") },
  };

function pageViewOf(setup: ChiefSetup): Exclude<ChiefPageView, { kind: "reading" | "coming" }> {
  if (setup.phase === "running" || setup.phase === "failed") return { kind: "steps", setup };
  return {
    kind: "offer",
    blocked: PAGE === "blocked" ? "Reaching your organization's HQ…" : undefined,
  };
}

function Harness() {
  const [setup, setSetup] = useState<ChiefSetup>(() => setupOf(PAGE));
  const [current, setCurrent] = useState(true);
  const walk = () => {
    const events = [
      { type: "start", birthId: "b1" },
      { type: "project-made", projectId: "p-chief" },
      { type: "marked" },
    ] as const;
    events.forEach((event, index) =>
      setTimeout(() => setSetup((now) => chiefSetupAfter(now, event)), index * 700),
    );
  };
  const top = TOPS[TOP] ?? TOPS.rest!;
  const view = setup.phase === "done" ? null : pageViewOf(setup);
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside
        className="flex shrink-0 flex-col border-e border-border bg-sidebar text-sidebar-foreground"
        data-sidebar="sidebar"
        style={{ width: MENU }}
      >
        <SidebarChromeHeader
          isElectron={false}
          brand={
            TOP === "none" ? (
              <SidebarChiefPlace
                waiting={
                  WAITING
                    ? { items: ITEMS, verbs: { onOpenMate: () => {}, onAskToFix: () => {} } }
                    : undefined
                }
              />
            ) : (
              <SidebarChiefRow
                current={current}
                face={top.face}
                line={top.line}
                onOpen={() => setCurrent(true)}
                waiting={
                  WAITING
                    ? { items: ITEMS, verbs: { onOpenMate: () => {}, onAskToFix: () => {} } }
                    : undefined
                }
              />
            )
          }
          actions={
            <>
              <SidebarScopeButton onScope={() => {}} scope="everyone" />
              <SidebarJumpButton onJump={() => {}} shortcut="⌘K" />
              <SidebarCreateButton onNewMate={() => {}} onNewProject={() => {}} projects={[]} />
            </>
          }
        />
      </aside>
      <MateFaceAsMark.Provider value>
        <main className="flex min-w-0 flex-1 flex-col" data-harness-state={`page:${PAGE}`}>
          <header className="relative flex h-(--workspace-topbar-height) shrink-0 items-center px-5">
            <MateComingHeader
              arriving
              mate={{
                name: "Chief",
                tint: "slate",
                shape: "squircle",
                connected: false,
                projectUrl: undefined,
                chief: true,
              }}
            />
          </header>
          <div className="relative min-h-0 flex-1">
            {view === null ? (
              <p className="p-6 text-sm text-muted-foreground">
                Set up: the page is the Chief's own view while it comes up.
              </p>
            ) : (
              <ChiefStage
                onAgain={() => setSetup((now) => chiefSetupAfter(now, { type: "again" }))}
                onSetUp={walk}
                view={view}
              />
            )}
          </div>
        </main>
      </MateFaceAsMark.Provider>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const router = createRouter({
  routeTree: createRootRoute({
    component: () => (
      <SidebarProvider
        className="block"
        style={{ "--sidebar-width": `${MENU}px` } as CSSProperties}
      >
        <Harness />
      </SidebarProvider>
    ),
  }),
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
