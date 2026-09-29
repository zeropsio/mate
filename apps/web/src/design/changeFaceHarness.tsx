/**
 * Changing a Mate's face, in each of its states: the verb in a Mate's own menu, beside Rename;
 * the dialog as it opens on the face the Mate wears, with a colour and a shape picked, saving,
 * and refused; and the menu taking the saved face.
 *
 * Served by the dev server at `/design-face.html` (`?theme=dark`; `?state=`: `menu` — Fen's menu
 * open, the verb beside Rename; `idle` — the dialog as it opens; `picked` — Rose and Seal picked;
 * `saving` — Save pressed, the platform answering; `refused` — the platform's reason beside the
 * buttons; `before` — the menu, nothing open). The dialog opens over the menu at the owner's
 * 435 px, as it does in the app. Open it at 1786 × 1000. `window.__faceHarness.answer("yes")`
 * has the platform take a pending save — the tags written, the menu redrawn from them, the
 * dialog closed — and `answer("no")` refuse it; `open()` opens the dialog again, so a frame
 * sampler can watch a row take its new face.
 *
 * Fixtures only. Nothing here ships — `design-face.html` is not `index.html`, and no route
 * imports this module.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  assignCandidateMateTints,
  withZeropsChangedFace,
  type ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { MateRowActions } from "~/components/zerops/SidebarMateMenu";
import { SidebarZeropsTree } from "~/components/zerops/SidebarZeropsTree";
import { ZeropsChangeFaceDialog } from "~/components/zerops/ZeropsChangeFaceDialog";
import { mateFaceOf } from "~/components/zerops/ZeropsChangeFaceDialog.logic";
import { deleteMateVerb } from "~/components/zerops/ZeropsDeleteMateDialog.logic";
import { SidebarContent, SidebarProvider } from "~/components/ui/sidebar";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { AppRouter } from "~/router";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "idle";
/** The dialog stands open from the first paint, over the menu, in every state but the menu's. */
const OPENS_AT_START = STATE !== "menu" && STATE !== "before";
const MENU_WIDTH = 435;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function mate(bot: string, face?: string): ZeropsCandidate {
  const id = `acme-docs-${bot.toLowerCase()}`;
  return {
    key: `${id}:zcp`,
    group: "connected",
    environmentId: EnvironmentId.make(`env-${id}`),
    project: {
      id,
      name: `Acme Docs - ${bot}`,
      status: "ACTIVE",
      tagList: [
        "mate",
        "mate:g:acme",
        "mate:role:dev",
        "mate:name:Acme Docs",
        `mate:bot:${bot}`,
        ...(face === undefined ? [] : [face]),
      ],
    },
    service: { id: `zcp-${id}`, name: "zcp", status: "ACTIVE" },
  };
}

/** Fen and Ada wear their names' tints; Quinn's face was picked when it was added. */
const MATES: ReadonlyArray<ZeropsCandidate> = [
  mate("Fen"),
  mate("Quinn", "mate:face:coral:gem"),
  mate("Ada"),
];
const FEN = MATES[0]!.project.id;

function activity(
  candidate: ZeropsCandidate,
  said: Partial<ZeropsAgentActivity> & { readonly task: string },
): ZeropsAgentActivity {
  return {
    threadId: ThreadId.make(`thread-${candidate.project.id}`),
    kind: "idle",
    status: null,
    face: "idle",
    subject: said.task,
    at: minutesAgo(42),
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: `${candidate.environmentId}:thread-${candidate.project.id}`,
    ...said,
  };
}

const ACTIVITY = new Map<string, ZeropsAgentActivity>([
  [
    MATES[0]!.project.id,
    activity(MATES[0]!, {
      task: "Add the changelog page",
      snippet: "The changelog lists every release since 1.0, newest first.",
      at: minutesAgo(12),
    }),
  ],
  [
    MATES[1]!.project.id,
    activity(MATES[1]!, {
      task: "Index the docs for search",
      snippet: "Search reads the new index; results show in 40 ms.",
      at: minutesAgo(64),
    }),
  ],
  [
    MATES[2]!.project.id,
    activity(MATES[2]!, {
      task: "Fix the broken links in the guides",
      snippet: "All 14 links point to live pages now.",
      at: minutesAgo(18),
      unread: true,
    }),
  ],
]);

const NO_CREW = { status: "none", view: null, attention: [] } as const;

declare global {
  interface Window {
    __faceHarness?: {
      readonly answer: (verdict: "yes" | "no") => void;
      readonly open: () => void;
      readonly saved: ReadonlyArray<ZeropsMateFace>;
    };
  }
}

const saved: Array<ZeropsMateFace> = [];

/** Presses a control the way a person does: React hears the click. */
function click(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

function Harness() {
  const [mates, setMates] = useState(MATES);
  const [open, setOpen] = useState(OPENS_AT_START);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = useRef<ZeropsMateFace | null>(null);
  const tints = assignCandidateMateTints(mates);
  const fen = mates.find((entry) => entry.project.id === FEN)!;

  useEffect(() => {
    window.__faceHarness = {
      answer: (verdict) => {
        const face = waiting.current;
        if (face === null) return;
        waiting.current = null;
        setPending(false);
        if (verdict === "no") {
          setError("Zerops rejected the request (forbidden).");
          return;
        }
        // The write landed: the read that confirms it is what the menu redraws from.
        setMates((current) =>
          current.map((entry) =>
            entry.project.id === FEN
              ? {
                  ...entry,
                  project: {
                    ...entry.project,
                    tagList: withZeropsChangedFace(entry.project.tagList, face),
                  },
                }
              : entry,
          ),
        );
        setOpen(false);
      },
      open: () => {
        setError(null);
        setOpen(true);
      },
      saved,
    };
  }, []);

  // The states past the first are reached the way a person reaches them: a colour and a shape
  // picked, Save pressed, the platform's refusal arriving.
  useEffect(() => {
    if (!OPENS_AT_START || STATE === "idle") return;
    const form = '[data-zerops-surface="change-face-form"]';
    const picking = window.setTimeout(() => {
      click(`${form} [role="radio"][aria-label="Rose"]`);
      click(`${form} [role="radio"][aria-label="Seal"]`);
    }, 250);
    const pressing =
      STATE === "saving" || STATE === "refused"
        ? window.setTimeout(() => {
            click(`${form} button[type="submit"]`);
          }, 700)
        : undefined;
    const refusing =
      STATE === "refused"
        ? window.setTimeout(() => {
            window.__faceHarness?.answer("no");
          }, 1100)
        : undefined;
    return () => {
      window.clearTimeout(picking);
      if (pressing !== undefined) window.clearTimeout(pressing);
      if (refusing !== undefined) window.clearTimeout(refusing);
    };
  }, []);

  // Fen's menu, opened as a right-click opens it.
  useEffect(() => {
    if (STATE !== "menu") return;
    const opening = window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-zerops-mate-row="${FEN}"]`);
      const box = row?.getBoundingClientRect();
      if (row === null || row === undefined || box === undefined) return;
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: box.left + 180,
          clientY: box.top + 22,
        }),
      );
    }, 300);
    return () => {
      window.clearTimeout(opening);
    };
  }, []);

  const actionsOf = (candidate: ZeropsCandidate): MateRowActions => {
    const bot = candidate.project.tagList?.find((tag) => tag.startsWith("mate:bot:"));
    const name = bot === undefined ? candidate.project.name : bot.slice("mate:bot:".length);
    return {
      muted: false,
      toggleMute: () => {},
      toggleUnread: () => {},
      copyLink: () => {},
      rename: { initialValue: name, validate: () => undefined, commit: () => {} },
      changeFace: () => {
        setError(null);
        setOpen(true);
      },
      entries: [
        { id: "restart", label: "Restart", onSelect: () => {} },
        { id: "assign", label: "Hand over…", onSelect: () => {} },
        { id: "move", label: "Move to project…", onSelect: () => {} },
        { id: "delete", label: deleteMateVerb(name), variant: "destructive", onSelect: () => {} },
      ],
    };
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <SidebarProvider className="block">
        <aside
          className="flex h-screen shrink-0 flex-col border-e border-border bg-sidebar text-sidebar-foreground"
          data-sidebar="sidebar"
          style={{ width: MENU_WIDTH }}
        >
          <SidebarContent>
            <div className="ps-2.25 pe-2 pt-4 pb-1">
              <SidebarZeropsTree
                activeProjectId={MATES[2]!.project.id}
                candidates={mates}
                complete
                getActivity={(item) => ACTIVITY.get(item.project.id)}
                getCrew={() => NO_CREW}
                getMateActions={(item) => actionsOf(item)}
                onBrowseProjects={() => {}}
                onSelect={() => {}}
                timestampFormat="24-hour"
              />
            </div>
          </SidebarContent>
        </aside>
      </SidebarProvider>
      <main className="flex min-w-0 flex-1 items-start justify-center p-10">
        <p className="max-w-md text-sm text-muted-foreground">The conversation opens here.</p>
      </main>
      {open ? (
        <ZeropsChangeFaceDialog
          error={error}
          face={mateFaceOf(tints, fen.project)}
          name="Fen"
          onCancel={() => {
            setOpen(false);
          }}
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
          onSave={(face) => {
            saved.push(face);
            waiting.current = face;
            setError(null);
            setPending(true);
          }}
          open
          pending={pending}
        />
      ) : null}
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
openAccountLifetime("design-face-harness");

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
