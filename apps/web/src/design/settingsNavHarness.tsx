/**
 * The settings nav (`SettingsSidebarNav`) at the owner's 435 px: its sections grouped by whose
 * settings they are, Appearance open, for a made-up viewer in the organization Acme.
 *
 * Served by the dev server at `/design-settings-nav.html` (`?theme=dark`); open it at
 * 1786 × 1000. `?org=none` signed in without an organization: Team and Personas leave the nav.
 * `?page=` another section's path (`/settings/zerops`). `?jump=appear` opens ⌘K's jump box over
 * it with that typed, over a made-up menu (Tea Shop's Mate Nova, its Production and Stage):
 * what it finds of the settings, the account menu's pages and the places.
 * Fixtures only: no route imports this module.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useEffect, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";

import { SettingsSidebarNav } from "~/components/settings/SettingsSidebarNav";
import { CommandDialog, CommandDialogPopup } from "~/components/ui/command";
import { Sidebar, SidebarProvider } from "~/components/ui/sidebar";
import {
  chooseJumpItem,
  JumpBoxView,
  useJumpBoxModel,
  useJumpBoxState,
} from "~/components/zerops/JumpBox";
import {
  EMPTY_JUMP_INDEX,
  jumpMateOf,
  type SidebarJumpIndex,
} from "~/components/zerops/JumpBox.logic";
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

const JUMP = params.get("jump");

const INDEX: SidebarJumpIndex = {
  ...EMPTY_JUMP_INDEX,
  mates: [
    jumpMateOf({
      projectId: "tea-nova",
      name: "Nova",
      tint: "olive",
      shape: "squircle",
      projectName: "Tea Shop",
      environmentId: undefined,
      owner: undefined,
      connected: false,
      activity: undefined,
      mine: true,
    }),
  ],
  projects: [{ groupId: "tea", name: "Tea Shop", mates: 1 }],
  stops: [
    {
      projectId: "tea-prod",
      groupId: "tea",
      title: "Production",
      projectName: "Tea Shop",
      line: "v1.4.0",
      dot: "ok",
      word: "Production v1.4.0, running",
    },
    {
      projectId: "tea-stage",
      groupId: "tea",
      title: "Stage",
      projectName: "Tea Shop",
      line: "3f9c1b2",
      dot: "ok",
      word: "Stage 3f9c1b2, running",
    },
  ],
};

/** ⌘K's jump box with `?jump=` typed; what a choice does is logged, as nothing navigates here. */
function HarnessJump({ text }: { readonly text: string }) {
  const state = useJumpBoxState();
  const { setRawValue } = state;
  useEffect(() => {
    setRawValue(text);
  }, [setRawValue, text]);
  const model = useJumpBoxModel(state, INDEX, [], new Set());
  const log = (what: string) => {
    console.info(`jump: ${what}`);
  };
  return (
    <CommandDialog open>
      <CommandDialogPopup aria-label="Jump to" data-command-palette="true">
        <JumpBoxView
          model={model}
          onChoose={(item) => {
            chooseJumpItem(item, {
              model,
              showable: false,
              close: () => {},
              pages: {
                openMate: (mate) => log(mate.name),
                openProject: log,
                openStop: (stop) => log(stop.projectId),
                openChange: (change) => log(change.key),
                openPage: (page) => log(`${page.to}#${page.hash ?? ""}`),
                newProject: () => log("new project"),
              },
            });
          }}
          onCommands={undefined}
          onSend={() => {}}
          searching={false}
          write={undefined}
        />
      </CommandDialogPopup>
    </CommandDialog>
  );
}

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
      {JUMP === null ? null : <HarnessJump text={JUMP} />}
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
