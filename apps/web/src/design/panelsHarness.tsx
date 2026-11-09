/**
 * A Mate's Zerops and Git panels, in the states they reach, at the panel's two common widths.
 *
 * Served by the dev server at `/design-panels.html` (`?theme=dark`, `?panel=git|zerops|both`,
 * `?w=420|540`). The panels take their reads as props (their surfaces hold the hooks), so this needs
 * no session: invented projects, Mates and services only.
 *
 * Fixtures only. Nothing here ships — `design-panels.html` is not `index.html`, and no route
 * imports this module.
 */
import {
  gitBlock,
  type FlowPullRequest,
  type GitCheckoutState,
} from "@t3tools/client-runtime/zerops";
import type {
  ZeropsServiceMapView,
  ZeropsServiceRow,
  ZeropsServiceTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { MateTintId } from "@t3tools/shared/brand";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "~/components/ui/button";
import type { RepoState } from "~/components/zerops/gitMirror.logic";
import type { MatePanelProject } from "~/components/zerops/MatePanelPlaces";
import { gitWorkRows } from "~/components/zerops/matePanels.logic";
import { MateFace } from "~/components/zerops/primitives";
import type { CardReady, PlaceLine } from "~/components/zerops/projects/projectCard.logic";
import { ZeropsGitPanel, type ZeropsGitRepository } from "~/components/zerops/ZeropsGitPanel";
import { ZeropsServiceMap } from "~/components/zerops/ZeropsServiceMap";
import type { AppRouter } from "~/router";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(window.location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const shownPanel = params.get("panel") ?? "both";
const widths = params.get("w") === null ? [420, 540] : [Number(params.get("w"))];
const only = params.get("s");

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

// ---------------------------------------------------------------- places

const production = (words: ReadonlyArray<string>): PlaceLine => ({
  kind: "production",
  name: "prod",
  projectId: "p-prod",
  dot: "running",
  words,
  trouble: false,
  addresses: [{ service: "app", url: "https://teashop.example" }],
});
const PRODUCTION = production(["Running", "v0.1.3", "since Nov 1"]);
const NO_PRODUCTION: PlaceLine = {
  kind: "production",
  name: "prod",
  projectId: undefined,
  dot: "none",
  words: ["Not added"],
  trouble: false,
  addresses: [],
  nothingDeployed: true,
};
const STAGE: PlaceLine = {
  kind: "stage",
  name: "stage",
  projectId: "p-stage",
  dot: "running",
  words: ["Running", "a41c9e2"],
  trouble: false,
  addresses: [{ service: "app", url: "https://app-stage.prg1.zerops.app" }],
};

const ready = (count: number): CardReady => ({
  count,
  changeCount: count,
  atLeast: false,
  stage: undefined,
  from: "v0.1.3",
  failed: false,
});

const project = (
  name: string,
  places: ReadonlyArray<PlaceLine>,
  waiting?: number,
): MatePanelProject => ({
  groupId: "g-tea",
  name,
  places,
  next:
    waiting === undefined
      ? null
      : {
          release: {
            offered: true,
            releasing: false,
            tag: "v0.1.4",
            reason: undefined,
            onReview: () => {},
          },
          ready: ready(waiting),
        },
  onOpenProject: () => {},
});

// ---------------------------------------------------------------- git

const checkout = (overrides: Partial<GitCheckoutState> = {}): GitCheckoutState => ({
  repository: "shopdev",
  read: true,
  isRepo: true,
  hasRemote: true,
  headRef: "mate/p-dana",
  aheadCount: 0,
  behindCount: 0,
  hasUpstream: true,
  changed: [],
  ...overrides,
});

const change = (overrides: Partial<FlowPullRequest> & { number: number; title: string }) =>
  ({
    repository: "shopdev",
    kind: "code",
    mateProjectId: "p-dana",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    state: "open",
    headSha: "c0ffee1",
    baseBranch: "main",
    line: `shopdev #${String(overrides.number)}`,
    updatedAt: ago(40),
    ...overrides,
  }) satisfies FlowPullRequest;

const STAGE_DECLARED = [{ name: "stage", tier: "stage" as const, sources: ["main"] }];

function repository(input: {
  readonly checkout: GitCheckoutState;
  readonly change?: FlowPullRequest | undefined;
  readonly landedWords?: string;
  readonly github?: RepoState | undefined;
}): ZeropsGitRepository {
  const block = gitBlock({
    checkout: input.checkout,
    changes: { read: true, change: input.change },
    declarations: STAGE_DECLARED,
    evidence: { remoteReachable: true },
    mateName: "Dana",
  });
  return {
    block,
    work: gitWorkRows(
      block,
      input.change === undefined
        ? undefined
        : { pull: input.change, landedWords: input.landedWords },
    ),
    github: input.github,
  };
}

const NOT_ON_GITHUB: RepoState = {
  destination: null,
  line: "Not on GitHub",
  tone: "quiet",
  fix: "connect",
};
const IN_SYNC: RepoState = {
  destination: { label: "acme/teashop", href: "https://github.com/acme/teashop" },
  line: "In sync · pushed 2h ago",
  tone: "ok",
  fix: null,
};
const STOPPED: RepoState = {
  destination: { label: "acme/teashop", href: "https://github.com/acme/teashop" },
  line: "Stopped Nov 7 · github.com refused the token",
  tone: "bad",
  fix: "replace-token",
};

// ---------------------------------------------------------------- services

const day = (base: number, limit: number) =>
  Array.from({ length: 24 }, (_, hour) => ({
    at: new Date(NOW - (24 - hour) * 3_600_000).toISOString(),
    used: limit * Math.max(0.02, base + 0.12 * Math.sin(hour / 2.4)),
    limit,
  }));

function serviceRow(
  hostname: string,
  type: string,
  input: {
    readonly port?: string;
    readonly tone?: ZeropsServiceTone;
    readonly status?: string;
    readonly route?: string;
    readonly controlPlane?: boolean;
    readonly use: readonly [cores: number, ram: number, ramOf: number, disk: number];
  },
): ZeropsServiceRow {
  const [cores, ram, ramOf, disk] = input.use;
  return {
    isControlPlane: input.controlPlane === true,
    kind: "service",
    service: {
      serviceId: `svc-${hostname}`,
      hostname,
      type,
      group: input.controlPlane === true ? "infrastructure" : "runtimes",
    } as ZeropsServiceRow["service"],
    tone: input.tone ?? "outline",
    statusLabel: input.status ?? "Running",
    statusNeedsWord: input.tone !== undefined && input.tone !== "outline",
    typeLabel: type,
    typeShort: type,
    title: input.controlPlane === true ? "Zerops Control Plane" : hostname,
    ...(input.port === undefined ? {} : { portLabel: input.port }),
    meta: [],
    dashboardUrl: `https://app.zerops.io/service-stack/svc-${hostname}`,
    metrics: [
      { id: "cores", label: "CPU", value: "2", used: String(cores), fraction: cores / 2 },
      {
        id: "memory",
        label: "RAM",
        value: String(ramOf),
        used: String(ram),
        unit: "GB",
        fraction: ram / ramOf,
      },
      { id: "disk", label: "Disk", value: "5", used: String(disk), unit: "GB", fraction: disk / 5 },
    ],
    trends: { cores: day(0.06, 2), memory: day(0.3, ramOf), disk: day(0.2, 5) },
    routes:
      input.route === undefined
        ? []
        : [
            {
              label: "app",
              route: {
                port: 3000,
                url: `https://${input.route}`,
                host: input.route,
              },
            },
          ],
    routesFolded: false,
    production: [],
  } as unknown as ZeropsServiceRow;
}

const SERVICES: ZeropsServiceMapView = {
  groups: [
    {
      group: "runtimes",
      title: "Runtimes",
      rows: [
        serviceRow("shopdev", "Node.js 22", {
          port: ":3000",
          route: "shopdev-3000.prg1.zerops.app",
          use: [0.09, 0.4, 2, 0.9],
        }),
        serviceRow("worker", "Go 1.23", {
          tone: "muted",
          status: "Stopped",
          use: [0, 0, 1, 0.2],
        }),
      ],
    },
    {
      group: "infrastructure",
      title: "Infrastructure",
      rows: [
        serviceRow("zcp", "Zerops Control Plane", {
          controlPlane: true,
          use: [0.04, 0.59, 4, 3.1],
        }),
      ],
    },
  ],
  project: { id: "p-dana", name: "tea-shop-dana" } as ZeropsServiceMapView["project"],
  isEmpty: false,
  warnings: [],
  usageRead: true,
} as unknown as ZeropsServiceMapView;

// ---------------------------------------------------------------- scenarios

interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly project: MatePanelProject;
  readonly repositories: ReadonlyArray<ZeropsGitRepository>;
}

const TEA = "Tea Shop";

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    id: "uncommitted",
    title: "Uncommitted work · no stage · not on GitHub",
    project: project(TEA, [PRODUCTION], 2),
    repositories: [
      repository({
        checkout: checkout({ changed: [{ path: "src/call.ts", insertions: 24, deletions: 3 }] }),
        change: change({ number: 32, title: "Steer a call while it answers" }),
        github: NOT_ON_GITHUB,
      }),
    ],
  },
  {
    id: "ready",
    title: "Ready to merge · production and stage · in sync",
    project: project(TEA, [PRODUCTION, STAGE]),
    repositories: [
      repository({
        checkout: checkout(),
        change: change({ number: 33, title: "Gift cards at checkout" }),
        github: IN_SYNC,
      }),
    ],
  },
  {
    id: "merged",
    title: "Merged, waits for production · two repositories",
    project: project(TEA, [production(["Running", "v0.1.3", "since Nov 1"]), STAGE], 3),
    repositories: [
      repository({
        checkout: checkout(),
        change: change({
          number: 31,
          title: "Seasonal menu on the front page",
          merged: true,
          state: "merged",
          mergedAt: ago(60 * 20),
        }),
        landedWords: "Merged · waits for production",
        github: IN_SYNC,
      }),
      repository({
        checkout: checkout({
          repository: "api",
          headRef: "mate/p-dana",
          aheadCount: 2,
        }),
        github: STOPPED,
      }),
    ],
  },
  {
    id: "live",
    title: "Live in a release",
    project: project(TEA, [production(["Running", "v0.1.4", "since 10:42"])]),
    repositories: [
      repository({
        checkout: checkout(),
        change: change({
          number: 30,
          title: "Opening hours in the footer",
          merged: true,
          state: "merged",
          mergedAt: ago(60 * 26),
        }),
        landedWords: "Live in v0.1.4",
        github: IN_SYNC,
      }),
    ],
  },
  {
    id: "empty",
    title: "Empty repository · no production",
    project: project("Acme Notes", [NO_PRODUCTION]),
    repositories: [
      repository({
        checkout: checkout({ repository: "notesdev", isRepo: false, headRef: null }),
        github: NOT_ON_GITHUB,
      }),
    ],
  },
  {
    id: "reading",
    title: "HQ not answered yet",
    project: project(TEA, []),
    repositories: [
      {
        ...repository({ checkout: checkout() }),
        work: [{ kind: "held" }],
      },
    ],
  },
];

// ---------------------------------------------------------------- page

const face = <MateFace size={20} state="idle" tint={"rose" satisfies MateTintId} />;

function Frame({
  width,
  label,
  children,
}: {
  readonly width: number;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-2" data-harness-frame={label}>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      <div
        className="flex h-[760px] flex-col overflow-hidden rounded-lg border border-border bg-background"
        style={{ width }}
      >
        {children}
      </div>
    </figure>
  );
}

function HarnessPage() {
  return (
    <main className="min-h-screen bg-muted/40 p-6 text-foreground">
      <div className="flex flex-col gap-10">
        {widths.map((width) => (
          <section className="flex flex-col gap-3" key={width}>
            <h1 className="text-sm font-medium">{`${String(width)} px`}</h1>
            <div className="flex flex-wrap items-start gap-6">
              {SCENARIOS.filter((scenario) => only === null || scenario.id === only).map(
                (scenario) => (
                  <div className="flex gap-4" data-harness-scenario={scenario.id} key={scenario.id}>
                    {shownPanel === "zerops" ? null : (
                      <Frame label={`Git · ${scenario.title}`} width={width}>
                        <ZeropsGitPanel
                          mateFace={face}
                          mateName="Dana"
                          model={{ repositories: scenario.repositories }}
                          onConnect={() => {}}
                          onOpenChange={() => {}}
                          project={scenario.project}
                          renderBlockAction={(block) =>
                            block.state === "unpushed" ? (
                              <Button size="sm" variant="secondary">
                                Ask Dana to push
                              </Button>
                            ) : null
                          }
                          renderBlockCommits={(block) =>
                            block.pullRequestNumber === undefined ? null : (
                              <div>
                                <Button size="sm" variant="ghost">
                                  History
                                </Button>
                              </div>
                            )
                          }
                        />
                      </Frame>
                    )}
                    {shownPanel === "git" ? null : (
                      <Frame label={`Zerops · ${scenario.title}`} width={width}>
                        <div className="h-full overflow-auto p-4">
                          <ZeropsServiceMap
                            currentServiceId="svc-zcp"
                            liveness="live"
                            mate={{ name: "Dana", tint: "rose", face: "idle" }}
                            project={scenario.project}
                            view={SERVICES}
                          />
                        </div>
                      </Frame>
                    )}
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
// A router of its own, so a place's name and the project's page link as they do in the app.
const router = createRouter({
  routeTree: createRootRoute({ component: HarnessPage }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
}) as unknown as AppRouter;
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
