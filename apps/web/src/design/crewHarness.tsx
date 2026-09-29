/**
 * The Crew tab — the crew's one home — in the right panel as the app lays it
 * out at the owner's size: 1786 wide, the left menu at 435 (`?menu=` for
 * another), the panel at its default 540 beside the conversation, or
 * maximized over it with `?max=1`.
 *
 * The tab is the real `CrewPanelBody` in the real `RightPanelTabs`, over a
 * fixture crew: `?state=none` a Mate with crew mode on and no crew yet (its
 * setup), `applied` (the default) a crew with a run on, tasks in every column
 * and a row of every common *Waiting on you* kind, `off` a tab kept open after
 * crew mode went off. `?setup=1` opens *Set up a crew* over it, as the left
 * menu's ⋯ does. `?theme=dark` for the dark theme.
 *
 * Served by the dev server at `/design-crew.html`. Fixtures only: nothing here
 * ships, and no route imports this module.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
  type CrewThreadRead,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ThreadId, type CrewSnapshot } from "@t3tools/contracts";

import { RightPanelTabs } from "~/components/RightPanelTabs";
import { CrewPanelBody } from "~/components/zerops/crew/CrewPanel";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { useCrewSetupSheetStore } from "~/zerops/crew/crewTab";
import type { CrewRead } from "~/zerops/crew/useCrew";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const state = params.get("state") ?? "applied";

const ENVIRONMENT = EnvironmentId.make("environment-crew-harness");

const IDLE: CrewThreadRead = {
  status: { kind: "idle", toneId: "neutral" },
  word: null,
  working: false,
};

const APPLIED = crewSnapshotFixture();
/** Crew mode on, nothing applied: what a Mate has before its crew is set up. */
const NONE: CrewSnapshot = {
  ...APPLIED,
  status: "none",
  crew: null,
  crewmates: [],
  hosts: [],
  board: { tasks: [] },
  run: null,
  attention: [],
  landedNotDelivered: 0,
};

/** The crew as the feed would hand it, Backend's chat working and the rest at rest. */
function readOf(snapshot: CrewSnapshot): CrewRead {
  const shells: ReadonlyArray<CrewShellInput> = snapshot.crewmates.flatMap((crewmate) =>
    crewmate.currentThreadId === null
      ? []
      : [{ id: crewmate.currentThreadId, archivedAt: null, crew: null }],
  );
  const view = deriveCrewView(snapshot, shells, (shell) =>
    shell.id === ThreadId.make("thread-crew-backend-2")
      ? { status: { kind: "working", toneId: "active" }, word: "Working", working: true }
      : IDLE,
  );
  return { status: snapshot.status, snapshot, view: view as CrewRead["view"], current: true };
}

const CREW: CrewRead =
  state === "off"
    ? { status: "off", snapshot: null, view: null, current: false }
    : readOf(state === "none" ? NONE : APPLIED);

const noop = () => {};

const MAXIMIZED = params.get("max") === "1";
/** The left menu's width: the owner's 435 by default, `?menu=` for another. */
const MENU = Number(params.get("menu") ?? 435);

/**
 * The app's row: the left menu, the conversation's column, and the panel with
 * the Zerops and Crew tabs — which, maximized, takes the conversation's room.
 */
function Harness() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className={MAXIMIZED ? "w-0 flex-none" : "min-w-0 flex-1"} />
      <RightPanelTabs
        activeSurfaceId="crew"
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: CREW.status,
        })}
        defaultWidth={540}
        liveAgentCount={0}
        maximized={MAXIMIZED}
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
        surfaces={[
          { id: "zerops", kind: "zerops" },
          { id: "crew", kind: "crew" },
        ]}
        terminalLabelsById={new Map()}
        widthStorageKey="mate:design-crew:panel-width"
      >
        <CrewPanelBody
          crew={CREW}
          environmentId={ENVIRONMENT}
          mate={{ name: "Fen", tint: "amber" }}
          onAskMate={noop}
          treeCwd={null}
        />
      </RightPanelTabs>
    </div>
  );
}

// As the Mate's menu in the left menu asks for it: the tab opens the sheet as it draws.
if (params.get("setup") === "1") useCrewSetupSheetStore.getState().setOpen(ENVIRONMENT, true);

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
