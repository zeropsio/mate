/**
 * The sidebar, in every state it has, at the width it really gets — the thing
 * a string assertion cannot show you.
 *
 * Served by the dev server at `/design.html`. It renders the real components
 * with made-up data and no session, so there is no door to get through and
 * nothing live to disturb; both themes stand side by side because a sidebar
 * that reads well in one and badly in the other is a sidebar nobody checked.
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
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  deployedVersion,
  type EnvironmentRow,
  type FlowPullRequest,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import { onOpenCommandPalette } from "~/commandPaletteBus";
import { MateLockup } from "~/components/MateLockup";
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
import { SidebarZeropsTree, type SidebarProjectFlow } from "~/components/zerops/SidebarZeropsTree";
import { useComposerDraftStore } from "~/composerDraftStore";
import { setLocalStorageItem } from "~/hooks/useLocalStorage";
import { openAccountLifetime } from "~/zerops/accountLifetime";
import { shownInScope, useMateScope } from "~/zerops/mateScope";
import { isMacPlatform } from "~/lib/utils";
import { formatShortTimestamp } from "~/timestampFormat";
import { slashKeyOpensJumpBox } from "~/zerops/jumpSlash";
import { useSidebarJump } from "~/zerops/sidebarJump";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema } from "~/zerops/projectOrderPreference";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";

import "../index.css";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/** A full sha, the only thing `deployedCommit` accepts. */
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

function candidate(
  id: string,
  name: string,
  tags: ReadonlyArray<string>,
  options: {
    readonly connected?: boolean;
    readonly container?: boolean;
    readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  } = {},
): ZeropsCandidate {
  const { connected = true, container = true, routes: theRoutes } = options;
  const base = {
    key: `${id}:zcp`,
    project: { id, name, status: "ACTIVE", tagList: tags },
    group: connected ? ("connected" as const) : ("ready" as const),
    // Where its conversation lives: what the jump box searches.
    ...(connected && container ? { environmentId: EnvironmentId.make(`env-${id}`) } : {}),
  };
  const withRoutes = theRoutes === undefined ? base : { ...base, routes: theRoutes };
  return container
    ? { ...withRoutes, service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
    : {
        ...withRoutes,
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
  readonly progress?: ZeropsAgentActivity["progress"];
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
    progress: input.progress,
    unread: input.unread ?? false,
    pausedUntil: input.pausedUntil,
    threadKey: `env-${id}:thread-${id}`,
    task: input.task ?? input.subject,
  };
}

const group = (id: string, name: string) => [`mate:g:${id}`, `mate:name:${name}`];

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
  candidate("links-enzo", "Links - enzo", ["mate", ...LINKS, "mate:role:dev", "mate:bot:Enzo"]),
  candidate("links-theo", "Links - theo", ["mate", ...LINKS, "mate:role:dev", "mate:bot:Theo"]),
  candidate("links-wren", "Links - wren", ["mate", ...LINKS, "mate:role:dev", "mate:bot:Wren"]),
  candidate("links-stage", "Links - stage", [...LINKS, "mate:role:stage"], {
    container: false,
    routes: routes(["app", "links-stage.zerops.app"]),
  }),
  candidate("links-prod", "Links - production", [...LINKS, "mate:role:prod"], {
    container: false,
    routes: routes(["app", "links.example.com"]),
  }),

  // The hostile one: a Mate buried in pull requests, a production ten routes
  // wide and twelve changes behind, a stage mid-deploy.
  candidate("shop-mira", "Shop - mira", ["mate", ...SHOP, "mate:role:dev", "mate:bot:Mira"]),
  candidate("shop-otto", "Shop - otto", ["mate", ...SHOP, "mate:role:dev", "mate:bot:Otto"]),
  candidate("shop-stage", "Shop - stage", [...SHOP, "mate:role:stage"], {
    container: false,
    routes: routes(["app", "shop-stage.zerops.app"], ["api", "api-shop-stage.zerops.app"]),
  }),
  candidate("shop-prod", "Shop - production", [...SHOP, "mate:role:prod"], {
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
  candidate("notes-iris", "Notes - iris", ["mate", ...NOTES, "mate:role:dev", "mate:bot:Iris"]),
  candidate("notes-prod", "Notes - production", [...NOTES, "mate:role:prod"], {
    container: false,
    routes: routes(["app", "notes.example.com"], ["app", "www.notes.example.com"]),
  }),

  // The dead end: a production whose last deploy failed, running nothing.
  candidate("todo-vera", "Todo - vera", ["mate", ...TODO, "mate:role:dev", "mate:bot:Vera"]),
  candidate("todo-fen", "Todo - fen", ["mate", ...TODO, "mate:role:dev", "mate:bot:Fen"]),
  candidate("todo-stage", "Todo - stage", [...TODO, "mate:role:stage"], {
    container: false,
    routes: routes(["app", "todo-stage.zerops.app"]),
  }),
  candidate("todo-prod", "Todo - production", [...TODO, "mate:role:prod"], { container: false }),

  // A name longer than any width here, and a project that is only a Mate:
  // nothing has been set up for it to travel to yet.
  candidate("tokens-ada", "Design system tokens and primitives - ada", [
    "mate",
    ...LONG,
    "mate:role:dev",
    "mate:bot:Ada",
  ]),
];

const ACTIVITY = new Map<string, ZeropsAgentActivity>([
  [
    "links-enzo",
    activity({
      id: "links-enzo",
      task: "Add a search box above the list that filters the saved links",
      subject: "Run the build",
      snippet: "The search box filters as you type. Running the build now.",
      hours: 0.053,
      face: "working",
      kind: "working",
      progress: { completed: 2, total: 5 },
    }),
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
      snippet: "I hit the usage limit. I pick up again when it resets.",
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
    activity({
      id: "todo-vera",
      subject: "Move finished items out of the way",
      snippet: "Should finished items sink to the bottom, or hide behind a toggle?",
      hours: 0.2,
      face: "needs",
      kind: "input",
    }),
  ],
  [
    "todo-fen",
    activity({
      id: "todo-fen",
      subject: "Rename the app in the page title and the main heading",
      snippet: "The deploy to stage failed: the build timed out after 120 s.",
      hours: 0.3,
      face: "needs",
      kind: "failed",
    }),
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

function pull(input: Partial<FlowPullRequest> & { number: number }): FlowPullRequest {
  return {
    repository: "appdev",
    title: "Change",
    kind: "code",
    mateProjectId: undefined,
    author: undefined,
    url: "https://gitea.example/links/appdev/pulls/1",
    checks: "passing",
    checkWord: "Passing",
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    headSha: "3f9c1b2",
    baseBranch: "main",
    line: `appdev #${input.number}`,
    updatedAt: hoursAgo(2),
    ...input,
  };
}

/** A pull request whose branch has fallen behind `main` — Gitea refuses it. */
const behindPull = (input: Partial<FlowPullRequest> & { number: number }) =>
  pull({ mergeability: "conflicting", checks: "passing", checkWord: "Passing", ...input });

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
    ...rest,
  };
}

/** A made-up Gitea, so the version reads as the link it is in the product. */
/** What a release would put live, as `releaseContents` carries it. */
const changes = (...subjects: ReadonlyArray<string>) => [
  { commits: subjects.map((subject, index) => ({ sha: `c${index}`, subject })) },
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
          checks: "pending",
          checkWord: "Checking",
          mergeability: "conflicting",
          merged: false,
          mergedAt: undefined,
        }),
        pull({
          number: 5,
          title: "Cache the link previews",
          mateProjectId: "links-theo",
          checks: "failing",
          checkWord: "Failing",
          mergeability: "conflicting",
          merged: false,
          mergedAt: undefined,
        }),
        pull({ number: 6, title: "Bump the linter", author: "ada", mateProjectId: undefined }),
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
      releasing: false,
      onRelease: () => {},
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
          checks: "pending",
          checkWord: "Checking",
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
          checks: "failing",
          checkWord: "Failing",
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
          author: "ales",
          mateProjectId: undefined,
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
      releasing: false,
      onRelease: () => {},
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
      missing: [
        { kind: "missing-environment", tier: "stage", name: "Stage", line: "not set up yet" },
      ],
      releasing: false,
      onRelease: () => {},
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
      releasing: false,
      onRelease: () => {},
    },
  ],
  [
    "design-tokens",
    {
      pullRequests: [],
      environments: new Map(),
      releaseOffered: false,
      missing: [
        { kind: "missing-environment", tier: "stage", name: "Stage", line: "not set up yet" },
        {
          kind: "missing-environment",
          tier: "production",
          name: "Production",
          line: "not set up yet",
        },
      ],
      releasing: false,
      onRelease: () => {},
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
 */
const OWNERS = new Map<string, ZeropsMateOwner>([
  ["links-enzo", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: true }],
  ["links-theo", { name: "Jan Beneš", initials: "JB", avatarUrl: null, isViewer: false }],
  ["shop-mira", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: false }],
  ["notes-iris", { name: "Eva Dvořák", initials: "ED", avatarUrl: null, isViewer: false }],
  ["todo-vera", { name: "Petra Malá", initials: "PM", avatarUrl: PORTRAIT, isViewer: false }],
]);

const activityOfCandidate = (item: ZeropsCandidate) => ACTIVITY.get(item.project.id);

/**
 * A crew of four under a Mate — the lead first — built from the crew's own
 * fixture, named and tinted as the plan's menu draws them: each crewmate's
 * thread in the state given, and the board with its ready tasks.
 */
function harnessCrew(input: {
  readonly states: Readonly<Record<string, ThreadStatusKind>>;
  readonly ready: ReadonlyArray<string>;
}): SidebarCrewRead {
  const fixture = crewSnapshotFixture();
  const names: Readonly<Record<string, readonly [string, MateTintId]>> = {
    lead: ["Ada", "violet"],
    backend: ["Bo", "sky"],
    frontend: ["Cy", "coral"],
    erik: ["Dee", "rose"],
  };
  const snapshot: CrewSnapshot = {
    ...fixture,
    crewmates: fixture.crewmates.map((mate) => {
      const [displayName, tint] = names[mate.handle] ?? [mate.displayName, mate.tint];
      return { ...mate, displayName, tint };
    }),
    board: {
      tasks: fixture.board.tasks.map((task) =>
        input.ready.includes(task.id) ? { ...task, state: "ready" as const } : task,
      ),
    },
    attention: [],
  };
  const shells: ReadonlyArray<CrewShellInput> = snapshot.crewmates.flatMap((mate) =>
    mate.currentThreadId === null ? [] : [{ id: mate.currentThreadId, archivedAt: null }],
  );
  const view = deriveCrewView(snapshot, shells, (shell) => {
    const handle = snapshot.crewmates.find((mate) => mate.currentThreadId === shell.id)?.handle;
    const kind = (handle === undefined ? undefined : input.states[handle]) ?? "idle";
    return {
      status: { kind, toneId: "neutral" },
      word: kind === "idle" ? null : kind,
      working: kind === "working",
    };
  });
  return { status: "applied", view, attention: snapshot.attention };
}

/** Fen's crew as the plan draws it; Otto's with a crewmate waiting on you. */
const CREWS = new Map<string, SidebarCrewRead>([
  ["todo-fen", harnessCrew({ states: { backend: "working", erik: "done" }, ready: ["task-13"] })],
  ["shop-otto", harnessCrew({ states: { backend: "input", frontend: "working" }, ready: [] })],
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
function SidebarFrame({ width, onJump }: { readonly width: number; readonly onJump: () => void }) {
  // Mine / Everyone, from the account menu, as the app reads it.
  const [scope] = useMateScope();
  const shown = useCallback(
    (item: ZeropsCandidate) =>
      shownInScope(scope, OWNERS.get(item.project.id), item.project.id === "links-enzo"),
    [scope],
  );
  const waiting = useSidebarWaiting({
    candidates: CANDIDATES,
    activityOf: activityOfCandidate,
    shown,
    activeProjectId: "links-enzo",
    enabled: true,
  });
  return (
    <aside
      className="flex h-screen shrink-0 flex-col border-e border-border bg-sidebar text-sidebar-foreground"
      data-sidebar="sidebar"
      style={{ width }}
    >
      <header className="flex h-13 shrink-0 items-center gap-2 ps-4">
        <MateLockup className="h-5.5 w-auto" decorative />
        <div className="ms-auto flex shrink-0 items-center gap-2 pe-3">
          <div className="flex w-24 shrink-0 items-center justify-end">
            <SidebarWaitingStack mates={waiting.mates} onNext={waiting.next} />
          </div>
          <SidebarJumpButton onJump={onJump} shortcut={JUMP_KEY} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto ps-2.25 pe-2 pb-1">
        <SidebarZeropsTree
          candidates={CANDIDATES}
          className="mb-2"
          complete
          getActivity={activityOfCandidate}
          getFlow={(groupId) => FLOWS.get(groupId)}
          getOwner={(item) => OWNERS.get(item.project.id)}
          getCrew={(item) => CREWS.get(item.project.id)}
          getMateActions={(item, live) => ({
            muted: item.project.id === "notes-iris",
            toggleMute: () => {},
            toggleUnread: () => {},
            copyLink: () => {},
            rename: {
              initialValue:
                item.project.tagList
                  ?.find((tag) => tag.startsWith("mate:bot:"))
                  ?.slice("mate:bot:".length) ?? item.project.name,
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
          onNewProject={() => {
            menuActions.push("new project");
          }}
          onSelect={(item) => {
            menuActions.push(`open ${item.project.id}`);
          }}
          activeProjectId="links-enzo"
          shown={shown}
          timestampFormat="24-hour"
        />
      </div>
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
    ...[...ACTIVITY.entries()].flatMap(([projectId, entry]) =>
      [entry.snippet, entry.task]
        .filter((said): said is string => said !== undefined)
        .map((said) => [projectId, said] as const),
    ),
    ...history,
  ]
    .filter(([, said]) => said.toLocaleLowerCase().includes(needle))
    .map(([projectId, said]) => ({
      environmentId: `env-${projectId}`,
      threadId: String(ACTIVITY.get(projectId)?.threadId ?? `thread-${projectId}`),
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

function Harness() {
  const params = new URLSearchParams(location.search);
  const width = Number(params.get("w") ?? 256);
  const phone = window.matchMedia("(max-width: 767px)").matches;
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
      <SidebarFrame
        onJump={() => {
          setJumping(true);
        }}
        width={phone ? window.innerWidth : width}
      />
      {phone ? null : (
        <main className="flex min-w-0 flex-1 items-start justify-center p-10">
          <p className="max-w-md text-sm text-muted-foreground">The conversation opens here.</p>
        </main>
      )}
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

// An account is open, as in the app: the order and the mutes are kept under
// its key. A draft stands in Iris's composer, as the composer would keep it.
openAccountLifetime("design-harness");
const params = new URLSearchParams(location.search);
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

// The menu is always on screen here: a find is shown in it, as on a desktop.
useSidebarJump.getState().setShowable(true);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
