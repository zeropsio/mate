/**
 * The organization's gate (ADR 0001): what stands in place of the product while an organization
 * has no HQ, beside the left menu that holds the account alone.
 *
 * Served by the dev server at `/design-hqgate.html` (`?theme=dark`; `?state=`: `birth` — an owner's
 * first visit, HQ being born, `&step=` the step it is on (`project` … `ready`, `done`); `failed` —
 * a step stopped, Try again; `uncertain` — Zerops may have made HQ's project unseen, Try again and
 * Start over;
 * `ask` — anybody else, whom to ask; `reading` — the member list on its way; `unread` — it could not
 * be read; `unclear` — two HQs). Open it at 1786 × 1000.
 *
 * Fixtures only. Nothing here ships — `design-hqgate.html` is not `index.html`, and no route
 * imports this module.
 */
import { HQ_BIRTH_STEPS, type HqBirthStep } from "@t3tools/client-runtime/zerops/hq";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HqGateScreen } from "~/components/zerops/ZeropsHqGate";
import type { HqBirthView } from "~/zerops/hqBirth";
import { HQ_UNCLEAR, type HqGate } from "~/zerops/hqGate";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "birth";
const MENU_WIDTH = 435;

const askedStep = params.get("step");
const STEP: HqBirthStep | "done" =
  askedStep === "done" || HQ_BIRTH_STEPS.includes(askedStep as HqBirthStep)
    ? (askedStep as HqBirthStep | "done")
    : "services";

const GATE: Readonly<Record<string, Exclude<HqGate, { readonly kind: "open" }>>> = {
  birth: { kind: "birth" },
  failed: { kind: "birth" },
  uncertain: { kind: "birth" },
  ask: {
    kind: "ask",
    line: "An admin sets up Mate for this organization. Ask Karel Hemza or Jan Novák.",
  },
  reading: { kind: "reading", failed: false },
  unread: { kind: "reading", failed: true },
  unclear: { kind: "unclear", line: HQ_UNCLEAR },
};

const BIRTH: Readonly<Record<string, HqBirthView>> = {
  birth: { kind: "running", step: STEP },
  failed: {
    kind: "failed",
    step: "deploy",
    reason: "HQ's deploy did not finish. Its build log in Zerops says why.",
    startOver: false,
  },
  uncertain: {
    kind: "failed",
    step: "project",
    reason:
      "Zerops did not confirm HQ's project, and its history shows no Headquarters of yours made since. Try again in a moment; before starting over, look for a Headquarters project in Zerops and delete it.",
    startOver: true,
  },
};

function Harness() {
  return (
    <div className="flex h-screen bg-background">
      <aside
        className="h-screen shrink-0 border-e border-border bg-sidebar"
        data-sidebar="sidebar"
        style={{ width: MENU_WIDTH }}
      />
      <HqGateScreen
        organizationName="Mate s.r.o."
        gate={GATE[STATE] ?? { kind: "birth" }}
        birth={BIRTH[STATE]}
        onTryAgain={() => {}}
        onStartOver={() => {}}
        onReadAgain={() => {}}
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
