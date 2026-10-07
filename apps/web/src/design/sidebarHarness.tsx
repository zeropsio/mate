/**
 * The sidebar, in every state it has, at the width it really gets — the thing
 * a string assertion cannot show you.
 *
 * Served by the dev server at `/design.html`. It renders the real components
 * with made-up data and no session, so there is no door to get through and
 * nothing live to disturb; both themes stand side by side because a sidebar
 * that reads well in one and badly in the other is a sidebar nobody checked.
 * Beside the menu stands the open Mate's conversation as far as its top bar,
 * so the logo row and the header read as the one line they share
 * (`?menu=closed` folds the menu into its corner mark, `?crew=1` puts a crew
 * on the Mate's line).
 *
 * ## The states are the point
 *
 * A fixture that shows one pull request, one route and one deploy proves the
 * happy path and hides every way the menu falls over. So the roster below is
 * written to be *hostile*: a service with ten public routes, a Mate with six
 * open pull requests, a production twelve changes behind, a name too long for
 * any of the three widths, a deploy nobody named, a production that failed
 * with nothing running, a project with no stops at all. Each one is a state
 * the product really reaches, and each one broke something the first time it
 * was drawn (the owner, 2026-09-19: "I still don't see you having simulated
 * states with open prs, unreleased prod etc., so how can you judge the
 * detail?").
 *
 * Fixtures only. Nothing here ships in the app bundle — `design.html` is not
 * `index.html`, and no route imports this module.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  placedMenuRows,
  placedNames,
  placementsOf,
  type HqPlacement,
  type HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
import {
  assignCandidateMateTints,
  deployedVersion,
  mateShapeOf,
  readZeropsMembership,
  type EnvironmentRow,
  type FlowPullRequest,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { changeUrl } from "@t3tools/shared/hqChanges";
import type { MateThreadKind } from "@t3tools/shared/mateLink";
import { EllipsisIcon } from "lucide-react";

import { onOpenCommandPalette } from "~/commandPaletteBus";
import { ConversationStripView } from "~/components/chat/ConversationStrip";
import type { LineCrewmate } from "~/components/chat/ConversationStrip.logic";
import { PanelLayoutControls } from "~/components/chat/PanelLayoutControls";
import { SidebarChromeHeader, SidebarCornerMark } from "~/components/sidebar/SidebarChrome";
import { Button } from "~/components/ui/button";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { ZeropsMark } from "~/components/ZeropsMark";
import { CommandDialog, CommandDialogPopup } from "~/components/ui/command";
import {
  chooseJumpItem,
  JumpBoxView,
  jumpSearchText,
  useJumpBoxModel,
  useJumpBoxState,
} from "~/components/zerops/JumpBox";
import {
  jumpWritePlan,
  type JumpHit,
  type SidebarJumpIndex,
} from "~/components/zerops/JumpBox.logic";
import { SidebarJumpButton } from "~/components/zerops/SidebarJumpButton";
import { zeropsAccountDisplay } from "~/components/zerops/landing/ZeropsAccountControl.logic";
import { SidebarZeropsAccount } from "~/components/zerops/SidebarZeropsAccount";
import { SidebarWaitingStack } from "~/components/zerops/SidebarWaitingStack";
import { useSidebarWaiting } from "~/zerops/useSidebarWaiting";
import type { MateDecision } from "~/components/zerops/mateDecision.logic";
import type { SidebarCrewRead } from "~/components/zerops/crew/SidebarCrewLine";
import { newProjectOffered } from "~/components/zerops/SidebarProjects.logic";
import {
  SidebarNewProject,
  SidebarAccountLine,
  SidebarZeropsTree,
  type SidebarProjectFlow,
} from "~/components/zerops/SidebarZeropsTree";
import { SidebarContent, SidebarProvider } from "~/components/ui/sidebar";
import { HeadingLadder } from "./headingLadder";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { setLocalStorageItem } from "~/hooks/useLocalStorage";
import { writeCollapsedProjects } from "~/zerops/collapsedProjects";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import { shownInScope, useMateScope } from "~/zerops/mateScope";
import { isMacPlatform } from "~/lib/utils";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { formatShortTimestamp } from "~/timestampFormat";
import { slashKeyOpensJumpBox } from "~/zerops/jumpSlash";
import { useSidebarJump } from "~/zerops/sidebarJump";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema } from "~/zerops/projectOrderPreference";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { ZeropsSessionContext } from "~/zerops/sessionContext";
import type { ZeropsSessionValue } from "~/zerops/ZeropsSessionProvider";
import type { AppRouter } from "~/router";

import "../index.css";
import { HARNESS_HQ } from "./reviewHarnessPictures";
import { COMING_PHASES, comingMenu, type ComingPhase } from "./comingMenuFixtures";
import {
  PLAN_ACTIVE,
  PLAN_ACTIVITY,
  PLAN_CANDIDATES,
  PLAN_COLLAPSED,
  PLAN_FLOWS,
  PLAN_OWNERS,
} from "./sidebarPlanFixtures";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/** A full sha, as a version name written before 2026-09-30 spells it. */
const sha = (seed: string) => seed.padEnd(40, "0").slice(0, 40);

function routes(
  ...specs: ReadonlyArray<[service: string, host: string, port?: number]>
): ReadonlyArray<ZeropsPublicRoute> {
  return specs.map(([service, host, port = 80]) => ({
    service,
    port,
    host,
    url: `https://${host}`,
  }));
}

/** The Mates a colleague signed in: they wait on their owner, never on the viewer. */
const COLLEAGUES_MATES: ReadonlySet<string> = new Set([
  "links-theo",
  "shop-otto",
  "shop-mira",
  "notes-iris",
  "notes-kai",
  "todo-nils",
]);

function candidate(
  id: string,
  name: string,
  hq: HqPlacement,
  options: {
    readonly connected?: boolean;
    readonly container?: boolean;
    readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  } = {},
): ZeropsCandidate {
  const { connected = true, container = true, routes: theRoutes } = options;
  // Every Mate here has its agent signed in (D6), as HQ's overview of it names them — by the
  // viewer, or by a colleague where its owner is not the viewer; the plan set's Hollin holds the
  // ones nobody has.
  const signer = COLLEAGUES_MATES.has(id) ? "u-colleague" : "u-harness";
  const signed: HqPlacement =
    hq.kind !== "mate" || hq.mate === null
      ? hq
      : {
          ...hq,
          mate: {
            ...hq.mate,
            logins: { "claude-code": { signedInBy: signer, present: true, token: false } },
          },
        };
  const tagList = hq.kind === "mate" ? ["mate"] : [];
  const base = {
    key: `${id}:zcp`,
    project: { id, name, status: "ACTIVE", tagList, hq: signed },
    group: connected ? ("connected" as const) : ("ready" as const),
    // Where its conversation lives: what the jump box searches.
    ...(connected && container ? { environmentId: EnvironmentId.make(`env-${id}`) } : {}),
  };
  const withRoutes = theRoutes === undefined ? base : { ...base, routes: theRoutes };
  // A stop's services, as the platform reads them: up, so its chip settles.
  const read = container
    ? withRoutes
    : {
        ...withRoutes,
        services: {
          hostnames: ["app"],
          deployedAt: hoursAgo(3),
          deployable: [],
          statuses: [{ hostname: "app", status: "ACTIVE", runtime: true }],
        },
      };
  return container
    ? { ...withRoutes, service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
    : {
        ...read,
        group: "unavailable",
        reason: "no Zerops Mate container in this project",
        missingContainer: true,
      };
}

function activity(input: {
  readonly id?: string;
  readonly subject?: string;
  readonly snippet?: string;
  readonly hours: number;
  readonly face: ZeropsAgentActivity["face"];
  readonly kind?: ZeropsAgentActivity["kind"];
  readonly unread?: boolean;
  readonly pausedUntil?: string;
  readonly task?: string;
}): ZeropsAgentActivity {
  const id = input.id ?? "thread";
  return {
    threadId: ThreadId.make(`thread-${id}`),
    kind: input.kind ?? "idle",
    status: null,
    face: input.face,
    subject: input.subject,
    snippet: input.snippet,
    at: hoursAgo(input.hours),
    unread: input.unread ?? false,
    pausedUntil: input.pausedUntil,
    threadKey: `env-${id}:thread-${id}`,
    task: input.task ?? input.subject,
  };
}

/** A project of the harness — an application in its HQ — placing a Mate or a stop in it. */
const group = (appId: string, appName: string) => ({
  mate: (): HqPlacement => ({ appId, appName, kind: "mate", mate: { face: "" } }),
  stop: (kind: "stage" | "production"): HqPlacement => ({ appId, appName, kind, mate: null }),
});

/** What a waiting Mate's thread says it waits on, as the jump box reads it. */
const DECISIONS = new Map<string, MateDecision>([
  [
    "links-theo",
    {
      kind: "approval",
      requestId: "req-theo",
      title: "Theo wants to run",
      detail: "psql \"$DATABASE_URL\" -c 'DROP TABLE link_previews_legacy;'",
      choices: [
        { label: "Approve", value: "accept", primary: true },
        { label: "Deny", value: "decline", primary: false },
      ],
    },
  ],
  [
    "todo-vera",
    {
      kind: "question",
      requestId: "req-vera",
      questionId: "finished",
      question: "Should finished items sink to the bottom, or hide behind a toggle?",
      choices: [
        { label: "Sink to the bottom", value: "sink", primary: false },
        { label: "Hide behind a toggle", value: "hide", primary: false },
        { label: "Both, the toggle off by default", value: "both", primary: false },
      ],
      allowText: true,
    },
  ],
  [
    "todo-fen",
    { kind: "failure", message: "The deploy to stage failed: the build timed out after 120 s." },
  ],
]);

const LINKS = group("links", "Links");
const SHOP = group("shop", "Shop");
const NOTES = group("notes", "Notes");
const TODO = group("todo", "Todo");
const LONG = group("design-tokens", "Design system tokens and primitives");

const CANDIDATES: ReadonlyArray<ZeropsCandidate> = [
  // A busy, healthy project: three Mates, a change of each kind waiting.
  candidate("links-enzo", "Enzo", LINKS.mate()),
  candidate("links-theo", "Theo", LINKS.mate()),
  candidate("links-wren", "Wren", LINKS.mate()),
  candidate("links-stage", "Links - stage", LINKS.stop("stage"), {
    container: false,
    routes: routes(["app", "links-stage.zerops.app"]),
  }),
  candidate("links-prod", "Links - production", LINKS.stop("production"), {
    container: false,
    routes: routes(["app", "links.example.com"]),
  }),

  // The hostile one: a Mate buried in pull requests, a production ten routes
  // wide and twelve changes behind, a stage mid-deploy.
  candidate("shop-mira", "Mira", SHOP.mate()),
  candidate("shop-otto", "Otto", SHOP.mate()),
  candidate("shop-stage", "Shop - stage", SHOP.stop("stage"), {
    container: false,
    routes: routes(["app", "shop-stage.zerops.app"], ["api", "api-shop-stage.zerops.app"]),
  }),
  candidate("shop-prod", "Shop - production", SHOP.stop("production"), {
    container: false,
    routes: routes(
      ["api", "api.shop.example.com"],
      ["api", "api.shop.example.com", 8443],
      ["admin", "admin.shop.example.com"],
      ["app", "shop.example.com"],
      ["app", "www.shop.example.com"],
      ["app", "shop.example.de"],
      ["app", "shop.example.co.uk"],
      ["assets", "static.shop.example.com"],
      ["docs", "docs.shop.example.com"],
      ["webhooks", "hooks.shop.example.com"],
    ),
  }),

  // A production somebody deployed by hand, and a stage that does not exist.
  candidate("notes-iris", "Iris", NOTES.mate()),
  candidate("notes-kai", "Kai", NOTES.mate()),
  candidate("notes-lena", "Lena", NOTES.mate()),
  // Signed in, and nobody has asked either anything yet: one says so, one holds a draft.
  candidate("notes-juno", "Juno", NOTES.mate()),
  candidate("notes-rhea", "Rhea", NOTES.mate()),
  candidate("notes-prod", "Notes - production", NOTES.stop("production"), {
    container: false,
    routes: routes(["app", "notes.example.com"], ["app", "www.notes.example.com"]),
  }),

  // The dead end: a production whose last deploy failed, running nothing.
  candidate("todo-vera", "Vera", TODO.mate()),
  candidate("todo-fen", "Fen", TODO.mate()),
  // A colleague's Mate asking its owner, beside Vera asking the viewer.
  candidate("todo-nils", "Nils", TODO.mate()),
  candidate("todo-stage", "Todo - stage", TODO.stop("stage"), {
    container: false,
    routes: routes(["app", "todo-stage.zerops.app"]),
  }),
  candidate("todo-prod", "Todo - production", TODO.stop("production"), { container: false }),

  // A name longer than any width here, and a project that is only a Mate:
  // nothing has been set up for it to travel to yet.
  candidate("tokens-ada", "Ada", LONG.mate()),
];

const ACTIVITY = new Map<string, ZeropsAgentActivity>([
  [
    "links-enzo",
    {
      // Working: the step it is on, as the server relays it (D5).
      ...activity({
        id: "links-enzo",
        task: "Add a search box above the list that filters the saved links",
        subject: "Run the build",
        snippet: "The search box filters as you type. Running the build now.",
        hours: 0.053,
        face: "working",
        kind: "working",
      }),
      liveStep: { words: "Bundle the search box" },
    },
  ],
  [
    "links-theo",
    activity({
      id: "links-theo",
      subject: "Drop the old previews table once the cache is live",
      snippet: "The cache holds every preview. Dropping the old table needs your OK.",
      hours: 0.05,
      face: "needs",
      kind: "approval",
    }),
  ],
  [
    "shop-mira",
    activity({
      id: "shop-mira",
      subject: "Split the checkout into a two-step flow with a saved basket",
      snippet: "Mira hit the usage limit. Work can continue when it resets.",
      hours: 1,
      face: "sleep",
      pausedUntil: new Date(Date.now() + 2.5 * 3_600_000).toISOString(),
    }),
  ],
  [
    "shop-otto",
    activity({
      id: "shop-otto",
      subject: "Why does the VAT come out wrong for Irish orders?",
      snippet: "Because the rate table is keyed by country and Ireland has…",
      hours: 30,
      face: "done",
      unread: true,
    }),
  ],
  [
    "notes-iris",
    activity({
      id: "notes-iris",
      subject: "Show a live character count under the body field of the note form",
      snippet: 'Healthy, and the rendered body confirms "0 characters"…',
      hours: 20,
      face: "idle",
    }),
  ],
  [
    "todo-vera",
    {
      // Needs you: the question itself, as the server relays it (D6).
      ...activity({
        id: "todo-vera",
        subject: "Move finished items out of the way",
        snippet: "I looked at how the list sorts today.",
        hours: 0.2,
        face: "needs",
        kind: "input",
      }),
      question: "Should finished items sink to the bottom, or hide behind a toggle?",
    },
  ],
  [
    "todo-nils",
    {
      // A colleague's Mate asking its owner: its question at rest, nothing on the viewer.
      ...activity({
        id: "todo-nils",
        subject: "Sort the list by due date",
        snippet: "The items have no due date yet.",
        hours: 0.1,
        face: "needs",
        kind: "input",
      }),
      question: "Should an item without a due date go first or last?",
    },
  ],
  [
    "todo-fen",
    {
      // Stopped on an error: its first line.
      ...activity({
        id: "todo-fen",
        subject: "Rename the app in the page title and the main heading",
        snippet: "Renamed it in the title; deploying to stage now.",
        hours: 0.3,
        face: "needs",
        kind: "failed",
      }),
      errorLine: "The deploy to stage failed: the build timed out after 120 s.",
    },
  ],
  [
    "notes-kai",
    // Asked, and no answer yet: the row is simply shorter.
    activity({
      id: "notes-kai",
      subject: "Add a dark mode to the note editor",
      hours: 3,
      face: "idle",
    }),
  ],
  [
    "notes-lena",
    {
      // Sent a moment ago, its run not started: the dots hold the line.
      ...activity({
        id: "notes-lena",
        subject: "Why is the export to PDF so slow?",
        hours: 0.01,
        face: "idle",
      }),
      awaitingWords: true,
    },
  ],
  [
    "tokens-ada",
    activity({
      subject: "Pull the spacing scale out of the components into one file",
      snippet: "There were four scales. They are one now, and nothing moved…",
      // Untouched for more than a week: it folds into its project's quiet Mates.
      hours: 9 * 24,
      face: "idle",
    }),
  ],
]);

function pull(
  input: Partial<FlowPullRequest> & { number: number; mateProjectId: string },
): FlowPullRequest {
  const repository = input.repository ?? "appdev";
  // Its application, which a Mate's id here begins with.
  const appId = input.mateProjectId.split("-")[0] ?? input.mateProjectId;
  return {
    repository,
    title: "Change",
    kind: "code",
    url: changeUrl(HARNESS_HQ, appId, repository, input.number),
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "3f9c1b2",
    baseBranch: "main",
    line: `appdev #${input.number}`,
    updatedAt: hoursAgo(2),
    ...input,
  };
}

/** A change whose branch has fallen behind `main` and conflicts with it: HQ will not merge it. */
const behindPull = (input: Partial<FlowPullRequest> & { number: number; mateProjectId: string }) =>
  pull({ mergeability: "conflicting", ...input });

function environment(
  input: Partial<Omit<EnvironmentRow, "version" | "versionRepository">> & {
    projectId: string;
    /** The Zerops app-version name, parsed the way the product parses it. */
    appVersionName?: string | undefined;
    versionRepository?: string | undefined;
  },
): EnvironmentRow {
  const { appVersionName, versionRepository = "appdev", ...rest } = input;
  const version = deployedVersion(appVersionName);
  const source = rest.source ?? "main";
  return {
    kind: "environment",
    name: "stage",
    tier: "stage",
    source,
    commit: version.commit,
    version,
    versionRepository,
    line: version.label === undefined ? source : `${source} · ${version.label}`,
    tone: "good",
    deploys: [],
    keyGap: false,
    ...rest,
  };
}

/** What a release would put live, as `releaseContents` carries it: one comparison of `appdev`. */
const changes = (...subjects: ReadonlyArray<string>) => [
  {
    repository: "appdev",
    services: ["app"],
    commits: subjects.map((subject, index) => ({
      sha: `c${index}`,
      subject,
      authorName: "Juno",
      at: "2026-10-02T10:00:00.000Z",
      change: null,
    })),
    total: subjects.length,
    truncated: false,
  },
];

const FLOWS = new Map<string, SidebarProjectFlow>([
  [
    "links",
    {
      pullRequests: [
        pull({
          number: 4,
          title: "Add a search box above the list",
          mateProjectId: "links-enzo",
          mergeability: "conflicting",
          merged: false,
          mergedAt: undefined,
        }),
        // Enzo's #4 in a second repository: each of its rows names its own.
        pull({
          number: 4,
          repository: "apidev",
          title: "Rebuild the API on the new schema",
          mateProjectId: "links-enzo",
        }),
        pull({
          number: 5,
          title: "Cache the link previews",
          mateProjectId: "links-theo",
          mergeability: "conflicting",
          merged: false,
          mergedAt: undefined,
        }),
      ],
      environments: new Map([
        ["links-stage", environment({ projectId: "links-stage", appVersionName: sha("3f9c1b2e") })],
        [
          "links-prod",
          environment({
            projectId: "links-prod",
            name: "production",
            tier: "production",
            source: "release",
            appVersionName: `${sha("77ab0e1f")} v1.4.0 ada`,
          }),
        ],
      ]),
      releaseOffered: true,
      releaseContents: changes(
        "Add a search box above the list",
        "Rename the app in the page title",
        "Cache the link previews",
      ),
    },
  ],
  [
    "shop",
    {
      pullRequests: [
        // Six on one Mate: past the fold, which is the state the fold exists for.
        pull({
          number: 41,
          title: "Two-step checkout: the basket step",
          mateProjectId: "shop-mira",
        }),
        pull({
          number: 42,
          title: "Two-step checkout: the payment step",
          mateProjectId: "shop-mira",
          mergeability: "conflicting",
          merged: false,
          mergedAt: undefined,
        }),
        behindPull({
          number: 38,
          title: "Keep the basket in local storage across a reload",
          mateProjectId: "shop-mira",
        }),
        pull({
          number: 39,
          title: "Tidy the order confirmation email template",
          mateProjectId: "shop-mira",
          mergeability: "conflicting",
          merged: false,
          mergedAt: undefined,
        }),
        pull({ number: 40, title: "Extract the price formatter", mateProjectId: "shop-mira" }),
        behindPull({
          number: 31,
          title: "Add an index on orders.created_at",
          mateProjectId: "shop-mira",
        }),
        pull({
          number: 44,
          title: "Fix the VAT rate table for Ireland",
          mateProjectId: "shop-otto",
        }),
        pull({
          number: 45,
          repository: "group",
          kind: "recipe",
          title: "Give the stage a bigger database",
          mateProjectId: "shop-otto",
        }),
      ],
      environments: new Map([
        [
          "shop-stage",
          environment({
            projectId: "shop-stage",
            appVersionName: sha("b21d904c"),
            tone: "pending",
          }),
        ],
        [
          "shop-prod",
          environment({
            projectId: "shop-prod",
            name: "production",
            tier: "production",
            source: "release",
            appVersionName: `${sha("5c3ea18b")} v2.11.0 mira`,
          }),
        ],
      ]),
      releaseOffered: true,
      // Twelve behind: the number a production reaches when nobody released
      // for a fortnight, and the list a hover cannot hold.
      releaseContents: changes(
        "Two-step checkout: the basket step",
        "Extract the price formatter",
        "Fix the VAT rate table for Ireland",
        "Tidy the order confirmation email template",
        "Add an index on orders.created_at",
        "Keep the basket in local storage across a reload",
        "Retry the payment webhook three times",
        "Stop logging the full card token",
        "Move the sitemap to the CDN",
        "Bump the image resizer",
        "Add a health check to the worker",
        "Drop the unused coupons table",
      ),
    },
  ],
  [
    "notes",
    {
      pullRequests: [],
      environments: new Map([
        [
          "notes-prod",
          environment({
            projectId: "notes-prod",
            name: "production",
            tier: "production",
            source: "release",
            // Nobody tagged this: somebody pushed it by hand during an outage.
            appVersionName: "hotfix-cache-headers",
          }),
        ],
      ]),
      releaseOffered: false,
      recipeRead: true,
      recipeTiers: ["stage", "production"],
    },
  ],
  [
    "todo",
    {
      pullRequests: [
        pull({ number: 9, title: "Rename the app in the page title", mateProjectId: "todo-fen" }),
      ],
      environments: new Map([
        [
          "todo-stage",
          environment({
            projectId: "todo-stage",
            appVersionName: sha("3f9c1b2e"),
            tone: "pending",
          }),
        ],
        [
          "todo-prod",
          environment({
            projectId: "todo-prod",
            name: "production",
            tier: "production",
            source: "release",
            // Never deployed, and the last attempt failed: the dead end.
            tone: "bad",
          }),
        ],
      ]),
      releaseOffered: false,
    },
  ],
  [
    "design-tokens",
    {
      pullRequests: [],
      environments: new Map(),
      releaseOffered: false,
      recipeRead: true,
      recipeTiers: ["stage", "production"],
    },
  ],
]);

/** A picture that needs no network: a flat disc standing in for a photo. */
const PORTRAIT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#3b5b7a"/><circle cx="8" cy="6" r="3" fill="#e8c4a8"/><ellipse cx="8" cy="15" rx="6" ry="5" fill="#e8c4a8"/></svg>',
)}`;

/**
 * Whose each Mate is: a picture, initials where the account has none, and a
 * Mate whose owner the member list could not name — which wears no badge.
 * Fen's crew is the viewer's own and Otto's a colleague's, so their menus
 * differ by *Crew*.
 */
const OWNERS = new Map<string, ZeropsMateOwner>([
  ["links-enzo", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: true }],
  ["links-theo", { name: "Jan Beneš", initials: "JB", avatarUrl: null, isViewer: false }],
  ["todo-fen", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: true }],
  ["shop-otto", { name: "Jan Beneš", initials: "JB", avatarUrl: null, isViewer: false }],
  ["shop-mira", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: false }],
  ["notes-iris", { name: "Eva Dvořák", initials: "ED", avatarUrl: null, isViewer: false }],
  ["notes-kai", { name: "Jan Beneš", initials: "JB", avatarUrl: null, isViewer: false }],
  ["notes-lena", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: true }],
  ["todo-vera", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: true }],
  ["todo-nils", { name: "Jan Beneš", initials: "JB", avatarUrl: null, isViewer: false }],
]);

/**
 * `?set=coming`: one project while its new Mate comes up (`comingMenuFixtures.ts`), its phase
 * from `&phase=` and `window.__comingMenu.go(phase)`.
 */
const COMING_SET = new URLSearchParams(location.search).get("set") === "coming";
const COMING_PHASE: ComingPhase =
  COMING_PHASES.find((phase) => phase === new URLSearchParams(location.search).get("phase")) ??
  "coming";
/**
 * Who looks at it: the person who signed in the fixture set's own Mates — only theirs wait on
 * them. In `?set=coming`, the person who added Quinn, so it waits for their sign-in — or with
 * `&viewer=colleague` anybody else, who reads that nobody has signed it in yet.
 */
const COMING_VIEWER: ZeropsSessionValue | null = !COMING_SET
  ? ({ user: { id: "u-harness" } } as unknown as ZeropsSessionValue)
  : ({
      user: {
        id:
          new URLSearchParams(location.search).get("viewer") === "colleague"
            ? "u-other"
            : "u-harness",
      },
    } as unknown as ZeropsSessionValue);

/**
 * Which fixtures the menu draws: the hostile set, or with `?set=plan` the pass
 * 16 plan's own six projects (`sidebarPlanFixtures.ts`), to put beside its mock.
 */
const FIXTURES = COMING_SET
  ? {
      candidates: comingMenu(COMING_PHASE).candidates,
      activity: new Map<string, ZeropsAgentActivity>(),
      flows: new Map<string, SidebarProjectFlow>(),
      owners: new Map<string, ZeropsMateOwner>([
        ["acme-fen", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: true }],
        ["acme-ada", { name: "Jan Beneš", initials: "JB", avatarUrl: null, isViewer: false }],
      ]),
      active: "acme-quinn",
      collapsed: [] as ReadonlyArray<string>,
    }
  : new URLSearchParams(location.search).get("set") === "plan"
    ? {
        candidates: PLAN_CANDIDATES,
        activity: PLAN_ACTIVITY,
        flows: PLAN_FLOWS,
        owners: PLAN_OWNERS,
        active: PLAN_ACTIVE,
        collapsed: PLAN_COLLAPSED,
      }
    : {
        candidates: CANDIDATES,
        activity: ACTIVITY,
        flows: FLOWS,
        owners: OWNERS,
        active: "links-enzo",
        collapsed: [],
      };

const activityOfCandidate = (item: ZeropsCandidate) => FIXTURES.activity.get(item.project.id);

/**
 * `?notice=trouble` or `?notice=lapse`: the account's one line at the menu's foot — the
 * inventory's lasting trouble, or a lapse whose renewal failed.
 */
const FOOT_LINES: Record<
  string,
  { readonly sentence: string; readonly actions: ReadonlyArray<string> }
> = {
  trouble: { sentence: "Zerops isn't answering. Trying again…", actions: ["Try now"] },
  lapse: { sentence: "Zerops isn't answering.", actions: ["Try now", "Sign out"] },
};
const FOOT_LINE = FOOT_LINES[new URLSearchParams(location.search).get("notice") ?? ""] ?? null;

/**
 * A crew of four under a Mate — the lead first — as its Mate's overview carries it to HQ, built
 * from the crew's own fixture, named and tinted as the plan's menu draws them: each crewmate's
 * chat in the kind given, and its ready tasks.
 */
function harnessCrew(input: {
  readonly states: Readonly<Record<string, MateThreadKind>>;
  readonly ready: ReadonlyArray<string>;
}): SidebarCrewRead {
  const fixture = crewSnapshotFixture();
  const names: Readonly<Record<string, readonly [string, MateTintId]>> = {
    lead: ["Ada", "violet"],
    backend: ["Bo", "sky"],
    frontend: ["Cy", "coral"],
    erik: ["Dee", "rose"],
  };
  return {
    status: "applied",
    crew: {
      crewmates: fixture.crewmates.map((mate) => {
        const [displayName, tint] = names[mate.handle] ?? [mate.displayName, mate.tint];
        return {
          handle: mate.handle,
          displayName,
          tint,
          lead: mate.kind === "lead",
          threadId: mate.currentThreadId,
          threadKind: input.states[mate.handle] ?? "idle",
          loginKey: null,
        };
      }),
      attention: [],
      readyTasks: fixture.board.tasks
        .filter((task) => input.ready.includes(task.id))
        .map((task) => ({ id: task.id, owner: task.owner })),
      personLands: true,
    },
    logins: {},
  };
}

/**
 * Fen's crew as the plan draws it; Otto's with a crewmate waiting on you;
 * Enzo with crew mode on and no crew yet, whose menu offers *Set up a crew*.
 */
const CREWS = new Map<string, SidebarCrewRead>([
  ["todo-fen", harnessCrew({ states: { backend: "working" }, ready: ["task-13"] })],
  ["shop-otto", harnessCrew({ states: { backend: "input", frontend: "working" }, ready: [] })],
  ["links-enzo", { status: "none", crew: null, logins: {} }],
]);

/** Which Mate the menu opened, and what else it was asked to do, for the audit browser. */
const menuActions: string[] = [];
(window as unknown as { __menuActions?: string[] }).__menuActions = menuActions;

const ACCOUNT = zeropsAccountDisplay({
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  firstName: "Ada",
});
const ORGANIZATION = { id: "org-acme", name: "Acme", membershipId: "m-acme" };

/**
 * One sidebar, as the app lays it out: its header, the listing, its foot —
 * one of it, as in the app. `?w=` sets its width; the owner runs it near
 * 435, the default is 256.
 */
/**
 * Where the window's own controls end: nothing on the web, where the logo
 * row's mark stands 16 px in; `?inset=` px beside a desktop's traffic lights.
 */
const CONTROLS = new URLSearchParams(location.search).get("inset");

/**
 * `?reload=1500`: a reload, as the app's menu goes through it (`useMenuRows.tsx`) — HQ's
 * structure and the listing being read for that many ms, then answered; until then no row. Each
 * row's top at the first frame and once HQ answered are on `window.__menuReload`, for the audit
 * browser.
 */
const RELOAD_MS = (() => {
  const reload = new URLSearchParams(location.search).get("reload");
  return reload === null ? null : Number(reload);
})();

type ReloadFrame = ReadonlyArray<{ readonly row: string; readonly top: number }>;
const menuReload: {
  first?: ReloadFrame;
  landed?: ReloadFrame;
  frames?: ReadonlyArray<{ readonly ms: number; readonly tops: ReloadFrame }>;
} = {};
(window as unknown as { __menuReload?: typeof menuReload }).__menuReload = menuReload;

const rowTops = (): ReloadFrame =>
  [...document.querySelectorAll<HTMLElement>("[data-zerops-mate-row], [data-zerops-group]")].map(
    (element) => ({
      row:
        element.getAttribute("data-zerops-mate-row") ??
        `group:${element.getAttribute("data-zerops-group") ?? ""}`,
      top: Math.round(element.getBoundingClientRect().top * 10) / 10,
    }),
  );

/** The organization's structure as its HQ answers it: each fixture project where it places it. */
function structureOf(candidates: ReadonlyArray<ZeropsCandidate>): HqStructure {
  const apps = new Map<string, HqStructure["apps"][number]["projects"][number][]>();
  const names = new Map<string, string>();
  const ungrouped: Array<HqStructure["ungrouped"][number]> = [];
  for (const { project } of candidates) {
    const { hq } = project;
    if (hq === undefined) continue;
    if (hq.appId === null) {
      ungrouped.push({ projectId: project.id, name: project.name, mate: hq.mate });
      continue;
    }
    names.set(hq.appId, hq.appName);
    apps.set(hq.appId, [
      ...(apps.get(hq.appId) ?? []),
      { projectId: project.id, name: project.name, kind: hq.kind, mate: hq.mate },
    ]);
  }
  return {
    ungrouped,
    apps: [...apps].map(([id, projects]) => ({ id, name: names.get(id) ?? id, projects })),
  };
}

const NOTHING_GONE: ReadonlySet<string> = new Set();
const NO_READY_AGENTS: ReadonlyMap<string, boolean> = new Map();

/** The menu's rows as the app's menu reads them on a reload (`?reload=`): HQ's, enriched. */
function useReloadedRows(candidates: ReadonlyArray<ZeropsCandidate>) {
  const [landed, setLanded] = useState(RELOAD_MS === null);
  useEffect(() => {
    if (RELOAD_MS === null) return;
    const timer = setTimeout(() => setLanded(true), RELOAD_MS);
    return () => clearTimeout(timer);
  }, []);
  const answered = useMemo(() => structureOf(candidates), [candidates]);
  // The listing as read: each row's container known.
  const listed = useMemo(
    () => candidates.map((candidate) => ({ ...candidate, presence: "known" as const })),
    [candidates],
  );
  const menu = useMemo(
    () => ({
      rows: landed
        ? placedMenuRows({
            organizationId: ORGANIZATION.id,
            // Each Mate's logins as its fixture's overview names them, as HQ's would.
            placements: placementsOf(
              answered,
              new Map(
                listed.flatMap((row) => {
                  const logins = row.project.hq?.mate?.logins;
                  return logins === undefined ? [] : [[row.project.id, logins] as const];
                }),
              ),
              NO_READY_AGENTS,
            ),
            names: placedNames(answered),
            projects: [],
            candidates: listed,
            gone: NOTHING_GONE,
          })
        : [],
      complete: landed,
    }),
    [answered, landed, listed],
  );
  useLayoutEffect(() => {
    if (RELOAD_MS === null) return;
    if (menuReload.first === undefined) {
      menuReload.first = rowTops();
      // Each frame's tops for the first second: what moved, and when.
      const start = performance.now();
      const frames: Array<{ readonly ms: number; readonly tops: ReloadFrame }> = [];
      menuReload.frames = frames;
      const sample = () => {
        frames.push({ ms: Math.round(performance.now() - start), tops: rowTops() });
        if (performance.now() - start < 1000) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }
    if (landed) menuReload.landed = rowTops();
  }, [landed]);
  return menu;
}

function SidebarFrame({
  width,
  onJump,
  open,
  setOpen,
}: {
  readonly width: number;
  readonly onJump: () => void;
  /** The Mate whose conversation is open: a row pressed opens it, as in the app. */
  readonly open: string;
  readonly setOpen: (projectId: string) => void;
}) {
  // Mine / Everyone, from the account menu, as the app reads it.
  const [scope] = useMateScope();
  // `?set=coming`: Quinn's phase, moved on from a script.
  const [phase, setPhase] = useState<ComingPhase>(COMING_PHASE);
  useEffect(() => {
    if (!COMING_SET) return;
    (window as unknown as { __comingMenu?: unknown }).__comingMenu = {
      go: (next: ComingPhase) => setPhase(next),
      phases: COMING_PHASES,
    };
  }, []);
  const coming = COMING_SET ? comingMenu(phase) : null;
  const candidates = coming?.candidates ?? FIXTURES.candidates;
  const reloaded = useReloadedRows(candidates);
  const shown = useCallback(
    (item: ZeropsCandidate) =>
      shownInScope(scope, FIXTURES.owners.get(item.project.id)?.isViewer, item.project.id === open),
    [open, scope],
  );
  const waiting = useSidebarWaiting({
    candidates: FIXTURES.candidates,
    activityOf: activityOfCandidate,
    shown,
    activeProjectId: open,
    enabled: true,
  });
  return (
    <aside
      className="flex h-screen shrink-0 flex-col border-e border-border bg-sidebar text-sidebar-foreground"
      data-sidebar="sidebar"
      style={
        CONTROLS === null
          ? { width }
          : ({ width, "--workspace-controls-left": `${CONTROLS}px` } as CSSProperties)
      }
    >
      {/* The app's own logo row: the mark 16 px in on the web, or `?inset=90`
          beside macOS's traffic lights; the waiting faces and ⌘K at its end. */}
      <SidebarChromeHeader
        isElectron={false}
        jump={<SidebarJumpButton onJump={onJump} shortcut={JUMP_KEY} />}
        waiting={<SidebarWaitingStack mates={waiting.mates} onNext={waiting.next} />}
      />
      {/* The list scrolls as the app's does (`SidebarContent`): fading into
          the canvas at an edge only while something is scrolled under it. */}
      <SidebarContent>
        <div className="ps-2.25 pe-2 pb-1">
          <SidebarZeropsTree
            births={coming?.births}
            candidates={RELOAD_MS === null ? candidates : reloaded.rows}
            className="mb-2"
            complete={RELOAD_MS === null || reloaded.complete}
            getActivity={coming?.activity ?? activityOfCandidate}
            getConversationsRead={(item) => item.group === "connected"}
            getComing={coming?.coming}
            onOpenComing={(projectId) => {
              menuActions.push(`coming ${projectId}`);
              setOpen(projectId);
            }}
            getFlow={(groupId) => FIXTURES.flows.get(groupId)}
            getOwner={(item) => FIXTURES.owners.get(item.project.id)}
            getCrew={(item) => CREWS.get(item.project.id)}
            getMateActions={(item, live) => ({
              muted: item.project.id === "notes-iris",
              toggleMute: () => {},
              toggleUnread: () => {},
              copyLink: () => {},
              rename: {
                initialValue: item.project.name,
                validate: (value) => (value.trim() === "" ? "Give the Mate a name." : undefined),
                commit: () => {},
              },
              ...(live?.face === "working" ? { stop: () => {} } : {}),
              entries: [
                { id: "restart", label: "Restart", onSelect: () => {} },
                { id: "assign", label: "Hand over…", onSelect: () => {} },
                { id: "move", label: "Move to project…", onSelect: () => {} },
              ],
            })}
            onBrowseProjects={() => {}}
            onAskToFix={(mateProjectId, problem) => {
              menuActions.push(`ask ${mateProjectId}: ${problem.what}`);
            }}
            onSelect={(item) => {
              menuActions.push(`open ${item.project.id}`);
              setOpen(item.project.id);
            }}
            onOpenCrew={(item, setUp) => {
              menuActions.push(`${setUp ? "set up a crew" : "crew"} ${item.project.id}`);
              setOpen(item.project.id);
            }}
            activeProjectId={open}
            shown={shown}
            timestampFormat="24-hour"
          />
        </div>
      </SidebarContent>
      {/* *New project* pinned above the account's row, as the app's
          (`Sidebar.tsx`): the list scrolls under it. */}
      {newProjectOffered({ candidates: FIXTURES.candidates, births: [], complete: true }) ? (
        <SidebarNewProject
          onNewProject={() => {
            menuActions.push("new project");
          }}
        />
      ) : null}
      {FOOT_LINE === null ? null : (
        <SidebarAccountLine
          sentence={FOOT_LINE.sentence}
          actions={FOOT_LINE.actions.map((label) => ({
            label,
            run: () => menuActions.push(label),
          }))}
        />
      )}
      <footer className="flex shrink-0 items-center gap-1 p-2">
        <div className="min-w-0 flex-1">
          <SidebarZeropsAccount
            account={ACCOUNT}
            activeOrganization={ORGANIZATION}
            destination={null}
            destinationIcon={() => null}
            onGo={() => {}}
            onSelectOrganization={() => {}}
            onSignOut={() => {}}
            organizations={[ORGANIZATION]}
          />
        </div>
      </footer>
    </aside>
  );
}

const JUMP_KEY = isMacPlatform(navigator.platform) ? "⌘K" : "Ctrl+K";

/**
 * Who may write to whom, as the conversation's rule (D6) would read it here:
 * Vera's agent is Petra's own login, so only Petra writes to Vera, and `@`
 * never offers her; Theo's is the project's token, so anyone may.
 */
const READ_ONLY_MATES: ReadonlySet<string> = new Set(["todo-vera"]);

/**
 * The server's search of the conversations, as the harness has them: the
 * last words and the task of each Mate, and one message further back.
 */
function harnessHits(text: string): ReadonlyArray<JumpHit> {
  if (text.length < 2) return [];
  const needle = text.toLocaleLowerCase();
  const history = [
    ["shop-mira", "Keep the saved basket across a reload, even when signed out"],
    ["links-theo", "Is the previews table still read by the export job?"],
  ] as const;
  return [
    ...[...FIXTURES.activity.entries()].flatMap(([projectId, entry]) =>
      [entry.snippet, entry.task]
        .filter((said): said is string => said !== undefined)
        .map((said) => [projectId, said] as const),
    ),
    ...history,
  ]
    .filter(([, said]) => said.toLocaleLowerCase().includes(needle))
    .map(([projectId, said]) => ({
      environmentId: `env-${projectId}`,
      threadId: String(FIXTURES.activity.get(projectId)?.threadId ?? `thread-${projectId}`),
      source: "user" as const,
      snippet: said,
    }));
}

/** What the harness's jump box did, for the audit browser to read. */
const jumpActions: string[] = [];
(window as unknown as { __jumpActions?: string[] }).__jumpActions = jumpActions;

/** The jump box over the harness's menu: its index, fixture hits, and a send that is recorded. */
function HarnessJumpBox({
  index,
  onClose,
}: {
  readonly index: SidebarJumpIndex;
  readonly onClose: () => void;
}) {
  const showable = useSidebarJump((store) => store.showable);
  const state = useJumpBoxState();
  const searchText = jumpSearchText(state);
  const hits = useMemo(() => harnessHits(searchText), [searchText]);
  const model = useJumpBoxModel(state, index, hits, READ_ONLY_MATES);
  const { target } = model;
  const plan =
    target?.conversation === undefined
      ? undefined
      : jumpWritePlan({
          name: target.name,
          owner: target.owner,
          conversation: target.conversation,
          pausedUntilLabel:
            target.pausedUntil === undefined
              ? undefined
              : formatShortTimestamp(target.pausedUntil, "24-hour"),
          started: true,
          readOnly: READ_ONLY_MATES.has(target.projectId),
          decision: DECISIONS.get(target.projectId),
        });
  const enter: Record<string, string | undefined> = {
    send: "Send without opening",
    answer: "Answer",
    "open-and-send": "Open and send",
    open: "Open",
    wait: "Send without opening",
    none: undefined,
  };
  const pages = {
    openMate: (mate: { readonly name: string }) => {
      jumpActions.push(`open ${mate.name}`);
    },
    openProject: (groupId: string) => {
      jumpActions.push(`page ${groupId}`);
    },
    openStop: (stop: { readonly projectId: string }) => {
      jumpActions.push(`page ${stop.projectId}`);
    },
    openChange: (change: { readonly key: string }) => {
      jumpActions.push(`page ${change.key}`);
    },
    newProject: () => {
      jumpActions.push("new project");
    },
  };
  return (
    <JumpBoxView
      model={model}
      onChoose={(item) => {
        jumpActions.push(`choose ${item.value}`);
        chooseJumpItem(item, { model, showable, close: onClose, pages });
      }}
      onCommands={(value) => {
        jumpActions.push(`commands ${value}`);
      }}
      onSend={(text) => {
        if (target === undefined || plan === undefined || plan.action === "none") return;
        if (text.trim().length === 0) return;
        jumpActions.push(`${plan.action} ${target.name}: ${text.trim()}`);
        onClose();
      }}
      searching={false}
      write={
        plan === undefined
          ? undefined
          : { hint: plan.hint, enter: enter[plan.action], error: undefined, sending: false }
      }
    />
  );
}

/**
 * `?menu=closed`: the menu folded away and its mark in the window's corner,
 * as the app draws them (`SidebarCornerMark`), the header taking the room.
 */
const MENU_CLOSED = new URLSearchParams(location.search).get("menu") === "closed";
/** `?crew=1`: the open Mate's line carries a crew of three, as a Mate with a crew's does. */
const LINE_CREW = new URLSearchParams(location.search).get("crew") === "1";

const TINTS = assignCandidateMateTints(FIXTURES.candidates);

const HARNESS_CREW: ReadonlyArray<LineCrewmate> = (
  [
    ["lead", "Lead", "violet"],
    ["world", "World Server", "sky"],
    ["rules", "Game Rules", "rose"],
  ] as const
).map(([handle, name, tint]) => ({
  handle,
  name,
  tint,
  face: handle === "rules" ? "working" : "idle",
  lead: handle === "lead",
  open: false,
  known: true,
  threadId: ThreadId.make(`thread-crew-${handle}`),
  role: handle === "lead" ? ", its lead" : ", one of its crew",
  job: null,
  status: null,
}));

/**
 * The open Mate's conversation, as far as its top bar: the app's own header
 * row (`WorkspacePageHeader`) holding the conversation's line
 * (`ConversationStripView`: the Mate's face, name and subject, or its crew),
 * its actions and the panel toggles, in `ChatHeader`'s and `ChatView`'s
 * classes — beside the menu's logo row, so the two top rows read as one line.
 */
function ConversationPane({ open }: { readonly open: string }) {
  const candidate = FIXTURES.candidates.find((item) => item.project.id === open);
  const activity = FIXTURES.activity.get(open);
  const tint = TINTS.get(open) ?? "slate";
  const name = candidate?.project.name ?? open;
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <WorkspacePageHeader className="relative bg-background" data-chat-header>
        <div
          className="absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1"
          data-workspace-titlebar-controls
        >
          <PanelLayoutControls
            liveAgentCount={0}
            onToggleRightPanel={() => {}}
            onToggleTerminal={() => {}}
            rightPanelAvailable
            rightPanelOpen={false}
            rightPanelShortcutLabel={null}
            terminalAvailable
            terminalOpen={false}
            terminalShortcutLabel={null}
          />
        </div>
        <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <ConversationStripView
            chats={null}
            crew={LINE_CREW ? HARNESS_CREW : null}
            mate={{
              name,
              tint,
              shape: mateShapeOf(candidate?.project, tint),
              face: activity?.face ?? "idle",
              open: true,
              threadId: activity?.threadId ?? null,
              tooltip: activity?.subject ?? null,
            }}
            onCloseChat={() => {}}
            onOpen={() => {}}
            onRename={null}
            renameField={null}
            renderCrewmateMenu={() => null}
          />
          <span className="flex size-4 shrink-0 items-center justify-center" />
          <div className="flex shrink-0 items-center justify-end gap-1 pr-18.25 sm:pr-14.25">
            <Button
              aria-label="More header actions"
              data-chat-header-ghost
              size="icon-sm"
              variant="ghost-muted"
            >
              <EllipsisIcon className="size-4" />
            </Button>
            <Button data-chat-header-ghost size="sm" variant="ghost-muted">
              <ZeropsMark className="size-3.5 shrink-0" />
              <span className="hidden text-line @3xl/header-actions:inline">Open in Zerops</span>
            </Button>
          </div>
        </div>
      </WorkspacePageHeader>
      <div className="flex justify-center p-10">
        <p className="max-w-md text-sm text-muted-foreground">The conversation opens here.</p>
      </div>
    </main>
  );
}

function Harness() {
  const params = new URLSearchParams(location.search);
  const width = Number(params.get("w") ?? 256);
  const phone = window.matchMedia("(max-width: 767px)").matches;
  // The Mate whose conversation is open: a row pressed opens it, as in the
  // app, and the selected band slides to it.
  const [open, setOpen] = useState(FIXTURES.active);
  const [jumping, setJumping] = useState(false);
  const index = useSidebarJump((store) => store.index);
  // ⌘K, "/" and the menu's own row open the box, as in the app.
  useEffect(() => {
    const stop = onOpenCommandPalette(() => {
      setJumping(true);
    });
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setJumping((open) => !open);
        return;
      }
      if (slashKeyOpensJumpBox(event)) {
        event.preventDefault();
        setJumping(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="flex min-h-screen bg-background">
      <CommandDialog onOpenChange={setJumping} open={jumping}>
        {index === null ? null : (
          <CommandDialogPopup
            aria-label="Jump to"
            data-command-palette="true"
            onBackdropPointerDown={() => {
              setJumping(false);
            }}
          >
            <HarnessJumpBox
              index={index}
              onClose={() => {
                setJumping(false);
              }}
            />
          </CommandDialogPopup>
        )}
      </CommandDialog>
      {MENU_CLOSED && !phone ? (
        <SidebarCornerMark />
      ) : (
        <SidebarFrame
          onJump={() => {
            setJumping(true);
          }}
          open={open}
          setOpen={setOpen}
          width={phone ? window.innerWidth : width}
        />
      )}
      {phone ? null : <ConversationPane open={open} />}
    </div>
  );
}

// The app sets the theme on the document element (`themePalette.ts`), so the
// harness does the same rather than nesting a `.dark` wrapper the tokens never
// reach — which is exactly how the first pass produced two identical light panels.
document.documentElement.classList.toggle(
  "dark",
  new URLSearchParams(location.search).get("theme") === "dark",
);
// The app's own palette with `?palette=zerops`, so a capture reads in the
// colours the app paints — the base tokens are not the owner's menu.
if (new URLSearchParams(location.search).get("palette") === "zerops") {
  applyThemePalette(
    ZEROPS_THEME_ID,
    new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light",
  );
}

// An account is open, as in the app: the order and the mutes are kept under
// its key. A draft stands in Iris's composer, as the composer would keep it,
// and one in Rhea's new conversation, nothing sent yet.
openAccountLifetime("design-harness");
const params = new URLSearchParams(location.search);
// The fixture set's folded projects, as a person left them — or `?fold=all`,
// every heading folded into a short list of names, as the owner's menu
// stands; `?fold=a,b` folds those groups.
const fold = params.get("fold");
writeCollapsedProjects(
  new Set(
    fold === null
      ? FIXTURES.collapsed
      : fold === "all"
        ? FIXTURES.candidates.flatMap((item) => readZeropsMembership(item.project).groupId ?? [])
        : fold.split(","),
  ),
);
/** `?set=ladder`: every state of a heading's second line (D′), open and folded (`headingLadder.tsx`). */
const LADDER = params.get("set") === "ladder";
const order = params.get("order");
if (order === "custom" || order === "name" || order === "newest") {
  setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, order, ProjectOrderSchema);
}
useComposerDraftStore
  .getState()
  .setPrompt(
    scopeThreadRef(EnvironmentId.make("env-notes-iris"), ThreadId.make("thread-notes-iris")),
    "also count the title",
  );
{
  const rhea = DraftId.make("draft-notes-rhea");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(
      scopeProjectRef(EnvironmentId.make("env-notes-rhea"), ProjectId.make("project-notes-rhea")),
      rhea,
      { threadId: ThreadId.make("thread-notes-rhea") },
    );
  useComposerDraftStore.getState().setPrompt(rhea, "set up a staging for the notes app");
}

// The menu is always on screen here: a find is shown in it, as on a desktop.
useSidebarJump.getState().setShowable(true);

// The logo row's mark is a link home, so the harness stands in a router of
// its own — one page, in memory — and in the sidebar's provider, as the app's
// menu does.
const router = createRouter({
  routeTree: createRootRoute({
    component: () => (
      // The viewer is the whole menu's, as in the app: the waiting stack in the header reads
      // whose Mates wait on them too.
      <ZeropsSessionContext.Provider value={COMING_VIEWER}>
        <SidebarProvider className="block" defaultOpen={!MENU_CLOSED}>
          {LADDER ? <HeadingLadder width={Number(params.get("w") ?? 256)} /> : <Harness />}
        </SidebarProvider>
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
