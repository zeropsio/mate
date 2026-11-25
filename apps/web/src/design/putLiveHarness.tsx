/**
 * *Put it live* in the composer's own frame: the change waiting, with Put it live as its one
 * button while the project has no production; HQ's run as one wait row, step by step; a run that
 * stopped, or waits for its review or its maker. `?sheet=1` opens the sheet over them: `&shape=small` or
 * `&shape=available` with who production is for answered, `&recipe=loading` while the setup files
 * are read, `&busy=1` pressed.
 *
 * Served by the dev server at `/design-put-live.html` (`?theme=dark`). Fixtures only: nothing
 * here ships, and no route imports this module.
 */
import type { ProductionShape } from "@t3tools/shared/hqRelease";
import { type ReactNode, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { PutLiveRow } from "~/components/zerops/ProductionRun";
import { PutLiveSheet } from "~/components/zerops/PutLiveSheet";
import { ZeropsNextStepStrip } from "~/components/zerops/ZeropsNextStepBanner";
import { Dialog } from "~/components/ui/dialog";
import { TooltipProvider } from "~/components/ui/tooltip";
import {
  putLiveServices,
  putLiveShapes,
  putLiveSheet,
  putLiveSheetUnderWay,
  type PutLiveStanding,
} from "~/zerops/putLive.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const SHEET = params.get("sheet") === "1";
const ASKED_SHAPE = params.get("shape");
const SHAPE: ProductionShape | undefined =
  ASKED_SHAPE === "small" || ASKED_SHAPE === "available" ? ASKED_SHAPE : undefined;
const RECIPE_READING = params.get("recipe") === "loading";
const BUSY = params.get("busy") === "1";

/** An invented production tier, highly available as recipes write it. */
const TIER = [
  "services:",
  "  - hostname: app",
  "    type: bun@1.4",
  "    buildFromGit: https://hq.example.test/git/o-1/g-1/app.git",
  "    zeropsSetup: app",
  "    minContainers: 2",
  "  - hostname: db",
  "    type: postgresql:ha@18",
  "    profile: oltp-staging",
  "  - hostname: cache",
  "    type: valkey:ha@7.2",
  "  - hostname: storage",
  "    type: object-storage",
  "    objectStorageSize: 1",
].join("\n");
const NOW = Date.now();

const TITLE = "Cookbook: add, browse and search dishes by ingredient";

const ROWS: ReadonlyArray<{
  readonly name: string;
  readonly standing: Exclude<PutLiveStanding, { readonly kind: "none" }>;
}> = [
  {
    name: "Making production",
    standing: { kind: "going", releasing: false, since: NOW - 133_000 },
  },
  { name: "Releasing", standing: { kind: "going", releasing: true, since: NOW - 40_000 } },
  { name: "Its release waits for a review", standing: { kind: "review" } },
  {
    name: "Waiting for its maker",
    standing: {
      kind: "waiting",
      id: "op-1",
      yours: true,
      press: "Continue",
      line: "Your Zerops sign-in ran out before it finished.",
    },
  },
  {
    name: "Stopped",
    standing: {
      kind: "failed",
      failure: {
        step: "create",
        code: "projectLimitReached",
        at: new Date(NOW).toISOString(),
        origin: "zerops",
      },
    },
  },
];

const noop = () => {};

function Composer({ name, top }: { readonly name: string; readonly top: ReactNode }) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-2" data-put-live-harness={name}>
      <span className="text-caption font-medium text-muted-foreground">{name}</span>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-sheet border border-border bg-card"
        data-chat-composer-main-surface="true"
      >
        <div data-chat-composer-surface="true">
          {top}
          <div className="px-4 pt-3 pb-12 text-placeholder text-body">Ask anything...</div>
        </div>
      </div>
    </section>
  );
}

function Harness() {
  const [shape, setShape] = useState<ProductionShape | undefined>(SHAPE);
  const model = putLiveSheet({
    stageHeld: false,
    project: "Cookbook",
    changes: [
      {
        title: TITLE,
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
    recipe: RECIPE_READING ? "loading" : "present",
    creates: putLiveServices(TIER),
    shapes: putLiveShapes(TIER),
    shape,
  });
  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col items-center gap-10 bg-background p-10 text-foreground">
        <Composer
          name="The change waiting, no production yet"
          top={
            <ZeropsNextStepStrip
              onReview={noop}
              strip={{
                title: "Alba is waiting for your review of #1",
                detail: TITLE,
                tint: "coral",
                target: { kind: "change", groupId: "g-1", repository: "app", number: 1 },
              }}
            />
          }
        />
        {/* A run is its project's production's: drawn there, never above a composer. */}
        {ROWS.map(({ name, standing }) => (
          <section className="grid max-w-md gap-2" key={name}>
            <h3 className="text-caption text-muted-foreground">{name}</h3>
            <PutLiveRow
              onAgain={noop}
              onContinue={noop}
              onReview={noop}
              project="Cookbook"
              standing={standing}
            />
          </section>
        ))}
      </div>
      <Dialog onOpenChange={noop} open={SHEET}>
        <PutLiveSheet
          model={BUSY ? putLiveSheetUnderWay(model, { pressedHere: true }) : model}
          onShape={setShape}
          onSetUpYourself={noop}
          onPutLive={noop}
          onSeeCode={noop}
        />
      </Dialog>
    </TooltipProvider>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
