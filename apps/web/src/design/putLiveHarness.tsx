/**
 * *Put it live* in the composer's own frame: the change waiting, with Put it live as its one
 * button while the project has no production; the run as one wait row, step by step; the live
 * card; a run that stopped. `?sheet=1` opens the sheet over them.
 *
 * Served by the dev server at `/design-put-live.html` (`?theme=dark`). Fixtures only: nothing
 * here ships, and no route imports this module.
 */
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PutLiveRow } from "~/components/zerops/PutLiveTop";
import { PutLiveSheet } from "~/components/zerops/PutLiveSheet";
import { ZeropsNextStepStrip } from "~/components/zerops/ZeropsNextStepBanner";
import { Dialog } from "~/components/ui/dialog";
import { TooltipProvider } from "~/components/ui/tooltip";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { putLiveSheet, type PutLiveRun } from "~/zerops/putLive.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const SHEET = params.get("sheet") === "1";
const NOW = Date.now();

const RUN: PutLiveRun = {
  orgId: "o-1",
  groupId: "g-1",
  project: "Cookbook",
  change: {
    repository: "app",
    number: 1,
    title: "Cookbook: add, browse and search dishes by ingredient",
    head: "abc",
    merged: false,
  },
  phase: "merging",
};

const ADDRESS = {
  url: "https://app-cafe-3000.prg1.zerops.app",
  host: "app-cafe-3000.prg1.zerops.app",
};

const ROWS: ReadonlyArray<{ readonly name: string; readonly run: PutLiveRun }> = [
  { name: "Merging", run: { ...RUN, stepAt: NOW - 4_000 } },
  { name: "Making production", run: { ...RUN, phase: "creating", stepAt: NOW - 133_000 } },
  {
    name: "Releasing",
    run: { ...RUN, phase: "releasing", tag: "v0.1.0", stepAt: NOW - 40_000 },
  },
  { name: "Live", run: { ...RUN, phase: "live", tag: "v0.1.0", liveAt: NOW } },
  {
    name: "Stopped",
    run: {
      ...RUN,
      phase: "failed",
      failedAt: "creating",
      failure: { words: "Zerops needs more credit to make production.", action: "again" },
    },
  },
  {
    name: "After a reload, not released yet",
    run: {
      ...RUN,
      change: undefined,
      phase: "failed",
      failedAt: "creating",
      productionId: "p-prod",
      failure: { words: "Production is made; v0.1.0 isn't released yet.", action: "release" },
    },
  },
  {
    name: "Services never showed ready",
    run: {
      ...RUN,
      phase: "failed",
      failedAt: "creating",
      productionId: "p-prod",
      failure: {
        words: "Zerops hasn't shown the new services ready after 10 minutes.",
        action: "again",
        alsoProject: true,
      },
    },
  },
];

const noop = () => {};

function Composer({ name, top }: { readonly name: string; readonly top: ReactNode }) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-2" data-put-live-harness={name}>
      <span className="text-xs font-medium text-muted-foreground">{name}</span>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card"
        data-chat-composer-main-surface="true"
      >
        <div data-chat-composer-surface="true">
          {top}
          <div className="px-4 pt-3 pb-12 text-placeholder text-sm">Ask anything...</div>
        </div>
      </div>
    </section>
  );
}

function Harness() {
  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col items-center gap-10 bg-background p-10 text-foreground">
        <Composer
          name="The change waiting, no production yet"
          top={
            <ZeropsNextStepStrip
              onPutLive={noop}
              onReview={noop}
              strip={{
                title: "Alba is waiting for your review of #1",
                detail: RUN.change!.title,
                tint: "coral",
                target: { kind: "change", groupId: "g-1", repository: "app", number: 1 },
              }}
            />
          }
        />
        {ROWS.map(({ name, run }) => (
          <Composer
            key={name}
            name={name}
            top={
              <PutLiveRow
                address={ADDRESS}
                copied={false}
                face={{ tint: "coral" }}
                nowMs={NOW}
                onAgain={noop}
                onCopy={noop}
                onDismiss={noop}
                onOpenProject={noop}
                onSeeCode={noop}
                run={run}
              />
            }
          />
        ))}
      </div>
      <Dialog onOpenChange={noop} open={SHEET}>
        <PutLiveSheet
          model={putLiveSheet({
            project: "Cookbook",
            changes: [
              {
                title: RUN.change!.title,
                description: [
                  "A small, phone-friendly shop front backed by PostgreSQL.",
                  "",
                  "## What it does",
                  "- **Add** a recipe with a title, ingredients and steps",
                  "- **Browse** every recipe, listed A to Z",
                  "- **Search by ingredient**: several, separated with commas",
                  "- Tick off ingredients while you cook",
                ].join("\n"),
              },
            ],
            recipe: "present",
          })}
          onSetUpYourself={noop}
          onPutLive={noop}
          onSeeCode={noop}
        />
      </Dialog>
    </TooltipProvider>
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
