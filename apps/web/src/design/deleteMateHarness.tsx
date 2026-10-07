/**
 * Deleting a Mate, in each of its states: the dialog idle, with the name typed, deleting and
 * refused, a colleague's Mate's, and the left menu with the verb in a Mate's own menu while
 * another Mate of its project is on its way off Zerops.
 *
 * Served by the dev server at `/design-delete.html` (`?theme=dark`; `?state=`: `idle` — the
 * dialog as it opens; `typed` — the name typed, the button open; `deleting` — pressed, the
 * platform answering; `refused` — the platform's reason under the field; `colleague` — Quinn is
 * Theo's; `menu` — Fen's menu open, Quinn deleting; `before` — the menu as it stood, nothing
 * open; `&services=0|1|3|unread` counts what goes with Quinn). The dialog opens over the menu at
 * the owner's 435 px, as it does in the app. Open it at 1786 × 1000.
 * `window.__deleteHarness.answer()` answers a pending press on cue, and `deleteQuinn()` has the
 * platform say yes to Quinn's delete, so a frame sampler can watch its row take the news.
 *
 * Fixtures only. Nothing here ships — `design-delete.html` is not `index.html`, and no route
 * imports this module.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { MateRowActions } from "~/components/zerops/SidebarMateMenu";
import { SidebarZeropsTree } from "~/components/zerops/SidebarZeropsTree";
import { ZeropsDeleteMateDialog } from "~/components/zerops/ZeropsDeleteMateDialog";
import { deleteMateVerb, deleteMateWords } from "~/components/zerops/ZeropsDeleteMateDialog.logic";
import { SidebarContent, SidebarProvider } from "~/components/ui/sidebar";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { markMateDeleting } from "~/zerops/deletingMates";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import type { AppRouter } from "~/router";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "idle";
const SERVICES = params.get("services") ?? "3";
const MENU_WIDTH = 435;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

type Candidate = ZeropsCandidate & {
  readonly services?: {
    readonly hostnames: ReadonlyArray<string>;
    readonly deployedAt: string | undefined;
    readonly deployable: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
    readonly statuses: ReadonlyArray<{
      readonly hostname: string;
      readonly status: string;
      readonly runtime: boolean;
    }>;
  };
};

function mate(bot: string, hostnames: ReadonlyArray<string> | undefined): Candidate {
  const id = `acme-docs-${bot.toLowerCase()}`;
  return {
    key: `${id}:zcp`,
    group: "connected",
    environmentId: EnvironmentId.make(`env-${id}`),
    project: {
      id,
      name: bot,
      status: "ACTIVE",
      tagList: ["mate"],
      hq: { appId: "acme", appName: "Acme Docs", kind: "mate", mate: { face: "" } },
    },
    service: { id: `zcp-${id}`, name: "zcp", status: "ACTIVE" },
    ...(hostnames === undefined
      ? {}
      : {
          services: {
            hostnames,
            deployedAt: undefined,
            deployable: [],
            statuses: hostnames.map((hostname) => ({ hostname, status: "ACTIVE", runtime: true })),
          },
        }),
  };
}

/** What goes with Quinn: its developer's services, or none read. */
const QUINN_SERVICES: ReadonlyArray<string> | undefined =
  SERVICES === "unread"
    ? undefined
    : ["api", "db", "web"].slice(0, Math.max(0, Math.min(3, Number(SERVICES) || 0)));

const FEN = mate("Fen", ["api", "db"]);
const QUINN = mate("Quinn", QUINN_SERVICES);
const ADA = mate("Ada", ["web"]);
const MATES: ReadonlyArray<Candidate> = [FEN, QUINN, ADA];

function activity(
  candidate: Candidate,
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
    FEN.project.id,
    activity(FEN, {
      task: "Add the changelog page",
      kind: "working",
      face: "working",
      at: minutesAgo(3),
      liveStep: { words: "Running the tests" },
    }),
  ],
  [
    QUINN.project.id,
    activity(QUINN, {
      task: "Index the docs for search",
      snippet: "Search reads the new index; results show in 40 ms.",
      at: minutesAgo(64),
    }),
  ],
  [
    ADA.project.id,
    activity(ADA, {
      task: "Fix the broken links in the guides",
      snippet: "All 14 links point to live pages now.",
      at: minutesAgo(18),
      unread: true,
    }),
  ],
]);

const NINA: ZeropsMateOwner = {
  name: "Nina Hale",
  initials: "NH",
  avatarUrl: null,
  isViewer: true,
};
const THEO: ZeropsMateOwner = {
  name: "Theo Park",
  initials: "TP",
  avatarUrl: null,
  isViewer: false,
};
const OWNERS = new Map<string, ZeropsMateOwner>([
  [FEN.project.id, NINA],
  [QUINN.project.id, STATE === "colleague" ? THEO : NINA],
  [ADA.project.id, NINA],
]);

const NO_CREW = { status: "none", crew: null, logins: {} } as const;

function actionsOf(candidate: Candidate, live: ZeropsAgentActivity | undefined): MateRowActions {
  const name = candidate.project.name;
  return {
    muted: false,
    toggleMute: () => {},
    toggleUnread: () => {},
    copyLink: () => {},
    rename: { initialValue: name, validate: () => undefined, commit: () => {} },
    ...(live?.face === "working" ? { stop: () => {} } : {}),
    entries: [
      { id: "restart", label: "Restart", onSelect: () => {} },
      { id: "assign", label: "Hand over…", onSelect: () => {} },
      { id: "move", label: "Move to project…", onSelect: () => {} },
      { id: "delete", label: deleteMateVerb(name), variant: "destructive", onSelect: () => {} },
    ],
  };
}

/** The menu at the owner's width, as the app draws it: the project, its three Mates. */
function Menu() {
  return (
    <aside
      className="flex h-screen shrink-0 flex-col border-e border-border bg-sidebar text-sidebar-foreground"
      data-sidebar="sidebar"
      style={{ width: MENU_WIDTH }}
    >
      <SidebarContent>
        <div className="ps-2.25 pe-2 pt-4 pb-1">
          <SidebarZeropsTree
            activeProjectId={ADA.project.id}
            candidates={MATES}
            complete
            getActivity={(item) => ACTIVITY.get(item.project.id)}
            getCrew={() => NO_CREW}
            getMateActions={(item, live) => actionsOf(item, live)}
            getOwner={(item) => OWNERS.get(item.project.id)}
            onBrowseProjects={() => {}}
            onSelect={() => {}}
            timestampFormat="24-hour"
          />
        </div>
      </SidebarContent>
    </aside>
  );
}

declare global {
  interface Window {
    __deleteHarness?: {
      readonly answer: () => void;
      readonly deleteQuinn: () => void;
      readonly pressed: number;
    };
  }
}

/** Types the name into the dialog's field as a person would: React hears the input. */
function typeInto(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    '[data-zerops-surface="delete-mate-form"] input',
  );
  if (input === null) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function Harness() {
  const [open, setOpen] = useState(true);
  const dialog = STATE !== "menu" && STATE !== "before";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pressed, setPressed] = useState(0);

  useEffect(() => {
    window.__deleteHarness = {
      answer: () => {
        setPending(false);
        setError("Zerops rejected the request (forbidden).");
      },
      deleteQuinn: () => {
        markMateDeleting(QUINN.project.id);
      },
      pressed,
    };
  }, [pressed]);

  // The states past the first are reached the way a person reaches them: the name typed, the
  // button pressed, the platform's refusal arriving.
  useEffect(() => {
    if (!dialog || STATE === "idle" || STATE === "colleague") return;
    const typing = window.setTimeout(() => {
      typeInto("Quinn");
    }, 250);
    const pressing =
      STATE === "deleting" || STATE === "refused"
        ? window.setTimeout(() => {
            document
              .querySelector<HTMLButtonElement>(
                '[data-zerops-surface="delete-mate-form"] button[type="submit"]',
              )
              ?.click();
          }, 450)
        : undefined;
    const refusing =
      STATE === "refused"
        ? window.setTimeout(() => {
            window.__deleteHarness?.answer();
          }, 900)
        : undefined;
    return () => {
      window.clearTimeout(typing);
      if (pressing !== undefined) window.clearTimeout(pressing);
      if (refusing !== undefined) window.clearTimeout(refusing);
    };
  }, [dialog]);

  // Fen's menu, opened as a right-click opens it.
  useEffect(() => {
    if (STATE !== "menu") return;
    const opening = window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-zerops-mate-row="${FEN.project.id}"]`);
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

  const owner = OWNERS.get(QUINN.project.id);
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <SidebarProvider className="block">
        <Menu />
      </SidebarProvider>
      <main className="flex min-w-0 flex-1 items-start justify-center p-10">
        <p className="max-w-md text-sm text-muted-foreground">The conversation opens here.</p>
      </main>
      {dialog && open ? (
        <ZeropsDeleteMateDialog
          error={error}
          name="Quinn"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setPressed((count) => count + 1);
            setError(null);
            setPending(true);
          }}
          onOpenChange={setOpen}
          open={open}
          pending={pending}
          words={deleteMateWords({
            name: "Quinn",
            environment: QUINN.project.name,
            services: QUINN.services?.hostnames.length,
            owner: owner === undefined || owner.isViewer ? undefined : owner.name,
          })}
        />
      ) : null}
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
openAccountLifetime("design-delete-harness");
// The menu's state: Quinn's delete accepted, the listing not yet letting it go.
if (STATE === "menu") markMateDeleting(QUINN.project.id);

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
