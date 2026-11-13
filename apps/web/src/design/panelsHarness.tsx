/**
 * A Mate's Zerops and Code pages, in the states they reach, at the panel's two common widths.
 *
 * Served by the dev server at `/design-panels.html` (`?theme=dark`, `?panel=code|zerops|both|launcher`,
 * `?w=420|540`, `?s=<scenario>`; `?w=1351` is the panel maximized at 1786 px). The panels take their reads as props (their surfaces hold the hooks), so this needs
 * no session: invented projects, Mates and services only.
 *
 * Fixtures only. Nothing here ships — `design-panels.html` is not `index.html`, and no route
 * imports this module.
 */
import { ZeropsUserId } from "@t3tools/contracts";
import {
  gitBlock,
  type FlowPullRequest,
  type GitCheckoutState,
  type GroupFlow,
} from "@t3tools/client-runtime/zerops";
import type {
  ZeropsServiceMapView,
  ZeropsServiceRow,
  ZeropsServiceTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  CodeChangesEmpty,
  CodeChangesToolbar,
  CodeCompare,
  CodePage,
  type CodeFile,
} from "~/components/CodePage";
import type { DiffChoice } from "~/components/DiffPanel.logic";
import { DiffPanelLoadingState } from "~/components/DiffPanelShell";
import { RightPanelEmptyState, surfaceActions } from "~/components/RightPanelTabs";
import {
  ServiceBrowserLinkContext,
  type ServicePreviewResolver,
} from "~/components/ServiceBrowserLink";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { DraftId } from "~/composerDraftStore";
import type { DiffRenderMode } from "~/diffPanelStore";
import {
  buildFileDiffRenderKey,
  getDiffLineStat,
  getRenderablePatch,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { resolveDiffThemeName } from "~/lib/diffPresentation";
import type { RepoState } from "~/components/zerops/gitMirror.logic";
import { MatePanelColumn, type MatePanelProject } from "~/components/zerops/MatePanelPlaces";
import { gitWorkRows, lineWork, mateLineInput } from "~/components/zerops/matePanels.logic";
import { projectLine, type ProjectLineView } from "~/components/zerops/system";
import { MateFace } from "~/components/zerops/primitives";
import {
  placeLines,
  type CardChange,
  type CardReady,
  type PlaceLine,
} from "~/components/zerops/projects/projectCard.logic";
import { ZeropsGitPanel, type ZeropsGitRepository } from "~/components/zerops/ZeropsGitPanel";
import { ZeropsServiceMap } from "~/components/zerops/ZeropsServiceMap";
import { ZeropsAgentAuthCard } from "~/components/zerops/ZeropsAgentAuthCard";
import { MateUpdateLine } from "~/components/zerops/MateUpdateLine";
import { ZeropsMateVerb } from "~/components/zerops/ZeropsMateCard";
import { GitCommitsFold } from "~/components/zerops/ZeropsGitBlockCommits";
import {
  RIGHT_PANEL_KINDS,
  type RightPanelAvailability,
  type RightPanelKind,
} from "~/rightPanelKinds";
import type { AppRouter } from "~/router";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(window.location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const shownPanel = params.get("panel") === "git" ? "code" : (params.get("panel") ?? "both");
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
/** Production deployed outside Mate, as the pages' own lines say it (`placeLines`). */
const OUTSIDE_AT = "https://ledger.tea-shop.example";
const OUTSIDE_PLACES = placeLines({
  flow: { production: { kind: "outside", address: OUTSIDE_AT }, stages: [] },
  nowMs: 0,
});
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
  /** What git said when its remote did not answer; the remote answers where absent. */
  readonly unreachable?: string;
}): ZeropsGitRepository {
  const block = gitBlock({
    checkout: input.checkout,
    changes: { read: true, change: input.change },
    declarations: STAGE_DECLARED,
    evidence:
      input.unreachable === undefined
        ? { remoteReachable: true }
        : { remoteReachable: false, remoteDetail: input.unreachable },
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
const APP_GONE: RepoState = {
  destination: { label: "acme/teashop", href: "https://github.com/acme/teashop" },
  line: "Stopped Nov 7 · the GitHub app it went through is no longer in Acme",
  tone: "warn",
  fix: "reconnect",
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
    /** Its stage, folded under it, with a route per port. */
    readonly stage?: { readonly hostname: string; readonly ports: ReadonlyArray<number> };
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
    ...(input.stage === undefined
      ? {}
      : {
          stage: {
            serviceId: `svc-${input.stage.hostname}`,
            hostname: input.stage.hostname,
            type,
            group: "runtimes",
          },
          stageTone: "outline",
          stageStatusLabel: "Running",
          stageStatusNeedsWord: false,
          stageMetrics: [],
          stagePortLabel: input.stage.ports.map((port) => `:${String(port)}`).join(", "),
          stageRoutes: input.stage.ports.map((port, index) => ({
            label: index === 0 ? `:${String(port)} · the service's own` : `:${String(port)}`,
            route: {
              port,
              url: `https://${input.stage!.hostname}-${String(port)}.prg1.zerops.app`,
              host: `${input.stage!.hostname}-${String(port)}.prg1.zerops.app`,
            },
          })),
          stageRoutesFolded: false,
        }),
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
          stage: { hostname: "shopstage", ports: [3000, 5173] },
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
  /**
   * What "What changed" shows: files not committed beside the branch's (`both`), the branch's
   * alone, one of them opened, or a state with no files.
   */
  readonly changes: "both" | "branch" | "open" | "nothing" | "no-code" | "reading";
  /** The Mate's home needs the person: an agent signed in by someone else, an update that waits. */
  readonly homeNeedsYou?: boolean;
  /** Dana's changes the project lists beyond its repositories' rows: beads on the line alone. */
  readonly lineChanges?: ReadonlyArray<CardChange>;
  /** Dana's changes in review wait on the viewer. */
  readonly waits?: boolean;
  /** The project's production is deployed outside Mate. */
  readonly productionOutside?: boolean;
}

// ---------------------------------------------------------------- the line

/** Other Mates' changes in the project: on Dana's line they are a count. */
const OTHERS: ReadonlyArray<CardChange> = [
  ...[41, 40, 39].map((number): CardChange => ({
    pull: change({ number, title: "Another Mate's change", mateProjectId: "p-odo" }),
    open: true,
    words: "Ready to merge",
    tone: "off",
    at: ago(90),
  })),
  ...[29, 28].map((number): CardChange => ({
    pull: change({
      number,
      title: "Another Mate's change",
      mateProjectId: "p-odo",
      merged: true,
      state: "merged",
      mergedAt: ago(60 * 30),
    }),
    open: false,
    words: "Merged · waits for production",
    tone: "off",
    at: ago(60 * 30),
    where: { kind: "waits-for-production" },
  })),
];

/**
 * The project's line as Dana's Code page draws it, from the scenario's own fixtures: its places as
 * stations, the changes its repositories' rows show, and Dana's work on disk.
 */
function harnessLine(scenario: Scenario): ProjectLineView | undefined {
  const { places } = scenario.project;
  // HQ has not answered: the line's card holds its room.
  if (places.length === 0) return undefined;
  const shown = scenario.repositories.flatMap(({ work }) =>
    work.flatMap((row): ReadonlyArray<CardChange> =>
      row.kind !== "change"
        ? []
        : [
            {
              pull: row.pull,
              open: row.open,
              words: row.state,
              tone: row.tone,
              at: row.at,
              ...(row.open
                ? {}
                : {
                    where: row.state.startsWith("Live in")
                      ? { kind: "released" as const, tag: row.state.slice(8), live: true }
                      : { kind: "waits-for-production" as const },
                  }),
            },
          ],
    ),
  );
  const changes = [...shown, ...(scenario.lineChanges ?? []), ...OTHERS];
  const live = places.some((line) => line.kind === "production" && line.projectId !== undefined);
  // The flow as far as the line reads it: its Mates, its open changes, its places' setup.
  const flow = {
    mates: [
      { projectId: "p-dana", name: "Dana" },
      { projectId: "p-odo", name: "Odo" },
    ],
    pullRequests: changes
      .filter((entry) => entry.open)
      .map((entry) => ({ pull: entry.pull, blocked: null, state: undefined, review: true })),
    production: live
      ? { kind: "live" }
      : scenario.productionOutside === true
        ? { kind: "outside", address: OUTSIDE_AT }
        : { kind: "absent" },
    stages: places
      .filter((line) => line.kind === "stage" && line.projectId !== undefined)
      .map((line) => ({
        projectId: line.projectId,
        name: line.name,
        state: "deployed",
        source: "main",
        addresses: line.addresses,
      })),
  } as unknown as Pick<GroupFlow, "mates" | "production" | "stages" | "pullRequests">;
  return projectLine({
    ...mateLineInput({
      flow,
      places,
      changes,
      next: scenario.project.next,
      mate: { projectId: "p-dana", tint: "rose" },
      waits: scenario.waits === true,
    }),
    work: lineWork(scenario.repositories, "p-dana"),
  });
}

const TEA = "Tea Shop";

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    id: "line",
    changes: "both",
    waits: true,
    title: "The line · work on disk, a change waiting on you, one merged · a release ready",
    project: project(TEA, [PRODUCTION, STAGE], 4),
    repositories: [
      repository({
        checkout: checkout({ changed: [{ path: "src/call.ts", insertions: 24, deletions: 3 }] }),
        change: change({ number: 34, title: "Sold-out switch remembered across visits" }),
        github: IN_SYNC,
      }),
    ],
    lineChanges: [
      {
        pull: change({
          number: 31,
          title: "Seasonal menu on the front page",
          merged: true,
          state: "merged",
          mergedAt: ago(60 * 20),
        }),
        open: false,
        words: "On stage",
        tone: "off",
        at: ago(60 * 20),
        where: { kind: "on-stage" },
      },
    ],
  },
  {
    id: "uncommitted",
    changes: "both",
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
    id: "open",
    changes: "open",
    title: "A file opened to its lines",
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
    homeNeedsYou: true,
    changes: "branch",
    title: "Ready to merge · production and stage · in sync · home needs you",
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
    changes: "nothing",
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
    changes: "branch",
    title: "Live in a release · new commits since · app gone",
    project: project(TEA, [production(["Running", "v0.1.4", "since 10:42"])]),
    repositories: [
      repository({
        checkout: checkout({ aheadCount: 2 }),
        change: change({
          number: 30,
          title: "Opening hours in the footer",
          merged: true,
          state: "merged",
          mergedAt: ago(60 * 26),
        }),
        landedWords: "Live in v0.1.4",
        github: APP_GONE,
      }),
    ],
  },
  {
    id: "unreachable",
    changes: "nothing",
    title: "The repository does not answer · a merged change · none yet",
    project: project(TEA, [PRODUCTION, STAGE], 1),
    repositories: [
      repository({
        checkout: checkout({ aheadCount: 2 }),
        change: change({
          number: 31,
          title: "Seasonal menu on the front page",
          merged: true,
          state: "merged",
          mergedAt: ago(60 * 20),
        }),
        landedWords: "Merged · waits for production",
        github: IN_SYNC,
        unreachable: "fatal: remote helper for 'tea' aborted: 1: tea: not found",
      }),
      repository({
        checkout: checkout({ repository: "api", headRef: "mate/p-dana" }),
        github: IN_SYNC,
        unreachable: "fatal: unable to access 'https://hq.example/acme/api.git/': timed out",
      }),
    ],
  },
  {
    id: "empty",
    changes: "no-code",
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
    id: "outside-set",
    changes: "no-code",
    title: "Production deployed outside Mate",
    project: project("Tea Ledger", OUTSIDE_PLACES),
    productionOutside: true,
    repositories: [
      repository({
        checkout: checkout({ repository: "ledgerdev", isRepo: false, headRef: null }),
        github: NOT_ON_GITHUB,
      }),
    ],
  },
  {
    id: "reading",
    changes: "reading",
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

/** A change's commits, folded as the tab folds them, from fixtures. */
function HarnessCommits() {
  const [open, setOpen] = useState(false);
  return (
    <GitCommitsFold
      commits={[
        { sha: "c0ffee1a2b", subject: "Steer a call while it answers", at: ago(50) },
        { sha: "b4dd00d3c1", subject: "Hold the line while the caller waits", at: ago(140) },
      ]}
      onToggle={() => setOpen(!open)}
      open={open}
    />
  );
}

// ---------------------------------------------------------------- what changed

const NOT_COMMITTED_PATCH = [
  "diff --git a/src/call.ts b/src/call.ts",
  "index 1a2b3c4..5d6e7f8 100644",
  "--- a/src/call.ts",
  "+++ b/src/call.ts",
  "@@ -12,7 +12,9 @@ export function answer(call: Call) {",
  "   const line = call.line();",
  "-  line.hold();",
  "+  // Steer while it answers: the caller hears the next step at once.",
  "+  line.steer(call.next());",
  "+  line.keep();",
  "   return line;",
  " }",
  "",
].join("\n");

const COMMITTED_PATCH = [
  "diff --git a/src/cart.ts b/src/cart.ts",
  "index 2b3c4d5..6e7f809 100644",
  "--- a/src/cart.ts",
  "+++ b/src/cart.ts",
  '@@ -3,6 +3,10 @@ import { price } from "./price";',
  " export function total(cart: Cart) {",
  "-  return cart.items.reduce((sum, item) => sum + price(item), 0);",
  "+  const items = cart.items.reduce((sum, item) => sum + price(item), 0);",
  "+  const gift = cart.giftCard?.balance ?? 0;",
  "+  // A gift card pays what it holds, never more than the cart.",
  "+  return Math.max(0, items - gift);",
  " }",
  "diff --git a/src/menu.ts b/src/menu.ts",
  "new file mode 100644",
  "index 0000000..3c4d5e6",
  "--- /dev/null",
  "+++ b/src/menu.ts",
  "@@ -0,0 +1,4 @@",
  "+export const SEASONAL = [",
  '+  { name: "Green tea", price: 3.5 },',
  '+  { name: "Chai", price: 4 },',
  "+];",
  "",
].join("\n");

const SHOP = { name: "shopdev", label: "shopdev", cwd: "/var/www/shopdev" };
const CHOICES: ReadonlyArray<DiffChoice> = [
  {
    repository: SHOP,
    scope: "unstaged",
    label: "Not committed",
    count: 1,
    nothing: "Everything in shopdev is committed.",
    baseRef: null,
  },
  {
    repository: SHOP,
    scope: "branch",
    label: "Not on main",
    count: 2,
    nothing: "Nothing in shopdev is outside main.",
    baseRef: null,
  },
];

const patchFiles = (patch: string, scope: string) => {
  const parsed = getRenderablePatch(patch, scope, { compactPartialHunkOffsets: true });
  return parsed?.kind === "files" ? parsed.files : [];
};

/** The page's "What changed", from fixtures, under the scenario's project and repositories. */
function HarnessCode({ scenario, top }: { readonly scenario: Scenario; readonly top: ReactNode }) {
  const theme = appearance;
  const [mode, setMode] = useState<DiffRenderMode>("stacked");
  const [wrap, setWrap] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const notCommitted = scenario.changes === "both" || scenario.changes === "open";
  const fileDiffs = [
    ...(notCommitted
      ? patchFiles(NOT_COMMITTED_PATCH, `code-not-committed:${theme}`).map((fileDiff) => ({
          fileDiff,
          marked: true,
        }))
      : []),
    ...(["both", "branch", "open"].includes(scenario.changes)
      ? patchFiles(COMMITTED_PATCH, `code-committed:${theme}`).map((fileDiff) => ({
          fileDiff,
          marked: false,
        }))
      : []),
  ];
  const [opened, setOpened] = useState<ReadonlySet<string>>(() =>
    scenario.changes === "open" && fileDiffs[1] !== undefined
      ? new Set([buildFileDiffRenderKey(fileDiffs[1].fileDiff)])
      : new Set(),
  );
  const files: ReadonlyArray<CodeFile> = fileDiffs.map(({ fileDiff, marked }) => {
    const fileKey = buildFileDiffRenderKey(fileDiff);
    return {
      fileDiff,
      fileKey,
      filePath: resolveFileDiffPath(fileDiff),
      collapsed: !opened.has(fileKey),
      notCommitted: marked,
    };
  });
  const allCollapsed = files.every((file) => file.collapsed);
  const shown =
    scenario.changes === "no-code" || scenario.changes === "reading" ? null : CHOICES[1]!;
  const toggle = (fileKey: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(fileKey)) next.delete(fileKey);
      else next.add(fileKey);
      return next;
    });
  return (
    <CodePage
      changesAsked={false}
      commits={
        scenario.repositories[0]?.block.pullRequestNumber === undefined || shown === null ? null : (
          <HarnessCommits />
        )
      }
      composerDraftTarget={DraftId.make("harness-code")}
      files={files}
      notices={null}
      onChangesShown={() => {}}
      onToggleFile={toggle}
      options={{
        diffStyle: mode === "split" ? "split" : "unified",
        lineDiffType: "none",
        overflow: wrap ? "wrap" : "scroll",
        theme: resolveDiffThemeName(theme),
        themeType: theme,
        stickyHeaders: true,
      }}
      sectionId="harness"
      sectionTitle="Not on main"
      state={
        scenario.changes === "reading" ? (
          <DiffPanelLoadingState label="Reading git..." />
        ) : scenario.changes === "no-code" ? (
          <CodeChangesEmpty title="No code here yet." />
        ) : scenario.changes === "nothing" ? (
          <CodeChangesEmpty title="Nothing in shopdev is outside main." />
        ) : null
      }
      toolbar={
        shown === null ? null : (
          <CodeChangesToolbar
            choices={CHOICES}
            collapse={
              files.length === 0
                ? null
                : {
                    allCollapsed,
                    onToggle: () =>
                      setOpened(
                        allCollapsed ? new Set(files.map((file) => file.fileKey)) : new Set(),
                      ),
                  }
            }
            compare={
              <CodeCompare base="origin/main" head="mate/p-dana">
                <Button size="sm" variant="ghost">
                  <span className="min-w-0 truncate">origin/main</span>
                  <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
                </Button>
              </CodeCompare>
            }
            onChoose={() => {}}
            refresh={{ pending: false, onRefresh: () => {} }}
            shown={shown}
            stat={files.length === 0 ? null : getDiffLineStat(files.map((file) => file.fileDiff))}
            view={{
              mode,
              onMode: setMode,
              wrap,
              onWrap: setWrap,
              ignoreWhitespace,
              onIgnoreWhitespace: setIgnoreWhitespace,
            }}
          />
        )
      }
      top={top}
      viewKey={`harness:${scenario.id}`}
    />
  );
}

/** Every address opens in the panel's browser, as a conversation's scope resolves it. */
const OPENS_BESIDE: ServicePreviewResolver = () => () => {};

const face = <MateFace size={20} state="idle" tint={"rose" satisfies MateTintId} />;

/** Dana's coding agents: Claude Code signed in by the person, Codex not signed in. */
const AGENTS: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      state: "authorized",
      providerAuth: "unknown",
    },
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      state: "not-authorized",
      providerAuth: "unknown",
    },
  ],
} as ZeropsAgentAuthSnapshot;

const agents = (
  <ZeropsAgentAuthCard
    conversationAgentId="claude-code"
    density="compact"
    onCancel={() => {}}
    onSignIn={() => {}}
    snapshot={AGENTS}
  />
);

/** Claude Code signed in by a crewmate, which needs this person; Codex signed in by them. */
const AGENTS_ATTENTION: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      state: "authorized",
      providerAuth: "unknown",
      authorizedBy: { subject: ZeropsUserId.make("u-juno") },
    },
    {
      agentId: "codex",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      state: "authorized",
      providerAuth: "unknown",
      authorizedBy: { subject: ZeropsUserId.make("u-me") },
    },
  ],
} as ZeropsAgentAuthSnapshot;

const agentsAttention = (
  <ZeropsAgentAuthCard
    conversationAgentId="claude-code"
    density="compact"
    onCancel={() => {}}
    onSignIn={() => {}}
    snapshot={AGENTS_ATTENTION}
    viewerSubject={ZeropsUserId.make("u-me")}
  />
);

/** The Mate's update line where a newer version is available, with its verb. */
const updateAvailable = (
  <MateUpdateLine
    line={{ text: "Server 0.16.111 · 0.16.112 available", tone: "attention" }}
    verb={<ZeropsMateVerb label="Update" onClick={() => {}} />}
  />
);

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

/** Every page a conversation in a Zerops project can open, one of them not offered here. */
const LAUNCHER = surfaceActions({
  availability: {
    ...(Object.fromEntries(RIGHT_PANEL_KINDS.map((kind) => [kind, "available"])) as Record<
      RightPanelKind,
      RightPanelAvailability
    >),
    overview: "hidden",
    mac: "unavailable",
  },
  liveAgentCount: 2,
  onAdd: () => {},
  onAddTerminal: () => {},
});

/** The empty panel: "Open a page", at the panel's widths. */
function HarnessLauncher() {
  return (
    <main className="min-h-screen bg-muted/40 p-6 text-foreground">
      <div className="flex flex-wrap items-start gap-6">
        {widths.map((width) => (
          <Frame key={width} label={`Open a page · ${String(width)} px`} width={width}>
            <RightPanelEmptyState actions={LAUNCHER} />
          </Frame>
        ))}
      </div>
    </main>
  );
}

function HarnessPage() {
  if (shownPanel === "launcher") return <HarnessLauncher />;
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
                      <Frame label={`Code · ${scenario.title}`} width={width}>
                        <HarnessCode
                          scenario={scenario}
                          top={
                            <ZeropsGitPanel
                              mateFace={face}
                              mateName="Dana"
                              line={harnessLine(scenario)}
                              model={{ repositories: scenario.repositories }}
                              onCheckAgain={() => {}}
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
                            />
                          }
                        />
                      </Frame>
                    )}
                    {shownPanel === "code" ? null : (
                      <Frame label={`Zerops · ${scenario.title}`} width={width}>
                        {/* The page's own shell (`ZeropsPanel`): its scroller and its column. */}
                        <ScrollArea className="h-full">
                          <div className="pb-4">
                            <MatePanelColumn>
                              {/* Addresses open beside the chat, as they do in a conversation. */}
                              <ServiceBrowserLinkContext value={OPENS_BESIDE}>
                                <ZeropsServiceMap
                                  agents={scenario.homeNeedsYou === true ? agentsAttention : agents}
                                  currentServiceId="svc-zcp"
                                  mateUpdate={
                                    scenario.homeNeedsYou === true ? (
                                      updateAvailable
                                    ) : (
                                      <span>Mate 0.16.112 · up to date</span>
                                    )
                                  }
                                  liveness="live"
                                  mate={{ name: "Dana", tint: "rose", face: "idle" }}
                                  project={scenario.project}
                                  // `?running`: a tool at work on the services, said at the label's end.
                                  view={
                                    params.get("running") === null
                                      ? SERVICES
                                      : { ...SERVICES, runningTool: "Stand-up · stage" }
                                  }
                                />
                              </ServiceBrowserLinkContext>
                            </MatePanelColumn>
                          </div>
                        </ScrollArea>
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
