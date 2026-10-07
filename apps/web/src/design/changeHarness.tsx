/**
 * A change's review, in the states it really reaches, in both of its frames: the dialog that
 * opens over the conversation and the change's own page.
 *
 * Served by the dev server at `/design-change.html`. It renders the real review with made-up
 * reads and no session, so there is no door to get through and nothing live to disturb.
 * `?review=<id>` shows one state alone, `?review=all` every one (the default); `?theme=dark` the
 * dark palette. The page's states are `page`, `page-settle` and `page-reading`; `settle` is the
 * dialog's reads landing late, to set its first frame against its settled one. `?release=open`
 * opens the release's dialog, whose change rows step into each change's review and back.
 *
 * Fixtures only. Nothing here ships in the app bundle — `design-change.html` is not
 * `index.html`, and no route imports this module.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";

import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";

import { SidebarProvider } from "~/components/ui/sidebar";
import {
  REVIEW_STATES,
  ReleaseDialogTry,
  ReviewDialogTry,
  ReviewPageStage,
  ReviewStage,
} from "./reviewHarnessStates";
import "../index.css";

/** `?review=<id>` shows one review state alone; `?review=all` every one. */
const REVIEW = new URLSearchParams(location.search).get("review") ?? "all";
/** `?release=open`: the release's dialog open as the page loads, to step into its changes. */
const RELEASE_OPEN = new URLSearchParams(location.search).get("release") === "open";

function Harness() {
  const shown =
    REVIEW === "all" ? REVIEW_STATES : REVIEW_STATES.filter((entry) => entry.id === REVIEW);
  return (
    <div className="flex flex-col gap-8 bg-background p-6">
      <ReviewDialogTry />
      <ReleaseDialogTry openAtStart={RELEASE_OPEN} />
      {shown.map((entry) =>
        entry.page === true ? (
          <ReviewPageStage key={entry.id} label={entry.label}>
            {entry.node}
          </ReviewPageStage>
        ) : (
          <ReviewStage key={entry.id} label={entry.label}>
            {entry.node}
          </ReviewStage>
        ),
      )}
    </div>
  );
}

/** A description's markdown asks the account what its commands may do: stand-ins that answer nothing. */
function Standins({ children }: { readonly children: ReactNode }) {
  const inventory: Inventory = {
    projects: [],
    isLoading: false,
    error: null,
    projectRefs: new Map(),
    authority: new Map(),
    lost: new Set(),
  };
  const data: ZeropsDataContextValue = {
    scope: {} as AccountScope,
    signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
    organizationRef: () => {
      throw new Error("not in the harness");
    },
    projectRef: () => {
      throw new Error("not in the harness");
    },
  };
  return (
    <ZeropsDataContext value={data}>
      <InventoryContext value={inventory}>{children}</InventoryContext>
    </ZeropsDataContext>
  );
}

// The app sets the theme on the document element (`themePalette.ts`), so the harness does the
// same, in the Zerops palette a fresh install wears.
const appearance = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      {/* The panes stand in the hosted frame, which outside the app shell
          draws its lockup as a router link; inside a sidebar it draws none,
          so the harness needs no router. */}
      <SidebarProvider className="block">
        <Standins>
          <Harness />
        </Standins>
      </SidebarProvider>
    </StrictMode>,
  );
}
