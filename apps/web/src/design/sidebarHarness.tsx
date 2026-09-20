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
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  deployedVersion,
  type EnvironmentRow,
  type FlowPullRequest,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { ThreadId } from "@t3tools/contracts";

import { SidebarZeropsTree, type SidebarProjectFlow } from "~/components/zerops/SidebarZeropsTree";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";

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
  readonly subject?: string;
  readonly snippet?: string;
  readonly hours: number;
  readonly face: ZeropsAgentActivity["face"];
}): ZeropsAgentActivity {
  return {
    threadId: ThreadId.make("thread"),
    kind: "idle",
    status: null,
    face: input.face,
    subject: input.subject,
    snippet: input.snippet,
    at: hoursAgo(input.hours),
  };
}

const group = (id: string, name: string) => [`mate:g:${id}`, `mate:name:${name}`];

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
      subject: "Add a search box above the list that filters the saved links",
      snippet: "Done. The search box is live on both services. What changes…",
      hours: 11,
      face: "working",
    }),
  ],
  ["links-theo", activity({ subject: "/compact", hours: 9, face: "idle" })],
  [
    "shop-mira",
    activity({
      subject: "Split the checkout into a two-step flow with a saved basket",
      snippet: "The basket survives a reload now. Six branches are open…",
      hours: 1,
      face: "working",
    }),
  ],
  [
    "shop-otto",
    activity({
      subject: "Why does the VAT come out wrong for Irish orders?",
      snippet: "Because the rate table is keyed by country and Ireland has…",
      hours: 30,
      face: "idle",
    }),
  ],
  [
    "notes-iris",
    activity({
      subject: "Show a live character count under the body field of the note form",
      snippet: 'Healthy, and the rendered body confirms "0 characters"…',
      hours: 20,
      face: "idle",
    }),
  ],
  [
    "todo-vera",
    activity({ subject: "Reply with just: done", snippet: "done", hours: 14, face: "idle" }),
  ],
  [
    "todo-fen",
    activity({
      subject: "Rename the app in the page title and the main heading",
      snippet: "Done. Both the browser tab title and the <h1> now read…",
      hours: 20,
      face: "idle",
    }),
  ],
  [
    "tokens-ada",
    activity({
      subject: "Pull the spacing scale out of the components into one file",
      snippet: "There were four scales. They are one now, and nothing moved…",
      hours: 52,
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
    mergeable: true,
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
  pull({ mergeable: false, checks: "passing", checkWord: "Passing", ...input });

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
          mergeable: false,
          merged: false,
  mergedAt: undefined,
        }),
        pull({
          number: 5,
          title: "Cache the link previews",
          mateProjectId: "links-theo",
          checks: "failing",
          checkWord: "Failing",
          mergeable: false,
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
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
      // Without this the menu draws no *Ask* at all, so the harness never
      // showed the verb a blocked change wears — which is how it came to wear
      // the same amber as *Release* unnoticed.
      onAsk: () => {},
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
          mergeable: false,
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
          mergeable: false,
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
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
      // Without this the menu draws no *Ask* at all, so the harness never
      // showed the verb a blocked change wears — which is how it came to wear
      // the same amber as *Release* unnoticed.
      onAsk: () => {},
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
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
      // Without this the menu draws no *Ask* at all, so the harness never
      // showed the verb a blocked change wears — which is how it came to wear
      // the same amber as *Release* unnoticed.
      onAsk: () => {},
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
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
      // Without this the menu draws no *Ask* at all, so the harness never
      // showed the verb a blocked change wears — which is how it came to wear
      // the same amber as *Release* unnoticed.
      onAsk: () => {},
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
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
      // Without this the menu draws no *Ask* at all, so the harness never
      // showed the verb a blocked change wears — which is how it came to wear
      // the same amber as *Release* unnoticed.
      onAsk: () => {},
    },
  ],
]);

/**
 * One sidebar at one width. The panel is resizable (`SIDEBAR_WIDTH` is the
 * 256px default, and the owner runs it near 368), so every width in that range
 * is a width this has to read at — the narrow one is where truncation bites.
 */
function Panel({ label, width }: { readonly label: string; readonly width: number }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <div
        className="h-[1600px] overflow-y-auto border border-border bg-sidebar py-2"
        style={{ width }}
      >
        <SidebarZeropsTree
          candidates={CANDIDATES}
          className="px-1"
          getActivity={(item) => ACTIVITY.get(item.project.id)}
          getFlow={(groupId) => FLOWS.get(groupId)}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          activeProjectId="links-enzo"
        />
      </div>
    </div>
  );
}

function Harness() {
  return (
    <div className="flex min-h-screen items-start gap-8 bg-background p-6">
      {[256, 320, 368].map((width) => (
        <Panel key={width} label={`${width}px`} width={width} />
      ))}
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

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
