/**
 * Setting up a person's Chief, as the owner sees it (1786 wide, the left menu at 435, `?menu=` for
 * another): the menu's line under the Overview row in each of its states — the offer, the setup
 * running, the setup stopped — and the Chief's top row coming up, then the setup dialog in the
 * state `?dialog=` names: `idle` (what a Chief is), `project`, `hq` or `variables` (that step
 * running), `failed-project`, `failed-hq` or `failed-variables` (that step stopped, with Try
 * again), or `none` for the menu alone. Set up Chief walks the steps 700 ms apart. `?theme=dark`
 * for dark.
 *
 * Served by the dev server at `/design-chief.html`. Fixtures only: nothing here ships, and no route
 * imports this module.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { ChiefSetupDialog } from "~/components/zerops/chief/ChiefSetupDialog";
import {
  CHIEF_SETUP_IDLE,
  chiefSetupAfter,
  type ChiefSetup,
  type ChiefSetupStep,
} from "~/components/zerops/chief/chiefSetup.logic";
import {
  SidebarChiefSetupLine,
  type ChiefSetupLineState,
} from "~/components/zerops/chief/SidebarChiefSetupLine";
import { SidebarOverviewRow } from "~/components/zerops/SidebarOverview";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const MENU = Number(params.get("menu") ?? 435);
const DIALOG = params.get("dialog") ?? "idle";

const HEADLINE = "6 projects · 2 deploying";

const REASONS: Readonly<Record<ChiefSetupStep, string>> = {
  project: "Zerops refused the project: the organization has no room for another one.",
  hq: "HQ is not answering right now.",
  variables: "ZCP_ORG_TOKEN is already in this service, as a value or in its zerops.yml.",
};

function setupOf(name: string): ChiefSetup {
  const [phase, step] = name.startsWith("failed-")
    ? (["failed", name.slice("failed-".length)] as const)
    : (["running", name] as const);
  if (name === "idle" || !(step in REASONS)) return CHIEF_SETUP_IDLE;
  const at = step as ChiefSetupStep;
  const projectId = at === "project" ? null : "p-chief";
  return phase === "failed"
    ? { phase, step: at, birthId: "b1", projectId, reason: REASONS[at] }
    : { phase, step: at, birthId: "b1", projectId };
}

const LINES: ReadonlyArray<ChiefSetupLineState> = ["offer", "running", "stopped"];

function Harness() {
  const [setup, setSetup] = useState<ChiefSetup>(() => setupOf(DIALOG));
  const [open, setOpen] = useState(DIALOG !== "none");
  const walk = () => {
    const events = [
      { type: "start", birthId: "b1" },
      { type: "project-made", projectId: "p-chief" },
      { type: "hq-answered" },
      { type: "variables-written" },
    ] as const;
    events.forEach((event, index) =>
      setTimeout(() => setSetup((current) => chiefSetupAfter(current, event)), index * 700),
    );
  };
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div
        className="grid shrink-0 content-start gap-6 border-e border-border bg-sidebar px-3 py-4"
        style={{ width: MENU }}
      >
        {LINES.map((line) => (
          <div data-harness-state={`line:${line}`} key={line}>
            <SidebarOverviewRow current={false} headline={HEADLINE} onOpen={() => setOpen(true)} />
            <SidebarChiefSetupLine onOpen={() => setOpen(true)} state={line} />
          </div>
        ))}
        <div className="menu-top-chief" data-harness-state="top:coming">
          <SidebarOverviewRow
            chief
            coming={{ kind: "coming", line: "Adding its container" }}
            current={false}
            headline={HEADLINE}
            onOpen={() => setOpen(true)}
          />
        </div>
      </div>
      <div className="min-w-0 flex-1" />
      <ChiefSetupDialog
        onAgain={() => setSetup((current) => chiefSetupAfter(current, { type: "again" }))}
        onOpenChange={setOpen}
        onSetUp={walk}
        open={open}
        setup={setup}
      />
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
