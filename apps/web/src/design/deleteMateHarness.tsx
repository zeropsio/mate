/** Fixture-backed deletion page and Mate dialog for the design kit. */
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import type { HqOperation } from "@t3tools/client-runtime/zerops/hq";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
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
import {
  deletionOffer,
  deletionChoiceAgain,
  deletionPageState,
  deletionWaitingPerson,
  type DeletionProject,
} from "~/components/zerops/deletion.logic";
import { ZeropsDeleteMateDialog } from "~/components/zerops/ZeropsDeleteMateDialog";
import { ZeropsDeletionPage } from "~/components/zerops/ZeropsDeletionPage";
import {
  deleteMateServiceCount,
  deleteMateVerb,
  deleteMateWords,
} from "~/components/zerops/ZeropsDeleteMateDialog.logic";
import { Page } from "~/components/ui/page";
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

/** The page states use the same facts and review as the product. */
const PAGE_STATES = [
  "page",
  "production",
  "slide-confirmed",
  "name-empty",
  "name-differs",
  "name-held",
  "name-matches",
  "all-goes",
  "stage-stays",
  "code-kept",
  "plain",
  "not-admin",
  "project",
  "nothing",
  "running",
  "running-stays",
  "waiting",
  "waiting-other",
  "stopped",
  "stopped-token",
  "stopped-member",
  "page-refused",
  "page-gone",
  "start-refused",
  "delete-again",
];
const PAGE = PAGE_STATES.includes(STATE);
const LAST = PAGE || STATE === "last-member";
const CODE_ONLY = ["code-kept", "project"].includes(STATE);
const NO_MATE = ["plain", "project", "nothing", "page-refused"].includes(STATE);
const ACME = "Acme Docs";
const HOLDINGS = {
  repos: [
    { name: "docs", canKeep: true },
    { name: "web", canKeep: true },
    { name: RECIPE_REPO, canKeep: false },
  ],
  openChanges: 2,
};

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
  "running-stays": {
    id: "acme-deletion",
    kind: "app_deletion",
    phase: "accepted",
    at: minutesAgo(0),
    acceptedAt: minutesAgo(1),
    steps: [
      { part: "mate", projectId: "acme-docs-quinn", state: "gone" },
      { part: "stage", projectId: "acme-docs-stage", state: "deleting" },
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
    offers: ["again"],
    steps: [
      { part: "mate", projectId: "acme-docs-quinn", state: "gone" },
      { part: "stage", projectId: "acme-docs-stage", state: "deleting" },
      { part: "code", state: "pending" },
    ],
  },
  "stopped-token": {
    id: "deletion",
    kind: "app_deletion",
    phase: "accepted",
    at: minutesAgo(2),
    acceptedAt: minutesAgo(3),
    failure: { step: "token", code: "token_delete_refused", at: minutesAgo(2), origin: "hq" },
    offers: [],
    steps: [
      { part: "kept_production", projectId: "p-production", name: "production", state: "deleting" },
      { part: "mate", projectId: "p-mate", name: "workspace", state: "pending" },
      { part: "stage", projectId: "p-stage", name: "stage", state: "pending" },
      { part: "code", state: "pending" },
    ],
  },
};
const ACME_OPERATION =
  STATE === "waiting" || STATE === "waiting-other"
    ? {
        ...ACME_DELETIONS.waiting!,
        // HQ offers Continue only to the person it waits for: the viewer, Nina, in `waiting`.
        continueBy: STATE === "waiting" ? "nina" : "theo",
        offers: [STATE === "waiting" ? "continue" : "end"],
      }
    : STATE === "delete-again"
      ? ACME_DELETIONS.stopped
      : STATE === "stopped-member"
        ? { ...ACME_DELETIONS.stopped!, offers: [] }
        : ACME_DELETIONS[STATE];
/** Acme Docs as HQ's structure holds it in each state. */
const HAS_MATE = !NO_MATE && ACME_OPERATION === undefined;
const HAS_STAGE = !CODE_ONLY && STATE !== "plain" && STATE !== "nothing";
const HAS_PRODUCTION = [
  "page",
  "production",
  "slide-confirmed",
  "name-empty",
  "name-differs",
  "name-held",
  "name-matches",
  "all-goes",
  "nothing",
  "start-refused",
  "running-stays",
].includes(STATE);
const ACME_PROJECT: DeletionProject = {
  appId: "acme",
  name: ACME,
  placements: [
    ...(HAS_MATE
      ? [{ projectId: QUINN.project.id, kind: "mate", name: "Quinn", deletable: true }]
      : []),
    ...(HAS_STAGE
      ? [
          {
            projectId: "acme-docs-stage",
            kind: "stage",
            name: "acme-docs-stage",
            deletable: STATE !== "not-admin",
          },
        ]
      : []),
    ...(STATE === "plain"
      ? [{ projectId: "acme-docs-plain", kind: "plain", name: "acme-docs-plain", deletable: true }]
      : []),
  ],
  births: [],
  deleteApp: STATE !== "last-member" && STATE !== "page-refused" && STATE !== "stopped-member",
  environmentRecordsRead: true,
  environmentRecords: [],
  environments: [
    ...(HAS_STAGE
      ? [
          {
            tier: "stage" as const,
            kind: "zerops" as const,
            projectId: "acme-docs-stage",
            name: "acme-docs-stage",
            deletable: STATE !== "not-admin",
            madeByMate: false,
          },
        ]
      : []),
    ...(HAS_PRODUCTION
      ? [
          {
            tier: "production" as const,
            kind: "zerops" as const,
            projectId: "acme-docs-live",
            name: "acme-docs-live",
            deletable: true,
            madeByMate: true,
          },
        ]
      : []),
  ],
  hidden: [],
  deletion: hqOperationOf(ACME_OPERATION, "app_deletion"),
  ...(ACME_OPERATION?.steps === undefined
    ? {}
    : {
        steps: ACME_OPERATION.steps.map((step) =>
          step.part === "stage" && step.projectId !== undefined
            ? { ...step, name: step.projectId }
            : step,
        ),
      }),
};
const PAGE_MATE = HAS_MATE ? { projectId: QUINN.project.id, name: QUINN.project.name } : undefined;
const ACME_OFFER = deletionOffer({ mate: PAGE_MATE, project: ACME_PROJECT });
const PAGE_STATE = deletionPageState({
  structureRead: true,
  project: STATE === "page-gone" ? undefined : ACME_PROJECT,
  mate: PAGE_MATE,
  past: STATE === "delete-again" ? ACME_OPERATION?.id : undefined,
});
const PAGE_INITIAL =
  STATE === "delete-again"
    ? deletionChoiceAgain(ACME_PROJECT, HOLDINGS)
    : {
        fates: {
          ...([
            "production",
            "all-goes",
            "slide-confirmed",
            "name-empty",
            "name-differs",
            "name-held",
            "name-matches",
          ].includes(STATE)
            ? { "acme-docs-live": "goes" as const }
            : {}),
          ...(STATE === "stage-stays" ? { "acme-docs-stage": "stays" as const } : {}),
        },
        repoFates: STATE === "code-kept" ? { docs: "stays" as const } : {},
        slid: [
          "all-goes",
          "slide-confirmed",
          "name-empty",
          "name-differs",
          "name-matches",
        ].includes(STATE)
          ? { "acme-docs-live": true }
          : {},
        projectName: ["all-goes", "stage-stays", "code-kept", "name-held", "name-matches"].includes(
          STATE,
        )
          ? ACME
          : STATE === "name-differs"
            ? "Acme"
            : "",
      };

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
/** HQ's people by user id, as the live page reads what each is called. */
const PEOPLE: Readonly<Record<string, ZeropsMateOwner>> = { nina: NINA, theo: THEO };
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
      <SidebarProvider className="block w-auto shrink-0">
        <Menu
          candidates={
            LAST
              ? ACME_OPERATION === undefined && STATE !== "project"
                ? [QUINN]
                : []
              : matesWith(quinnDeletion)
          }
        />
      </SidebarProvider>
      {PAGE ? (
        <main className="min-w-0 flex-1 overflow-y-auto" data-zerops-surface="delete-page">
          <Page width="column">
            <ZeropsDeletionPage
              state={PAGE_STATE}
              error={
                STATE === "start-refused"
                  ? hqRefusalWords({ code: "conflict", reason: "held_changed" })
                  : null
              }
              holdings={HOLDINGS}
              initial={PAGE_INITIAL}
              mate={
                PAGE_STATE.kind === "form" && PAGE_STATE.offer.mate !== undefined
                  ? {
                      projectId: QUINN.project.id,
                      name: QUINN.project.name,
                      services: deleteMateServiceCount(QUINN),
                      tint: "sky",
                    }
                  : undefined
              }
              canGoBack
              onAgain={() => {}}
              onCancel={() => {}}
              onReturn={() => {}}
              onConfirm={() => {
                setPressed((count) => count + 1);
                setPending(true);
              }}
              pending={pending}
              waiting={
                PAGE_STATE.kind === "standing" && PAGE_STATE.offer.deletion.kind === "waiting"
                  ? {
                      person: deletionWaitingPerson(
                        PEOPLE[PAGE_STATE.offer.deletion.continueBy]?.called,
                      ),
                      press: PAGE_STATE.offer.deletion.press,
                      ...(PAGE_STATE.offer.deletion.yours
                        ? { onContinue: () => {} }
                        : { onEnd: () => {} }),
                    }
                  : undefined
              }
            />
          </Page>
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 items-start justify-center p-10">
          <p className="max-w-md text-body text-muted-foreground">The conversation opens here.</p>
        </main>
      )}
      {!PAGE && dialog && open ? (
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
            stays:
              ACME_OFFER.kind === "last-mate-only" || ACME_OFFER.kind === "mate"
                ? ACME_OFFER.stays
                : undefined,
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
