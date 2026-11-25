/**
 * Deleting a Mate, in each of its states: the dialog idle, with the name typed, deleting and
 * refused, a colleague's Mate's, and the left menu with the verb in a Mate's own menu while
 * another Mate of its project is on its way off Zerops.
 *
 * Served by the dev server at `/design-delete.html` (`?theme=dark`; `?state=`: `idle` — the
 * dialog as it opens; `typed` — the name typed, the button open; `deleting` — pressed, the
 * platform answering; `refused` — the platform's reason under the field; `colleague` — Quinn is
 * Theo's; `menu` — Fen's menu open, Quinn's deletion as HQ's navigation shows it (`&deletion=`
 * `deleting` — HQ runs it; `waiting` — it waits for its maker's Continue; `failed` — Zerops
 * refused; `failed-hq` — HQ stopped it); `before` — the menu as it stood, nothing open; `last` —
 * Quinn is the last Mate of Acme Docs, so its Delete offers "Only Quinn" or the whole project;
 * `whole` — the whole project chosen; `stage-slid` — its Stage slid and its name typed, Delete
 * open; `production` — a Production Mate made, its name typed and slid too; `running` — HQ deletes it, Quinn gone, its Stage going; `waiting` — it stopped for its
 * maker's Continue; `stopped` — Zerops refused its Stage, what is gone and what is still here;
 * `&services=0|1|3|unread` counts what goes with Quinn). The dialog opens over the menu at the owner's 435 px, as it does
 * in the app. Open it at 1786 × 1000. `window.__deleteHarness.answer()` answers a pending press on
 * cue, and `deleteQuinn()` has HQ's navigation show Quinn's deletion running, so a frame sampler
 * can watch its row take the news.
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
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import type { HqOperation } from "@t3tools/client-runtime/zerops/hq";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import {
  hqOperationOf,
  mateDeletionOf,
  operationFailureDetails,
} from "@t3tools/client-runtime/data";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { MateRowActions } from "~/components/zerops/SidebarMateMenu";
import { SidebarZeropsTree } from "~/components/zerops/SidebarZeropsTree";
import { mateDeletionLine } from "~/components/zerops/SidebarMateRow.logic";
import { ZeropsDeletionForm } from "~/components/zerops/ZeropsDeleteApplicationDialog";
import { deletionOffer, type DeletionProject } from "~/components/zerops/deletion.logic";
import { ZeropsDeleteMateDialog } from "~/components/zerops/ZeropsDeleteMateDialog";
import {
  deleteMateServiceCount,
  deleteMateVerb,
  deleteMateWords,
} from "~/components/zerops/ZeropsDeleteMateDialog.logic";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { SidebarContent, SidebarProvider } from "~/components/ui/sidebar";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsSessionContext } from "~/zerops/sessionContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import type { ZeropsSessionValue } from "~/zerops/ZeropsSessionProvider";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import type { AppRouter } from "~/router";
import "../index.css";

const params = new URLSearchParams(location.search);
const STATE = params.get("state") ?? "idle";
const SERVICES = params.get("services") ?? "3";
const MENU_WIDTH = 435;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

type Candidate = CandidateRow & {
  readonly services?: {
    readonly hostnames: ReadonlyArray<string>;
    readonly deployedAt: string | undefined;
    readonly deployable: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
    readonly statuses: ReadonlyArray<{
      readonly hostname: string;
      readonly status: string;
      readonly runtime: boolean;
    }>;
    readonly pools: ReadonlyArray<string>;
  };
};

function mate(bot: string, hostnames: ReadonlyArray<string> | undefined): Candidate {
  const id = `acme-docs-${bot.toLowerCase()}`;
  return {
    key: `${id}:zcp`,
    presence: "known",
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
            pools: [],
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

/** Quinn alone in Acme Docs: its Delete offers the Mate alone or the whole project. */
const PROJECT_STATES = [
  "last",
  "whole",
  "stage-slid",
  "production",
  "running",
  "waiting",
  "stopped",
];
const LAST = PROJECT_STATES.includes(STATE);
const ACME = "Acme Docs";
const ACME_HOLDINGS = { repos: ["docs", RECIPE_REPO], openChanges: 2 };

/** HQ's deletion of Acme Docs as its navigation shows it, in each state the dialog says. */
const ACME_DELETIONS: Readonly<Record<string, HqOperation>> = {
  running: {
    id: "acme-deletion",
    kind: "app_deletion",
    phase: "accepted",
    at: minutesAgo(0),
    acceptedAt: minutesAgo(1),
    steps: [
      { part: "mate", projectId: "acme-docs-quinn", state: "gone" },
      { part: "stage", projectId: "acme-docs-stage", state: "deleting" },
      { part: "code", state: "pending" },
    ],
  },
  waiting: {
    id: "acme-deletion",
    kind: "app_deletion",
    phase: "accepted",
    at: minutesAgo(2),
    acceptedAt: minutesAgo(3),
    failure: { step: "delete_project", code: "token_expired", at: minutesAgo(2), origin: "hq" },
    continueBy: "theo",
    steps: [
      { part: "mate", projectId: "acme-docs-quinn", state: "gone" },
      { part: "stage", projectId: "acme-docs-stage", state: "deleting" },
      { part: "code", state: "pending" },
    ],
  },
  stopped: {
    id: "acme-deletion",
    kind: "app_deletion",
    phase: "accepted",
    at: minutesAgo(2),
    acceptedAt: minutesAgo(3),
    failure: {
      step: "delete_project",
      code: "insufficientPermissions",
      at: minutesAgo(2),
      origin: "zerops",
      zerops: { words: "Forbidden." },
    },
    steps: [
      { part: "mate", projectId: "acme-docs-quinn", state: "gone" },
      { part: "stage", projectId: "acme-docs-stage", state: "deleting" },
      { part: "code", state: "pending" },
    ],
  },
};
const ACME_OPERATION = ACME_DELETIONS[STATE];
/** Acme Docs as HQ's structure holds it: Quinn, its Stage, its Git production. */
const ACME_PROJECT: DeletionProject = {
  appId: "acme",
  name: ACME,
  placements: [
    ...(ACME_OPERATION === undefined
      ? [{ projectId: QUINN.project.id, kind: "mate", name: "Quinn" }]
      : []),
    { projectId: "acme-docs-stage", kind: "stage", name: "acme-docs-stage" },
  ],
  births: [],
  deleteApp: true,
  environments: [
    {
      tier: "stage",
      kind: "zerops",
      projectId: "acme-docs-stage",
      name: "acme-docs-stage",
      deletable: true,
      madeByMate: false,
    },
    STATE === "production"
      ? {
          tier: "production",
          kind: "zerops",
          projectId: "acme-docs-live",
          name: "acme-docs-live",
          deletable: true,
          madeByMate: true,
        }
      : { tier: "production", kind: "git", branch: "release" },
  ],
  hidden: [],
  deletion: hqOperationOf(ACME_OPERATION, "app_deletion"),
  ...(ACME_OPERATION?.steps === undefined ? {} : { steps: ACME_OPERATION.steps }),
};
const ACME_OFFER = deletionOffer({
  mate: ACME_OPERATION === undefined ? { projectId: QUINN.project.id, name: "Quinn" } : undefined,
  project: ACME_PROJECT,
});

/** Quinn's deletion as HQ's navigation shows it on its project, in each state the row says. */
const QUINN_DELETIONS: Readonly<Record<string, HqOperation>> = {
  deleting: {
    id: "quinn-deletion",
    kind: "mate_deletion",
    phase: "delete_accepted",
    at: minutesAgo(0),
    acceptedAt: minutesAgo(0),
  },
  waiting: {
    id: "quinn-deletion",
    kind: "mate_deletion",
    phase: "accepted",
    at: minutesAgo(2),
    acceptedAt: minutesAgo(3),
    failure: { step: "delete_project", code: "token_expired", at: minutesAgo(2), origin: "hq" },
    continueBy: "theo",
  },
  failed: {
    id: "quinn-deletion",
    kind: "mate_deletion",
    phase: "delete_requested",
    at: minutesAgo(2),
    acceptedAt: minutesAgo(3),
    failure: {
      step: "delete_project",
      code: "insufficientPermissions",
      at: minutesAgo(2),
      origin: "zerops",
      zerops: { words: "Forbidden." },
    },
  },
  "failed-hq": {
    id: "quinn-deletion",
    kind: "mate_deletion",
    phase: "delete_requested",
    at: minutesAgo(2),
    acceptedAt: minutesAgo(3),
    failure: { step: "delete_project", code: "project_not_gone", at: minutesAgo(2), origin: "hq" },
  },
};

/** The three Mates, Quinn's project showing `operation`. */
function matesWith(operation: HqOperation | undefined): ReadonlyArray<Candidate> {
  if (operation === undefined) return MATES;
  const hq = QUINN.project.hq;
  if (hq === undefined) return MATES;
  return MATES.map((candidate) =>
    candidate === QUINN
      ? { ...QUINN, project: { ...QUINN.project, hq: { ...hq, operation } } }
      : candidate,
  );
}

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
  called: "Nina",
  initials: "NH",
  avatarUrl: null,
  isViewer: true,
};
const THEO: ZeropsMateOwner = {
  name: "Theo Park",
  called: "Theo",
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
function Menu({ candidates }: { readonly candidates: ReadonlyArray<Candidate> }) {
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
            candidates={candidates}
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

/** Types the name into the surface's last field as a person would: React hears the input. */
function typeInto(form: string, value: string): void {
  const input = [
    ...document.querySelectorAll<HTMLInputElement>(
      `[data-zerops-surface="${form}"] input:not([type="range"])`,
    ),
  ].at(-1);
  if (input === undefined) return;
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
  // The menu's state: Quinn's deletion as HQ's navigation shows it.
  const [quinnDeletion, setQuinnDeletion] = useState<HqOperation | undefined>(
    QUINN_DELETIONS[params.get("deletion") ?? (STATE === "menu" ? "deleting" : "")],
  );
  const deletion = mateDeletionOf({
    operation: quinnDeletion,
    status: QUINN.project.status,
  });
  const deletionLine = mateDeletionLine(deletion);
  const failed =
    deletion.kind === "failed" && deletionLine?.kind === "deletion-failed"
      ? { line: deletionLine.text, details: operationFailureDetails(deletion.failure) }
      : undefined;

  useEffect(() => {
    window.__deleteHarness = {
      answer: () => {
        setPending(false);
        setError("Zerops rejected the request (forbidden).");
      },
      deleteQuinn: () => {
        setQuinnDeletion(QUINN_DELETIONS.deleting);
      },
      pressed,
    };
  }, [pressed]);

  // The states past the first are reached the way a person reaches them: the name typed, the
  // button pressed, the platform's refusal arriving.
  // The whole project chosen, as a press on its card chooses it; its Stage slid as End slides it.
  useEffect(() => {
    if (STATE !== "whole" && STATE !== "stage-slid" && STATE !== "production") return;
    const choosing = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>('[data-slot="radio-card"]')[1]?.click();
    }, 200);
    const slide = (surface: string) => {
      const thumb = document.querySelector<HTMLElement>(
        `[data-zerops-surface="${surface}"] [data-slot="slide-confirm-thumb"] input`,
      );
      thumb?.focus();
      thumb?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    };
    const sliding =
      STATE === "stage-slid" || STATE === "production"
        ? window.setTimeout(() => {
            slide("delete-application-slides");
            if (STATE === "production") typeInto("delete-application-production", "acme-docs-live");
            typeInto("delete-application-form", ACME);
          }, 450)
        : undefined;
    const slidingProduction =
      STATE === "production"
        ? window.setTimeout(() => {
            slide("delete-application-production");
          }, 700)
        : undefined;
    return () => {
      window.clearTimeout(choosing);
      if (sliding !== undefined) window.clearTimeout(sliding);
      if (slidingProduction !== undefined) window.clearTimeout(slidingProduction);
    };
  }, []);

  useEffect(() => {
    if (!dialog || LAST || STATE === "idle" || STATE === "colleague") return;
    const form = "delete-mate-form";
    const typing = window.setTimeout(() => {
      typeInto(form, "Quinn");
    }, 250);
    const pressing =
      STATE === "deleting" || STATE === "refused"
        ? window.setTimeout(() => {
            document
              .querySelector<HTMLButtonElement>(
                `[data-zerops-surface="${form}"] button[type="submit"]`,
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
        <Menu candidates={LAST ? [QUINN] : matesWith(quinnDeletion)} />
      </SidebarProvider>
      <main className="flex min-w-0 flex-1 items-start justify-center p-10">
        <p className="max-w-md text-body text-muted-foreground">The conversation opens here.</p>
      </main>
      {LAST ? (
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogPopup className="max-w-md">
            <ZeropsDeletionForm
              error={null}
              holdings={ACME_HOLDINGS}
              mate={{
                name: "Quinn",
                services: deleteMateServiceCount(QUINN),
                owner: undefined,
              }}
              offer={ACME_OFFER}
              onAgain={() => {}}
              onCancel={() => setOpen(false)}
              onConfirm={() => {
                setPressed((count) => count + 1);
                setPending(true);
              }}
              pending={pending}
              project={ACME_PROJECT}
              waiting={
                ACME_OFFER.kind === "standing" && ACME_OFFER.deletion.kind === "waiting"
                  ? { person: THEO.name, press: ACME_OFFER.deletion.press }
                  : undefined
              }
            />
          </DialogPopup>
        </Dialog>
      ) : dialog && open ? (
        <ZeropsDeleteMateDialog
          error={error}
          failed={failed}
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

openAccountLifetime("design-delete-harness");

// The menu asks the account's projects which environments an application has: none here, the
// fixtures' own structure says them.
const NO_INVENTORY: Inventory = {
  projects: [],
  isLoading: false,
  error: null,
  projectRefs: new Map(),
  authority: new Map(),
  lost: new Set(),
  deleted: [],
};
const NO_DATA: ZeropsDataContextValue = {
  scope: {} as AccountScope,
  signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
  organizationRef: () => {
    throw new Error("not in the harness");
  },
  projectRef: () => {
    throw new Error("not in the harness");
  },
};
// The signed-in viewer the menu reads; whose each Mate is stays with `OWNERS`.
const VIEWER = {
  user: { id: "u-harness" },
  activeOrganization: null,
} as unknown as ZeropsSessionValue;

const router = createRouter({
  routeTree: createRootRoute({
    component: () => (
      <ZeropsSessionContext.Provider value={VIEWER}>
        <ZeropsDataContext value={NO_DATA}>
          <InventoryContext value={NO_INVENTORY}>
            <Harness />
          </InventoryContext>
        </ZeropsDataContext>
      </ZeropsSessionContext.Provider>
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
