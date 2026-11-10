import { HqEnvironmentId } from "@t3tools/contracts";
import type { RunningLine } from "@t3tools/client-runtime/zerops/activity/runningNow";
import { environmentRow } from "~/components/zerops/projects/flowTestFixtures";
import type { ReleaseOffer } from "~/components/zerops/ZeropsReleaseVerb";
/**
 * Every page that stands in place of the thread, in the states it reaches.
 *
 * Served by the dev server at `/design-detail.html`. The panes take their
 * reads as props (their pages hold the hooks), so this needs no session and no
 * account in any particular state — which is the only way to look at a
 * production twelve changes behind, a deploy that failed with nothing running,
 * or a project with nothing set up at all.
 *
 * Fixtures only. Nothing here ships — `design-detail.html` is not
 * `index.html`, and no route imports this module.
 */
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { StrictMode, useState, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { AppRouter } from "~/router";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import { createRoot } from "react-dom/client";

import {
  carriedReads,
  deployedCommit,
  deployedVersion,
  releaseRunBy,
  nameStopByRelease,
  sameCommit,
  releaseRow,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type EnvironmentServiceState,
  type FlowPullRequest,
  type FlowRelease,
  type MovedCommits,
  type ReleaseCreationFailure,
  type ReleaseDeployFailure,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";
import {
  releaseNotCreated,
  releasesNotDeployed,
  serviceRows,
  rowsRunningAgain,
  stopFailedDeploys,
  stopKeyGap,
  stopVerdict,
  stopView,
  type Deployment,
  type StopService,
} from "@t3tools/client-runtime/zerops/flow";
import { type HqJob, jobInFlight } from "@t3tools/client-runtime/zerops/hq";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
} from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import { ZeropsStopPane } from "~/components/zerops/PlacePage";
import { changesOfRelease } from "~/components/zerops/place/placePage.logic";
import { GitStopDetail } from "~/components/zerops/GitStopDetail";
import { DetailShell } from "~/components/zerops/ZeropsGroupDetail";
import { PlaceLine } from "~/components/zerops/system";
import { MateFace } from "~/components/zerops/primitives";
import type {
  CardReady,
  PlaceLine as PlaceLineData,
} from "~/components/zerops/projects/projectCard.logic";
import type { MateTintId } from "@t3tools/shared/brand";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import { VaultPanelBody } from "~/components/zerops/vault/VaultPanel";
import { VAULT_FIXTURE, vaultFixtureImpact } from "~/components/zerops/vault/vaultFixture";
import type { columnPeople } from "~/components/zerops/projects/accessTable.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import type { ZeropsHistoryState } from "~/zerops/useRepositoryHistory";

import { SidebarProvider } from "~/components/ui/sidebar";
import type { KeyRenewal } from "~/zerops/renewDeployKey.logic";
import "../index.css";

const ROUTES = [
  {
    service: "app",
    port: 80,
    host: "shop-app.prg1.zerops.app",
    url: "https://shop-app.prg1.zerops.app",
  },
  {
    service: "api",
    port: 80,
    host: "shop-api.prg1.zerops.app",
    url: "https://shop-api.prg1.zerops.app",
  },
];

const NAMES = { mateNames: new Map([["p-theo", "Theo"]]) };

const trail = (group: string, here: string) => [
  { label: "Overview", onClick: () => {} },
  { label: group, onClick: () => {} },
  { label: here },
];

const sha = (seed: string) => seed.padEnd(40, "0").slice(0, 40);

/** A commit as HQ compares it: a Mate's (`mate-{projectId}`) is its change, landed by HQ. */
function commit(subject: string, seed: string, hoursAgo: number, author = "Theo"): CompareCommit {
  const mate = author.startsWith("mate-") ? author.slice("mate-".length) : undefined;
  return {
    sha: sha(seed),
    subject,
    authorName: mate === undefined ? author : "Mate HQ",
    at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    change: mate === undefined ? null : { number: 4, title: subject, mateProjectId: mate },
  };
}

const HISTORY: ZeropsHistoryState = {
  kind: "read",
  total: 5,
  commits: [
    commit("Key the preview cache on locale", "b21d904c", 1),
    commit("Cache the link previews", "5c3ea18b", 3),
    commit("Fix the VAT rate table for Ireland", "3f9c1b2e", 20, "wren"),
    commit("Add an index on orders.created_at", "9a7d2f10", 30),
    commit("Stop logging the full card token", "c41b8e55", 48, "Wren"),
  ],
};
/** What v1.4.0 shipped, as HQ's release records name it. */
const TAGS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([[sha("3f9c1b2e"), ["v1.4.0"]]]);

const RELEASE_WAITING: ReleaseOffer = {
  offered: true,
  releasing: false,
  tag: "v1.5.0",
  reason: undefined,
  onReview: () => {},
};

/** Nothing to release: production already runs every commit on main. */
const RELEASE_NONE: ReleaseOffer = {
  offered: false,
  releasing: false,
  tag: undefined,
  reason: undefined,
  onReview: () => {},
};

/** Opening a commit is what grew the row and dragged the node down the rail. */
const NOW = Date.now();

/** The Mates whose changes a place's page lists, by their projects, as the menu draws them. */
const MATES: Readonly<Record<string, { readonly name: string; readonly tint: MateTintId }>> = {
  "p-juno": { name: "Juno", tint: "sky" },
  "p-raya": { name: "Raya", tint: "olive" },
};

const mateFace = (mateProjectId: string) => {
  const mate = MATES[mateProjectId];
  return mate === undefined ? undefined : <MateFace size={20} state="idle" tint={mate.tint} />;
};

/** A Mate's change `hoursAgo` old: merged, or still open and ready to merge. */
function change(
  number: number,
  title: string,
  mateProjectId: string,
  hoursAgo: number,
  merged: boolean,
): FlowPullRequest {
  const at = new Date(NOW - hoursAgo * 3_600_000).toISOString();
  return {
    repository: "appdev",
    number,
    title,
    kind: "code",
    mateProjectId,
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged,
    mergedAt: merged ? at : undefined,
    headSha: sha(String(number)),
    baseBranch: "main",
    line: `appdev #${String(number)}`,
    updatedAt: at,
  };
}

/** Two changes merged since production's release, waiting for the next one. */
const MERGED_WAITING = [
  change(27, "Connect calendars, notes and boards in one step", "p-juno", 22, true),
  change(26, "A hidden browser for web work", "p-raya", 26, true),
];

/** What production's next release carries, as `readyOfFlow` reads it. */
const READY_TWO: CardReady = {
  count: 2,
  changeCount: 2,
  atLeast: false,
  stage: undefined,
  from: undefined,
  failed: false,
};

/** Two open changes on their way to a stage: one ready to merge. */
const STAGE_OPEN = [
  change(31, "Steer a bot while it answers", "p-juno", 13, false),
  { ...change(32, "Settings as a centred window", "p-raya", 17, false), ready: false },
];

/** One service of a stop: what it runs, and how HQ records its deploy of that commit went. */
function service(
  hostname: string,
  seed: string | undefined,
  name: string | undefined,
  state: HqJob["state"] = "live",
  repository = "appdev",
): EnvironmentServiceState {
  return {
    hostname,
    repository,
    appVersionName:
      seed === undefined ? undefined : name === undefined ? sha(seed) : `${sha(seed)} ${name} wren`,
    ...(seed === undefined
      ? {}
      : { deploy: { latest: deployRecord(sha(seed), state), live: null } }),
  };
}

/** HQ's job of a deploy of `commit` in `state`. */
function deployRecord(commit: string, state: HqJob["state"]): HqJob {
  return {
    id: `job-${commit}`,
    kind: "deploy",
    service: null,
    sha: commit,
    state,
    cause: "merge",
    ref: null,
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-09-19T11:00:00Z",
    endedAt: jobInFlight({ state }) ? null : "2026-09-19T11:00:00Z",
    supersededBy: null,
  };
}

/** A fact the platform stated just now. */
function known<T>(value: T): Shown<T> {
  return {
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: NOW },
    coverage: "complete",
    freshness: { kind: "live" },
  };
}

const NOTHING_RUNS: Deployment = { kind: "none" };

/**
 * Tea Shop's production as it was read on 2026-09-25: medusa has run one commit since v0.1.9, and
 * every release after it moved only nextstore — so its first service names v0.1.9, and the
 * newest release both services run is v0.1.13.
 */
const MEDUSA = "4278679a";
const NEXTSTORE = [
  "47ae139c",
  "86588f0d",
  "b7a22bb1",
  "b9434e2f",
  "191118c4",
  "0c1d2e3a",
  "9f8e7d6b",
] as const;
const TEASHOP_RELEASES: ReadonlyArray<FlowRelease> = NEXTSTORE.map((nextstore, index) => {
  const medusa = index < 5 ? MEDUSA : "1a2b3c4d";
  return {
    tag: `v0.1.${String(13 - index)}`,
    verdict: "approved",
    detail: undefined,
    line: `medusa ${medusa.slice(0, 7)} · nextstore ${nextstore.slice(0, 7)}`,
    entries: [
      { service: "medusa", commit: sha(medusa) },
      { service: "nextstore", commit: sha(nextstore) },
    ],
    // A day apart, newest first.
    taggedAt: new Date(NOW - (index + 1) * 86_400_000).toISOString(),
  };
});

/**
 * A service no tier builds from a repository — a database, a cache, a bucket — as the platform
 * lists it beside the code services. The page gives it no row and does not count it.
 */
const managed = (hostname: string): EnvironmentServiceState => ({ hostname });

/**
 * What Tea Shop's production runs: medusa from v0.1.9, nextstore from v0.1.13 — and db, redis and
 * storage, which the platform lists and nothing deploys.
 */
const TEASHOP_LIVE = [
  managed("db"),
  service("medusa", MEDUSA, "v0.1.9", "live", "medusadev"),
  service("nextstore", NEXTSTORE[0], "v0.1.13", "live", "nextstoredev"),
  managed("redis"),
  managed("storage"),
];

const TEASHOP_ROUTES = [
  {
    service: "medusa",
    port: 9000,
    host: "medusa-2ff9-9000.prg1.zerops.app",
    url: "https://medusa-2ff9-9000.prg1.zerops.app",
  },
  {
    service: "nextstore",
    port: 8000,
    host: "nextstore-2ff9-8000.prg1.zerops.app",
    url: "https://nextstore-2ff9-8000.prg1.zerops.app",
  },
];

/** A day of one resource, made up: what was used of `limit`, hour by hour. */
const day = (base: number, limit: number) =>
  Array.from({ length: 24 }, (_, hour) => ({
    at: new Date(NOW - (24 - hour) * 3_600_000).toISOString(),
    used: limit * Math.max(0.02, base + 0.12 * Math.sin(hour / 2.4) + (hour % 6 === 0 ? 0.08 : 0)),
    limit,
  }));

/** A service as the service map reads it: what it is, its use now and its last day. */
function mapRow(
  hostname: string,
  type: string,
  typeShort: string,
  portLabel: string | undefined,
  use?: {
    readonly cores: string;
    readonly ram: string;
    readonly ramOf: string;
    readonly disk: string;
  },
): ZeropsServiceRow {
  return {
    isControlPlane: false,
    service: { serviceId: `svc-${hostname}`, hostname, type } as ZeropsServiceRow["service"],
    tone: "ok",
    statusLabel: "Running",
    statusNeedsWord: false,
    typeLabel: type,
    typeShort,
    title: hostname,
    ...(portLabel === undefined ? {} : { portLabel }),
    meta: [],
    dashboardUrl: `https://app.zerops.io/service-stack/svc-${hostname}`,
    metrics:
      use === undefined
        ? []
        : [
            {
              id: "cores",
              label: "CPU",
              value: "2",
              used: use.cores,
              fraction: Number(use.cores) / 2,
            },
            {
              id: "memory",
              label: "RAM",
              value: use.ramOf,
              used: use.ram,
              unit: "GB",
              fraction: Number(use.ram) / Number(use.ramOf),
            },
            {
              id: "disk",
              label: "Disk",
              value: "5",
              used: use.disk,
              unit: "GB",
              fraction: Number(use.disk) / 5,
            },
          ],
    ...(use === undefined
      ? {}
      : { trends: { cores: day(0.06, 2), memory: day(0.3, 1), disk: day(0.2, 5) } }),
    routes: [],
    routesFolded: false,
    production: [],
  } as unknown as ZeropsServiceRow;
}

/**
 * Acme's production: two code services HQ deploys from their repositories, and a database, a
 * cache, a search engine and a bucket beside them — six in all.
 */
/** A service whose newest deploy names its Zerops process, so its row offers View deploy. */
const inspectable = (entry: EnvironmentServiceState): EnvironmentServiceState =>
  entry.deploy?.latest === undefined
    ? entry
    : {
        ...entry,
        deploy: {
          ...entry.deploy,
          latest: { ...entry.deploy.latest, processId: `process-${entry.hostname}` },
        },
      };

const ACME_LIVE = [
  inspectable(service("shop", MEDUSA, "v0.1.9", "live", "acme-shop")),
  inspectable(service("storefront", NEXTSTORE[0], "v0.1.13", "live", "acme-storefront")),
  managed("db"),
  managed("redis"),
  managed("search"),
  managed("storage"),
];

const ACME_SERVICES = [
  mapRow("db", "postgresql@17", "PostgreSQL 17", ":5432, :6432", {
    cores: "0.12",
    ram: "0.41",
    ramOf: "1",
    disk: "1.8",
  }),
  mapRow("redis", "valkey@7.2", "Valkey 7.2", ":6379, :6380", {
    cores: "0.03",
    ram: "0.06",
    ramOf: "0.25",
    disk: "0.1",
  }),
  mapRow("search", "meilisearch@1.10", "Meilisearch", ":7700", {
    cores: "0.05",
    ram: "0.22",
    ramOf: "0.5",
    disk: "0.6",
  }),
  mapRow("shop", "nodejs@22", "Node.js 22", ":9000", {
    cores: "0.08",
    ram: "0.31",
    ramOf: "1",
    disk: "0.9",
  }),
  mapRow("storage", "object-storage", "Object storage", undefined),
  mapRow("storefront", "nodejs@22", "Node.js 22", ":8000", {
    cores: "0.21",
    ram: "0.52",
    ramOf: "1",
    disk: "1.2",
  }),
];

/** Tea Shop's releases under Acme's names: medusa is the shop, nextstore the storefront. */
/** What Acme's releases put live, as HQ records each release's changes. */
const ACME_BROUGHT = [
  "Every person gets a Mate of their own",
  "Connect calendars, notes, boards and whiteboards from the chat",
  "Behaviour settings for every bot",
  "Hand tasks to your other bots",
  "Retry the desktop setup at start",
  "Two columns, live chat and a chosen model",
];

const ACME_RELEASES: ReadonlyArray<FlowRelease> = TEASHOP_RELEASES.map((release, index) => ({
  ...release,
  history: {
    ranges: [],
    changes: ACME_BROUGHT.slice(index % 3, (index % 3) + 6 - (index % 3)).map((title, at) => ({
      repo: "appdev",
      number: 20 - index * 6 - at,
      title,
    })),
    commitCount: 6,
    outsideCommitCount: 0,
  },
  line: release.line.replace("medusa", "shop").replace("nextstore", "storefront"),
  entries: release.entries.map((entry) => ({
    ...entry,
    service: entry.service === "medusa" ? "shop" : "storefront",
  })),
}));

/** The storefront commits v0.1.14 and v0.1.15 listed; neither was ever deployed. */
const STOREFRONT_REFUSED = ["c7d19e42", "e2a60b5f"] as const;

/** HQ's job of a release's deploy it refused at its one try. */
const refusedBy = (tag: string, commit: string): HqJob => ({
  ...deployRecord(sha(commit), "refused"),
  cause: "release",
  ref: tag,
  reason: "The release could not create what it needs first.",
});

/**
 * Acme's production after two releases that needed a database it does not have: the shop and the
 * storefront run what v0.1.13 put live, the storefront's newest job is HQ's refusal of v0.1.15,
 * and Zerops lists no db.
 */
const ACME_WITHOUT_DB = [
  inspectable(service("shop", MEDUSA, "v0.1.9", "live", "acme-shop")),
  {
    ...service("storefront", NEXTSTORE[0], "v0.1.13", "live", "acme-storefront"),
    deploy: {
      latest: refusedBy("v0.1.15", STOREFRONT_REFUSED[1]),
      live: deployRecord(sha(NEXTSTORE[0]), "live"),
    },
  },
  managed("redis"),
  managed("search"),
  managed("storage"),
];

/** v0.1.14 and v0.1.15 over Acme's releases: each listed a storefront commit that never deployed. */
const ACME_REFUSED_RELEASES: ReadonlyArray<FlowRelease> = [
  ...(["v0.1.15", "v0.1.14"] as const).map((tag, index) => ({
    tag,
    verdict: "approved" as const,
    detail: undefined,
    line: `shop ${MEDUSA.slice(0, 7)} · storefront ${(STOREFRONT_REFUSED[1 - index] ?? "").slice(0, 7)}`,
    entries: [
      { service: "shop", commit: sha(MEDUSA) },
      { service: "storefront", commit: sha(STOREFRONT_REFUSED[1 - index] ?? "") },
    ],
    taggedAt: new Date(NOW - (index + 1) * 420_000).toISOString(),
    history: {
      ranges: [],
      changes: [
        {
          repo: "appdev",
          number: 31 - index,
          title:
            index === 0
              ? "Keep sign-ins in the database (#17)"
              : "Remember who is signed in across restarts (#16)",
        },
      ],
      commitCount: 1,
      outsideCommitCount: 0,
    },
  })),
  ...ACME_RELEASES,
];

/**
 * Relay's production after a change was released three times: v0.1.4 and v0.1.5 didn't go live,
 * v0.1.6 carried the same change and did, and v0.1.7 went live after it. Every release lists the
 * changes HQ recorded for it; the three share one commit of `main`.
 */
const RELAY_COMMITS = ["d4a91c70", "6be203f5", "3f7c8a12", "91e5d0b4", "c2084e6a", "7a1f39d8"];
const RELAY_CHANGES: ReadonlyArray<ReadonlyArray<readonly [number, string]>> = [
  [[12, "Steer the bot while it answers"]],
  [[11, "A hidden browser for web work, the desktop's browser for sign-ins"]],
  [[11, "A hidden browser for web work, the desktop's browser for sign-ins"]],
  [[11, "A hidden browser for web work, the desktop's browser for sign-ins"]],
  [
    [9, "Connect notes and boards in one step"],
    [8, "Everyone gets the bot, which guides their sign-in"],
  ],
  [[7, "Quiet hours for the whole team"]],
  [[5, "A daily digest of what was asked"]],
  [[3, "Answer in the thread it was asked in"]],
];
const RELAY_RELEASES: ReadonlyArray<FlowRelease> = RELAY_CHANGES.map((changes, index) => {
  // v0.1.6, v0.1.5 and v0.1.4 were made from one commit of main.
  const commit = RELAY_COMMITS[index < 1 ? 0 : index < 4 ? 1 : index - 2] ?? "";
  return {
    tag: `v0.1.${String(7 - index)}`,
    verdict: "approved",
    detail: undefined,
    line: `bot ${commit.slice(0, 7)}`,
    entries: [{ service: "bot", commit: sha(commit) }],
    taggedAt: new Date(NOW - (index * 0.6 + 0.2) * 86_400_000).toISOString(),
    history: {
      ranges: [],
      changes: changes.map(([number, title]) => ({ repo: "appdev", number, title })),
      commitCount: changes.length,
      outsideCommitCount: 0,
    },
  };
});
const RELAY_RUNNING: Deployment = {
  kind: "running",
  activatedAt: new Date(NOW - 7_200_000).toISOString(),
  version: deployedVersion(`${sha(RELAY_COMMITS[0] ?? "")} v0.1.7 wren`),
};
/** What each carried, as HQ compared it: its changes, a commit each. */
const RELAY_CARRIED: ReadonlyMap<string, MovedCommits> = new Map(
  RELAY_RELEASES.map((release, index) => {
    const commits = (RELAY_CHANGES[index] ?? []).map(([number, title]) =>
      commit(`${title} (#${String(number)})`, `${String(number)}f0e1d2`, index * 14 + 5, "wren"),
    );
    return [
      release.tag,
      {
        state: "known",
        moved: [
          {
            repository: "appdev",
            services: ["bot"],
            commits,
            total: commits.length,
            truncated: false,
          },
        ],
      },
    ];
  }),
);
const RELAY_ROUTES = [
  { service: "bot", port: 3000, host: "relay.acme.example", url: "https://relay.acme.example" },
  {
    service: "bot",
    port: 3000,
    host: "bot-5c1e-3000.prg1.zerops.app",
    url: "https://bot-5c1e-3000.prg1.zerops.app",
  },
];

/** Three changes merged since v0.1.13, waiting for a release that goes live. */
const MERGED_THREE = [
  {
    ...change(31, "Keep sign-ins in the database (#17)", "p-juno", 0.3, true),
    pullRequest: {
      number: 17,
      url: "https://github.com/acme/storefront/pull/17",
      state: "merged" as const,
    },
  },
  {
    ...change(30, "Remember who is signed in across restarts (#16)", "p-juno", 2, true),
    pullRequest: {
      number: 16,
      url: "https://github.com/acme/storefront/pull/16",
      state: "merged" as const,
    },
  },
  change(29, "Show the delivery estimate on the product page", "p-raya", 5, true),
];

const READY_THREE_FAILED: CardReady = {
  count: 3,
  changeCount: 3,
  atLeast: false,
  stage: undefined,
  from: "v0.1.13",
  failed: true,
};

/** v0.1.14 on its way over Acme's releases: it carries two of the three merged changes. */
const ACME_RELEASING: ReadonlyArray<FlowRelease> = [
  {
    tag: "v0.1.14",
    verdict: "approved",
    detail: undefined,
    line: `shop ${MEDUSA.slice(0, 7)} · storefront ${STOREFRONT_REFUSED[0].slice(0, 7)}`,
    entries: [
      { service: "shop", commit: sha(MEDUSA) },
      { service: "storefront", commit: sha(STOREFRONT_REFUSED[0]) },
    ],
    taggedAt: new Date(NOW - 3_600_000).toISOString(),
    history: {
      ranges: [],
      changes: [
        { repo: "appdev", number: 30, title: "Remember who is signed in across restarts (#16)" },
        { repo: "appdev", number: 29, title: "Show the delivery estimate on the product page" },
      ],
      commitCount: 2,
      outsideCommitCount: 0,
    },
  },
  ...ACME_RELEASES,
];

/** Fifteen people who reach Acme's production, as its access reads them: two set, the rest by default. */
const ACME_PEOPLE: ReturnType<typeof columnPeople> = {
  label: "Production",
  people: [
    "Juno Park",
    "Raya Stone",
    "Ines Vale",
    "Vale Holt",
    "Theo Lind",
    "Ada Brook",
    "Noa Reed",
    "Kai Moss",
    "Lev Hart",
    "Uma Frost",
    "Ole Finch",
    "Pia West",
    "Rex Dale",
    "Sia Lane",
    "Tom Gale",
  ].map((name, index) => ({
    key: `cu-${String(index)}`,
    userId: `u-${String(index)}`,
    name,
    short: `${name.split(" ")[0] ?? name} ${name.split(" ")[1]?.[0] ?? ""}.`,
    initials: name
      .split(" ")
      .map((part) => part[0])
      .join(""),
    avatarUrl: null,
    email: null,
    role: "Developer",
    pending: false,
    level: index === 3 ? "read" : "full",
    byDefault: index > 4,
  })),
};

/** Acme's six-service production at the widths a page has beside the 435 px menu. */
const SIX_SERVICES = [
  {
    label: "Six services in production",
    note: "A 1786 window, a release ready: Next release over the two merged changes, Live now with what it brought, one row per service with its meters. Vault opens the drawer.",
    width: 1351,
  },
  {
    label: "Six services in production at 1280",
    note: "A 1280 window: the same sections; a service's meters stack in their column.",
    width: 845,
  },
  {
    label: "Six services in production on a phone",
    note: "A phone: each service in three lines — name, type and state; what runs and where; its meters.",
    width: 390,
  },
] as const;

/** Acme's addresses: the storefront on two domains of its own, the shop on its subdomain. */
const ACME_ROUTES = [
  {
    service: "shop",
    port: 9000,
    host: "shop-2ff9-9000.prg1.zerops.app",
    url: "https://shop-2ff9-9000.prg1.zerops.app",
  },
  { service: "storefront", port: 8000, host: "acme.example", url: "https://acme.example" },
  { service: "storefront", port: 8000, host: "www.acme.example", url: "https://www.acme.example" },
];

/** The three changes merged to main that Tea Shop's production does not run. */
const TEASHOP_WAITING = [
  {
    commits: [
      { sha: sha("5e6f7a8b"), subject: "Show the delivery estimate on the product page" },
      { sha: sha("6f7a8b9c"), subject: "Cache the category listing for a minute" },
      { sha: sha("7a8b9c0d"), subject: "Fix the basket total when a coupon is removed" },
    ],
  },
];

const TEASHOP_BEHIND: ReleaseOffer = {
  offered: true,
  releasing: false,
  tag: "v0.1.14",
  reason: undefined,
  onReview: () => {},
};

const TEASHOP_RELEASING: ReleaseOffer = { ...TEASHOP_BEHIND, releasing: true };

/** Tea Shop's production as the platform lists it: every service running what its deploy named. */
const TEASHOP_RUNNING: Deployment = {
  kind: "running",
  activatedAt: new Date(NOW - 7_200_000).toISOString(),
  version: deployedVersion(`${sha(NEXTSTORE[0])} v0.1.13 wren`),
};

/** The nextstore commit v0.1.14 listed, whose production deploy failed. */
const NEXTSTORE_FAILED = "9c41d2e0";

/** v0.1.14 tagged on top of Tea Shop's releases: only the newest tag's time is read. */
const TEASHOP_FAILED_RELEASES: ReadonlyArray<FlowRelease> = [
  {
    tag: "v0.1.14",
    verdict: "approved",
    detail: undefined,
    line: `medusa ${MEDUSA.slice(0, 7)} · nextstore ${NEXTSTORE_FAILED.slice(0, 7)}`,
    entries: [
      { service: "medusa", commit: sha(MEDUSA) },
      { service: "nextstore", commit: sha(NEXTSTORE_FAILED) },
    ],
    taggedAt: new Date(NOW - 600_000).toISOString(),
  },
  ...TEASHOP_RELEASES,
];

/**
 * Tea Shop's two repositories as their default branches read, newest first: every commit a release
 * names, and the ones merged between them. v0.1.14 and every release down to v0.1.10 moved
 * nextstore alone; v0.1.9 moved both, medusa for the last time.
 */
const NEXTSTORE_BRANCH = [
  commit("Move the checkout to the new payment API", NEXTSTORE_FAILED, 0.5, "mate-p-theo"),
  commit("Show the size guide on every product page", "8b3a1c07", 3, "wren"),
  commit("Fix the basket badge on mobile", NEXTSTORE[0], 5, "wren"),
  commit("Translate the footer into Czech", "2d4e6f80", 8, "mate-p-theo"),
  commit("Lazy-load the product gallery", NEXTSTORE[1], 20, "mate-p-theo"),
  commit("Add Apple Pay to the checkout", NEXTSTORE[2], 30, "wren"),
  commit("Round prices to whole crowns", "3c5e7a91", 34, "wren"),
  commit("Filter the catalogue by size", NEXTSTORE[3], 50, "mate-p-theo"),
  commit("Cache the category pages", NEXTSTORE[4], 70, "wren"),
  commit("Show delivery times at checkout", "5a6b7c8d", 80, "mate-p-theo"),
  commit("Wire the storefront to the Medusa store API", NEXTSTORE[5], 100, "wren"),
  commit("Start the storefront", NEXTSTORE[6], 120, "wren"),
  commit("Initial commit", "1f2e3d4c", 130, "wren"),
];

const MEDUSA_BRANCH = [
  commit("Add the Czech VAT rates to the tax provider", MEDUSA, 60, "mate-p-theo"),
  commit("Send the order confirmation from the new template", "6d7e8f90", 64, "wren"),
  commit("Seed the Tea Shop product catalogue", "7e8f9a0b", 90, "wren"),
  commit("Configure the Medusa backend for Tea Shop", "1a2b3c4d", 110, "wren"),
  commit("Initial commit", "0a1b2c3d", 130, "wren"),
];

/** Tea Shop's repositories, newest first, as HQ holds them. */
const TEASHOP_BRANCHES: ReadonlyMap<string, ReadonlyArray<CompareCommit>> = new Map([
  ["medusadev", MEDUSA_BRANCH],
  ["nextstoredev", NEXTSTORE_BRANCH],
]);
const TEASHOP_REPOSITORY_OF = new Map([
  ["medusa", "medusadev"],
  ["nextstore", "nextstoredev"],
]);

/**
 * What each release carried, as HQ would compare it (`carriedReads`): a repository's commits from
 * the release before's down to its own, sliced off its branch.
 */
function carriedOf(releases: ReadonlyArray<FlowRelease>): ReadonlyMap<string, MovedCommits> {
  return new Map(
    [...carriedReads({ releases, repositoryOf: TEASHOP_REPOSITORY_OF })].map(([tag, reads]) => {
      const moved = reads.map((read) => {
        const branch = TEASHOP_BRANCHES.get(read.repository) ?? [];
        const head = branch.findIndex((entry) => entry.sha === read.query.head);
        const base = branch.findIndex((entry) => entry.sha === read.query.base);
        const commits = branch.slice(head, base === -1 ? branch.length : base);
        return {
          repository: read.repository,
          services: read.services,
          commits,
          total: commits.length,
          truncated: false,
        };
      });
      return [tag, { state: "known", moved }];
    }),
  );
}

/** Every release answering the same, for the rows that say nothing more yet. */
const carriedAs = (
  releases: ReadonlyArray<FlowRelease>,
  state: MovedCommits,
): ReadonlyMap<string, MovedCommits> => new Map(releases.map(({ tag }) => [tag, state]));

/** A stage the platform lists, each service running what its deploy named. */
const STAGE_RUNNING: Deployment = {
  kind: "running",
  activatedAt: new Date(NOW - 7_200_000).toISOString(),
  version: deployedVersion(sha("b21d904c")),
};

interface StopFixture {
  readonly deployAnswer?: HqDeployAnswer;
  readonly notInZerops?: ReadonlyArray<string>;
  readonly tier: EnvironmentRow["tier"];
  /** The project's name; Shop unless the fixture is Tea Shop's. */
  readonly group?: string;
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  /**
   * What the platform says the stop runs; unread unless given. Its services are listed the way
   * `useStopServices` lists them: each running what its own deploy named, unless `platform` says
   * otherwise for it.
   */
  readonly deployment?: Deployment;
  /** A service's own deployment where it differs from what its deploy named. */
  readonly platform?: Readonly<Record<string, Deployment>>;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers?: ReadonlyArray<ZeropsRouteOffer>;
  readonly release?: ReleaseOffer;
  /** What production does not run yet, per service; production only. */
  readonly waiting?: ReadonlyArray<{
    readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  }>;
  /** The tag being released; production only. */
  readonly releasing?: string;
  /** Whether the person may ask HQ to run the failed deploy again, so the verdict offers it. */
  readonly mayRunAgain?: boolean;
  /** Whether the deploy key HQ holds for the stop no longer works. */
  readonly keyInvalid?: boolean;
  /** Whether HQ holds a deploy key for the stop; held unless given. */
  readonly keyHeld?: boolean;
  /** Whether the person may keep the stop's deploy key. */
  readonly mayKeep?: boolean;
  /** The key's renewal offered from the verdict, and where a run of it stands. */
  readonly renewKey?: KeyRenewal;
  /** What the platform runs or holds waiting there now. */
  readonly runningNow?: ReadonlyArray<RunningLine>;
  readonly history?: ZeropsHistoryState;
  /** A production's releases, newest first. */
  readonly releases?: ReadonlyArray<FlowRelease>;
  /** What each of a production's releases carried; the rows are shas without it. */
  readonly carried?: ReadonlyMap<string, MovedCommits>;
  /** The production deploys that failed, each as a release's. */
  readonly failedDeploys?: ReadonlyArray<ReleaseDeployFailure>;
  readonly releasedAge?: string;
  /** Every service the platform lists there, with its use and its last day. */
  readonly platformServices?: ReadonlyArray<ZeropsServiceRow>;
  /** Who reaches the place, as its page draws them. */
  readonly access?: React.ComponentProps<typeof ZeropsStopPane>["access"];
  /** Whether the place offers its vault drawer; `"open"` draws it open. */
  readonly vault?: boolean | "open";
  /** The changes that go next: merged ones waiting for a release, or a stage's open ones. */
  readonly next?: ReadonlyArray<FlowPullRequest>;
  /** What waits for production's next release. */
  readonly ready?: CardReady;
  /** Who made the live release. */
  readonly liveBy?: string;
  /** The place's line as the overview says it; the page's own reads otherwise. */
  readonly line?: PlaceLineData;
  /** The person's own Mate a failure is offered to, by name. */
  readonly fixer?: string;
  /** The releases whose services HQ could not create in production first. */
  readonly creationFailures?: ReadonlyArray<ReleaseCreationFailure>;
  /** False where HQ declares no service for the place: its page lists the platform's own. */
  readonly declared?: boolean;
  /** Whether the reads the services wait on have answered; answered unless given. */
  readonly servicesRead?: boolean;
  /** Where HQ's answer of the releases stands; known unless given. */
  readonly releasesRead?: React.ComponentProps<typeof ZeropsStopPane>["releasesRead"];
}

/** Acme production's vault, its values the vault fixture's. */
const HARNESS_VAULT = {
  orgId: "harness",
  body: (
    <VaultPanelBody
      actor="environment"
      impactOf={(scope, write) => vaultFixtureImpact(VAULT_FIXTURE, scope, write)}
      onRestart={() => Promise.resolve()}
      onWrite={() => Promise.resolve({ ok: true })}
      pending={new Map()}
      restarting={new Set()}
      view={VAULT_FIXTURE}
      who={{ kind: "environment", name: "Production" }}
    />
  ),
};

/** The full commit each service runs, as the release rows and the stop's name read it. */
function runningCommits(
  services: ReadonlyArray<EnvironmentServiceState>,
): ReadonlyMap<string, string> {
  const running = new Map<string, string>();
  for (const entry of services) {
    const commit = deployedCommit(entry.appVersionName);
    if (commit !== undefined) running.set(entry.hostname, commit);
  }
  return running;
}

/**
 * The platform's listing of the stop's services, as `useStopServices` hands it to the page: read
 * when the stop's own deployment is, each service running the version its deploy named — or, on a
 * stop nothing runs on, nothing.
 */
function platformListing(fixture: StopFixture): Shown<ReadonlyArray<StopService>> {
  const { deployment } = fixture;
  if (deployment === undefined) return UNREAD_LISTING;
  const activatedAt = deployment.kind === "running" ? deployment.activatedAt : null;
  return known(
    fixture.services.map((entry) => ({
      service: platformService(`svc-${entry.hostname}`),
      hostname: entry.hostname,
      deployment: known(
        fixture.platform?.[entry.hostname] ??
          (deployment.kind === "none"
            ? deployment
            : {
                kind: "running",
                activatedAt,
                version: deployedVersion(entry.appVersionName),
              }),
      ),
    })),
  );
}

const UNREAD_LISTING: Shown<ReadonlyArray<StopService>> = { state: "unread", waitingFor: null };

/** A service of the harness's one pretend project, as the platform's listing refers to it. */
function platformService(id: string): StopService["service"] {
  return {
    kind: "service",
    project: {
      kind: "project",
      organization: {
        kind: "organization",
        account: {
          apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
          accountId: ZeropsAccountId.make("harness"),
        },
        organizationId: ZeropsOrganizationId.make("harness"),
      },
      projectId: ZeropsProjectId.make("harness"),
    },
    serviceId: ZeropsServiceId.make(id),
  };
}

/**
 * A stop's page as its page would hand it over: every line the producers', none the harness's.
 * The stop's name, its release rows and its failure are derived the way the flow and the page
 * derive them, so a fixture differs only in what it reads.
 */
const runningSince = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const RUNNING_NOW: ReadonlyArray<RunningLine> = [
  {
    id: "process-api",
    service: "api",
    words: "Deploying v0.1.4",
    doing: "is deploying v0.1.4",
    trail: [
      { label: "Build container", state: "done" },
      { label: "Build", state: "done" },
      { label: "Deploy", state: "busy" },
    ],
    waiting: false,
    behind: undefined,
    since: runningSince(384),
    version: "v0.1.4",
    kind: "build",
    versionId: undefined,
    rank: 3,
  },
  {
    id: "process-app",
    service: "app",
    words: "Building v0.1.4",
    doing: "is building v0.1.4",
    trail: [
      { label: "Build container", state: "done" },
      { label: "Build", state: "busy" },
      { label: "Deploy", state: "waiting" },
    ],
    waiting: false,
    behind: undefined,
    since: runningSince(72),
    version: "v0.1.4",
    kind: "build",
    versionId: undefined,
    rank: 2,
  },
  {
    id: "process-db",
    service: "db",
    words: "Restarting",
    doing: "is restarting",
    trail: undefined,
    waiting: false,
    behind: undefined,
    since: runningSince(9),
    version: undefined,
    kind: "other",
    versionId: undefined,
    rank: 2,
  },
  {
    id: "process-app-next",
    service: "app",
    words: "Waiting",
    doing: "waits for its restart",
    trail: undefined,
    waiting: true,
    behind: "its build of v0.1.4",
    since: runningSince(4),
    version: undefined,
    kind: "other",
    versionId: undefined,
    rank: 0,
  },
];

function StopState({ fixture }: { readonly fixture: StopFixture }) {
  const [vaultOpen, setVaultOpen] = useState(fixture.vault === "open");
  const production = fixture.tier === "production";
  const name = production ? "production" : "stage";
  const group = fixture.group ?? "Shop";
  const running = runningCommits(fixture.services);
  const listing = production ? (fixture.releases ?? []) : [];
  const row = environmentRow({
    projectId: `${group}-${name}`,
    name,
    tier: fixture.tier,
    sources: production ? "release" : ["main"],
    services: fixture.services,
  });
  const live = releaseRunBy(listing, running);
  const stop = production && live !== undefined ? nameStopByRelease(row, live) : row;
  const releases = listing.map((entry, index) =>
    releaseRow(entry, index, {
      production: running,
      failed: fixture.failedDeploys ?? [],
      live: entry.tag === live,
    }),
  );
  const view = stopView({
    deployment:
      fixture.deployment === undefined
        ? { state: "unread", waitingFor: null }
        : known(fixture.deployment),
    row: stop,
    nowMs: NOW,
  });
  const routes = fixture.routes ?? [];
  const release = fixture.release ?? RELEASE_NONE;
  const waiting = production ? (fixture.waiting ?? []).flatMap((entry) => entry.commits) : [];
  const history = fixture.history ?? HISTORY;
  const mainHead = !production && history.kind === "read" ? history.commits[0]?.sha : undefined;
  const notCreated = releaseNotCreated({
    tier: fixture.tier,
    releases,
    services: fixture.services,
    creationFailures: fixture.creationFailures,
    missing: fixture.notInZerops ?? [],
  });
  const services = serviceRows({
    environment: name,
    services: fixture.services,
    platform: platformListing(fixture),
    mainHead,
    routes,
    offers: fixture.offers ?? [],
    nowMs: NOW,
    age: () => "2h ago",
    notCreated: notCreated?.tag,
  });
  const failedDeploys = stopFailedDeploys({ tier: fixture.tier, rows: services, releases });
  const askedAgain = notCreated === undefined ? failedDeploys : [];
  const failed = failedDeploys.map((entry) => ({
    ...entry,
    mayRunAgain: fixture.mayRunAgain ?? false,
  }));
  const [onlyFailed] = askedAgain.length === 1 ? failed : [];
  // While a release is on its way, the changes it carries; the rest are counted, as the page does.
  const onItsWay =
    fixture.releasing === undefined || fixture.next === undefined
      ? undefined
      : changesOfRelease(
          fixture.next,
          releases.find((entry) => entry.tag === fixture.releasing),
        );
  return (
    <ZeropsStopPane
      deployAnswer={fixture.deployAnswer}
      notInZerops={fixture.notInZerops}
      addService={{ running: () => false, onAdd: () => {} }}
      deployAgain={{ running: () => false, onDeployAgain: () => {} }}
      carried={production ? fixture.carried : undefined}
      trail={trail(group, production ? "Production" : "Stage")}
      deployed={new Map(stop.version.sha === undefined ? [] : [[name, stop.version.sha]])}
      enablingServiceId={null}
      groupId={group.toLowerCase()}
      history={history}
      names={NAMES}
      onEnableRoute={() => {}}
      onRollBack={() => {}}
      pending={new Set()}
      release={release}
      releases={releases}
      repo={production ? undefined : "appdev"}
      routeTrouble={null}
      routes={routes}
      runAgain={
        onlyFailed?.redeploy !== undefined && onlyFailed.mayRunAgain
          ? { running: false, refused: null, onRunAgain: () => {} }
          : undefined
      }
      services={fixture.declared === false ? undefined : rowsRunningAgain(services, askedAgain)}
      servicesRead={fixture.servicesRead}
      releasesRead={fixture.releasesRead}
      laterChanges={onItsWay?.later}
      releasesNotDeployed={releasesNotDeployed({
        releases,
        failures: fixture.failedDeploys,
        services: fixture.services,
      })}
      stop={stop}
      tags={TAGS}
      trouble={null}
      renewKey={
        fixture.renewKey === undefined ? undefined : { run: fixture.renewKey, onRenew: () => {} }
      }
      runningNow={fixture.runningNow}
      verdict={stopVerdict({
        tier: fixture.tier,
        view,
        releasing: fixture.releasing,
        failed,
        waiting: waiting.length,
        waitingAtLeast: false,
        untold: [],
        release,
        releasedAge: fixture.releasedAge,
        since: view.activatedAt === null ? undefined : "2h ago",
        atMainHead: !production && sameCommit(view.version?.sha, mainHead),
        keyGap: keyGapOf(
          stopKeyGap({
            keyHeld: fixture.keyHeld ?? true,
            keyInvalid: fixture.keyInvalid ?? false,
            mayKeep: fixture.mayKeep,
            project: stop.name,
          }),
          fixture.renewKey !== undefined,
        ),
        notCreated,
      })}
      view={view}
      untold={[]}
      waiting={{ commits: waiting, total: waiting.length, atLeast: false }}
      platformServices={fixture.platformServices}
      usageRead
      access={fixture.access}
      groupName={group}
      vault={
        fixture.vault === undefined || fixture.vault === false
          ? undefined
          : { ...HARNESS_VAULT, open: vaultOpen, onOpenChange: setVaultOpen }
      }
      releasing={fixture.releasing}
      deployFailed={failedDeploys.length > 0}
      ready={fixture.ready}
      nextChanges={onItsWay?.carried ?? fixture.next}
      faces={mateFace}
      mateName={(mateProjectId) => MATES[mateProjectId]?.name}
      onOpenPull={() => {}}
      liveBy={fixture.liveBy}
      line={fixture.line}
      askToFix={
        fixture.fixer === undefined ? undefined : { mateName: fixture.fixer, onAsk: () => {} }
      }
    />
  );
}

/** The key's gap as the page hands it to the verdict: with whether the viewer may renew it. */
const keyGapOf = (gap: ReturnType<typeof stopKeyGap>, mayRenew: boolean) =>
  gap === undefined ? undefined : { ...gap, mayRenew };

function State({
  label,
  note,
  children,
}: {
  readonly label: string;
  readonly note: string;
  readonly children: React.ReactNode;
}) {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (ONLY !== null) return ONLY === id ? <>{children}</> : null;
  return (
    <section className="flex flex-col gap-2" data-detail-harness-state={label} id={id}>
      <div className="px-2">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <p className="text-xs text-muted-foreground/78">{note}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

/** A production that is a Git branch: Mate pushes each release to it. */
const GIT_PRODUCTION = {
  id: HqEnvironmentId.make("git-prod"),
  name: "Production",
  tier: "production" as const,
  target: { kind: "git" as const, branch: "live", delivery: "direct" as const },
  sources: ["release"],
  order: 1,
  keyHeld: false,
  keyInvalid: false,
  jobs: [],
  birth: null,
  release: null,
};

const GIT_REPOS = [
  {
    name: "web",
    mainHead: null,
    updatedAt: "2026-10-14T10:00:00Z",
    remote: {
      url: "https://github.com/acme/tea-shop.git",
      repositoryId: "123",
      keptAt: "2026-10-14T10:00:00Z",
      keptBy: "wren",
      expiresAt: null,
      invalidSince: null,
    },
  },
];

const GIT_RELEASES = ["v0.2.1", "v0.2.0", "v0.1.9"].map((tag, index) => ({
  tag,
  sha: sha(`a${String(index)}c4e`),
  entries: [{ service: "web", sha: sha(`b${String(index)}d5f`) }],
  by: "u-1",
  at: new Date(NOW - (index + 1) * 86_400_000).toISOString(),
  state: "approved" as const,
  reason: null,
  rollbackOf: null,
}));

/**
 * `?only=<a state's id>`: that state alone, as the app frames a page — beside the menu's 435 px,
 * the page scrolling in its own region — so it can be looked at at the reference viewport.
 */
const ONLY = new URLSearchParams(location.search).get("only");

function Harness() {
  if (ONLY !== null)
    return (
      <div className="flex h-dvh bg-background text-foreground">
        <aside className="w-[435px] shrink-0 border-e border-border bg-sidebar" />
        <main className="min-w-0 flex-1 overflow-y-auto bg-background" data-slot="sidebar-inset">
          <HarnessStates />
        </main>
      </div>
    );
  return (
    <div className="flex flex-col gap-10 bg-background p-6">
      <HarnessStates />
    </div>
  );
}

function HarnessStates() {
  return (
    <>
      {(["building", "queued", "refused", "skipped"] as const).map((state) => (
        <State
          key={state}
          label={`Deploy answer · ${state}`}
          note="Run again / Deploy again: the answer replaces the service's streamed job line."
        >
          <StopState
            fixture={{
              tier: "stage",
              services: [service("api", "b21d904c", undefined, state)],
              deployAnswer: {
                jobs: [
                  {
                    environment: "stage",
                    kind: "deploy",
                    service: "api",
                    sha: sha("b21d904c"),
                    job: "1",
                    state,
                    processId: state === "building" ? "process-1" : null,
                    behind: state === "queued" ? "0" : null,
                    reason:
                      state === "refused"
                        ? "Zerops did not answer: timeout."
                        : state === "skipped"
                          ? "No recipe at this commit."
                          : null,
                  },
                ],
                note: null,
              },
            }}
          />
        </State>
      ))}
      <State
        label="Deploy answer · Add service"
        note="A service not yet listed keeps its answer in Services, beside Add."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [service("api", "b21d904c", undefined)],
            notInZerops: ["db"],
            deployAnswer: {
              jobs: [
                {
                  environment: "stage",
                  kind: "delta",
                  service: null,
                  sha: null,
                  job: "2",
                  state: "building",
                  processId: "process-2",
                  behind: null,
                  reason: null,
                },
              ],
              note: "The preview tier could not be read.",
            },
          }}
        />
      </State>

      <State
        label="A stop, checking what runs"
        note="The platform has not answered yet and no deploy has named a version: the stop holds its line."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Tea Shop",
            services: [
              service("medusa", undefined, undefined, "live", "medusadev"),
              service("nextstore", undefined, undefined, "live", "nextstoredev"),
            ],
            releases: TEASHOP_RELEASES,
            carried: carriedOf(TEASHOP_RELEASES),
          }}
        />
      </State>

      <State
        label="A production nothing was deployed to"
        note="No release was cut and no tier builds a service here yet: Services says None yet."
      >
        <StopState
          fixture={{
            tier: "production",
            services: [],
            deployment: NOTHING_RUNS,
          }}
        />
      </State>

      <State
        label="A stage nothing was deployed to"
        note="The dead end the menu draws as a grey dot; the verdict says what fills it, and each code service says it once, in its commit's place."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [service("api", undefined, undefined), service("app", undefined, undefined)],
            offers: [{ service: "api", serviceId: "svc-api", port: 8080 }],
            deployment: NOTHING_RUNS,
            history: { kind: "read", commits: [], total: 0 },
          }}
        />
      </State>

      <State
        label="A stage, deploying"
        note="A build of b21d904 runs for api: the verdict, the menu and its row read Deploying…, and the row keeps 5c3ea18, which runs until the build lands."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined, "building"),
              service("app", "5c3ea18b", undefined),
            ],
            deployment: {
              kind: "deploying",
              version: deployedVersion(sha("b21d904c")),
              previous: null,
            },
            platform: {
              api: {
                kind: "deploying",
                version: deployedVersion(sha("b21d904c")),
                previous: {
                  kind: "running",
                  activatedAt: null,
                  version: deployedVersion(sha("5c3ea18b")),
                },
              },
            },
            routes: ROUTES,
          }}
        />
      </State>

      <State
        label="A production, releasing"
        note="v0.1.14 was tagged and its deploy has not been read back: the one verb waits."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Tea Shop",
            services: TEASHOP_LIVE,
            routes: TEASHOP_ROUTES,
            release: TEASHOP_RELEASING,
            waiting: TEASHOP_WAITING,
            releasing: "v0.1.14",
            releases: TEASHOP_RELEASES,
            carried: carriedOf(TEASHOP_RELEASES),
          }}
        />
      </State>

      <State
        label="A stage whose deploy failed, for one who may run it again"
        note="HQ records api's newest deploy failed: the verdict names the service and asks HQ to run it again."
      >
        <StopState
          fixture={{
            fixer: "Juno",
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined, "failed"),
              service("app", "5c3ea18b", undefined),
            ],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
            mayRunAgain: true,
          }}
        />
      </State>

      <State
        label="A stage whose deploy key no longer works"
        note="HQ records the key it deploys the stage with as broken: the verdict names who mints a new one, and offers no Run again — HQ would refuse it."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined, "failed"),
              service("app", "5c3ea18b", undefined),
            ],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
            mayRunAgain: true,
            keyInvalid: true,
          }}
        />
      </State>

      <State
        label="A production with a release on its way, its platform at work"
        note="Running now stands over the services while anything runs or waits there, a line each: the service, what it is, where its build stands, how long. It takes no room while nothing runs."
      >
        <StopState
          fixture={{
            tier: "production",
            services: [
              service("api", "b21d904c", undefined),
              service("app", "5c3ea18b", undefined),
            ],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
            runningNow: RUNNING_NOW,
          }}
        />
      </State>

      <State
        label="A stage deploying a merge"
        note="The same group on a stage: one build, its three parts, its clock."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [service("app", "5c3ea18b", undefined)],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
            runningNow: RUNNING_NOW.slice(1, 2),
          }}
        />
      </State>

      {(
        [
          ["for one who may renew it", { kind: "none" }],
          ["being renewed", { kind: "working" }],
          ["renewed, before HQ says so", { kind: "renewed" }],
          [
            "whose renewal failed",
            {
              kind: "failed",
              words:
                "Zerops did not confirm the new key; check production's access tokens in Zerops, then renew again.",
            },
          ],
        ] as const
      ).map(([words, run]) => (
        <State
          key={words}
          label={`A production whose deploy key no longer works, ${words}`}
          note="The verdict offers the renewal the release sheet offers, to one with admin access to the project: its button, busy while it runs, its failure under it, and Key renewed until HQ reports the key works."
        >
          <StopState
            fixture={{
              tier: "production",
              services: [
                service("api", "b21d904c", undefined),
                service("app", "5c3ea18b", undefined),
              ],
              deployment: STAGE_RUNNING,
              routes: ROUTES,
              keyInvalid: true,
              renewKey: run,
            }}
          />
        </State>
      ))}

      <State
        label="A stage with no deploy key yet, for one who may not mint it"
        note="HQ holds no key to deploy the stage with: the verdict names who mints one. One who may mint it is offered the mint instead."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined, "failed"),
              service("app", "5c3ea18b", undefined),
            ],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
            keyHeld: false,
            mayKeep: false,
          }}
        />
      </State>

      <State
        label="A stage whose deploy failed, for one who may not run it again"
        note="HQ's rule offers Run again only to who develops the application: no verb."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined, "failed"),
              service("app", "5c3ea18b", undefined),
            ],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
          }}
        />
      </State>

      <State
        label="A stage whose deploys failed on two parts"
        note="Every failed part is named, each row with its own Run again; the verdict holds no verb."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined, "failed"),
              service("app", "b21d904c", undefined, "failed"),
              service("worker", "5c3ea18b", undefined),
            ],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
            mayRunAgain: true,
          }}
        />
      </State>

      {SIX_SERVICES.map(({ label, note, width }) => (
        <State key={label} label={label} note={note}>
          <div style={{ maxWidth: width }}>
            <StopState
              fixture={{
                tier: "production",
                group: "Acme",
                services: ACME_LIVE,
                deployment: TEASHOP_RUNNING,
                routes: ACME_ROUTES,
                releases: ACME_RELEASES,
                platformServices: ACME_SERVICES,
                access: { summary: ACME_PEOPLE, line: null },
                vault: true,
                release: RELEASE_WAITING,
                ready: READY_TWO,
                next: MERGED_WAITING,
                liveBy: "Dana K.",
              }}
            />
          </div>
        </State>
      ))}

      <State
        label="A production that is down"
        note="The platform says a service failed and no deploy did: the header's Down, said once as a failure, with the person's own Mate offered to fix it."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Acme",
            services: ACME_LIVE,
            deployment: TEASHOP_RUNNING,
            routes: ACME_ROUTES,
            releases: ACME_RELEASES,
            platformServices: ACME_SERVICES,
            fixer: "Juno",
            line: {
              projectId: "acme-production",
              kind: "production",
              name: "prod",
              dot: "down",
              words: ["Down", "shop failed"],
              trouble: true,
              addresses: [],
            },
          }}
        />
      </State>

      <State
        label="A production whose release failed to deploy"
        note="Tea Shop: v0.1.14's nextstore deploy failed and nextstore runs on v0.1.13 — the verdict says so, and the release row reads Deploy failed."
      >
        <StopState
          fixture={{
            fixer: "Juno",
            tier: "production",
            group: "Tea Shop",
            services: TEASHOP_LIVE,
            deployment: TEASHOP_RUNNING,
            routes: TEASHOP_ROUTES,
            releases: TEASHOP_FAILED_RELEASES,
            carried: carriedOf(TEASHOP_FAILED_RELEASES),
            failedDeploys: [{ tag: "v0.1.14", service: "nextstore", sha: sha(NEXTSTORE_FAILED) }],
          }}
        />
      </State>

      <State
        label="A production whose change was released again"
        note="Relay: v0.1.4 and v0.1.5 didn't go live, v0.1.6 carried the same change and did, v0.1.7 went live after it. A failure with a live release after it is history; a release of the same changes says so."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Relay",
            services: [service("bot", RELAY_COMMITS[0], "v0.1.7", "live", "appdev"), managed("db")],
            deployment: RELAY_RUNNING,
            routes: RELAY_ROUTES,
            releases: RELAY_RELEASES,
            carried: RELAY_CARRIED,
            failedDeploys: (["v0.1.5", "v0.1.4"] as const).map((tag) => ({
              tag,
              service: "bot",
              sha: sha(RELAY_COMMITS[1] ?? ""),
              refused: true,
            })),
            access: { summary: ACME_PEOPLE, line: null },
            release: { ...RELEASE_WAITING, tag: "v0.1.8" },
            ready: READY_TWO,
            next: MERGED_WAITING,
            liveBy: "Dana K.",
          }}
        />
      </State>

      <State
        label="A production whose releases were refused on a missing service"
        note="Acme: v0.1.14 and v0.1.15 needed a db production does not have, and HQ refused every deploy of both. One sentence says it, cause first, with no Run again; the next release keeps its ordinary card and verb; the storefront keeps its calm line; db stands as a slot the next release creates."
      >
        <StopState
          fixture={{
            fixer: "Juno",
            tier: "production",
            group: "Acme",
            services: ACME_WITHOUT_DB,
            deployment: TEASHOP_RUNNING,
            routes: ACME_ROUTES,
            releases: ACME_REFUSED_RELEASES,
            failedDeploys: [
              {
                tag: "v0.1.15",
                service: "storefront",
                sha: sha(STOREFRONT_REFUSED[1]),
                refused: true,
              },
              {
                tag: "v0.1.14",
                service: "storefront",
                sha: sha(STOREFRONT_REFUSED[0]),
                refused: true,
              },
            ],
            creationFailures: [
              {
                tag: "v0.1.15",
                reason: "Zerops did not create db: its type is not offered.",
                services: ["db"],
              },
            ],
            notInZerops: ["db"],
            platformServices: ACME_SERVICES.filter((row) => row.service.hostname !== "db"),
            access: { summary: ACME_PEOPLE, line: null },
            mayRunAgain: true,
            release: { ...RELEASE_WAITING, tag: "v0.1.16" },
            ready: READY_THREE_FAILED,
            next: MERGED_THREE,
            liveBy: "Dana K.",
          }}
        />
      </State>

      <State
        label="A production putting a release live"
        note="Acme: v0.1.14 is on its way with two changes; a third merged after it was made. The section says Releasing now, the card lists the release's own two, one quiet line counts the third, and v0.1.14's row says Releasing."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Acme",
            services: ACME_LIVE,
            deployment: TEASHOP_RUNNING,
            routes: ACME_ROUTES,
            releases: ACME_RELEASING,
            releasing: "v0.1.14",
            release: { ...TEASHOP_RELEASING, inFlight: "v0.1.14" },
            platformServices: ACME_SERVICES,
            access: { summary: ACME_PEOPLE, line: null },
            next: MERGED_THREE,
            liveBy: "Dana K.",
          }}
        />
      </State>

      <State
        label="A production whose reads have not answered"
        note="The platform's listing and HQ's releases are still being read: the Services slot holds two cards' shape and the Releases slot its rows', never a sentence that goes away."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Acme",
            services: ACME_LIVE,
            deployment: TEASHOP_RUNNING,
            routes: ACME_ROUTES,
            declared: false,
            servicesRead: false,
            releasesRead: "reading",
            access: { summary: ACME_PEOPLE, line: null },
          }}
        />
      </State>

      <State
        label="A production HQ declares nothing for"
        note="The reads answered, HQ declares no service and recorded no release: the platform's own services stand in the same cards, without a commit line, and Releases says what is true."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Acme",
            services: ACME_LIVE,
            deployment: TEASHOP_RUNNING,
            routes: ACME_ROUTES,
            declared: false,
            platformServices: ACME_SERVICES,
            access: { summary: ACME_PEOPLE, line: null },
          }}
        />
      </State>

      <State
        label="A production, behind"
        note="Three changes merged that it does not run: one verb, Release v0.1.14."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Tea Shop",
            services: TEASHOP_LIVE,
            routes: TEASHOP_ROUTES,
            release: TEASHOP_BEHIND,
            waiting: TEASHOP_WAITING,
            releases: TEASHOP_RELEASES,
            carried: carriedOf(TEASHOP_RELEASES),
          }}
        />
      </State>

      <State
        label="A production, live"
        note="Tea Shop: medusa runs v0.1.9's commit, nextstore v0.1.13 — the stop is v0.1.13, the release both run. Two releases wait behind the quiet verb."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Tea Shop",
            services: TEASHOP_LIVE,
            routes: TEASHOP_ROUTES,
            deployment: TEASHOP_RUNNING,
            releases: TEASHOP_RELEASES,
            releasedAge: "1h ago",
            carried: carriedOf(TEASHOP_RELEASES),
          }}
        />
      </State>

      <State
        label="A production, its releases being compared"
        note="HQ has not compared what the releases carried yet: each row is its shas."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Tea Shop",
            services: TEASHOP_LIVE,
            routes: TEASHOP_ROUTES,
            deployment: TEASHOP_RUNNING,
            releases: TEASHOP_RELEASES,
            releasedAge: "1h ago",
            carried: carriedAs(TEASHOP_RELEASES, { state: "reading" }),
          }}
        />
      </State>

      <State
        label="A production whose releases HQ would not compare"
        note="The comparison failed: each row is its shas, and its chevron opens onto why."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Tea Shop",
            services: TEASHOP_LIVE,
            routes: TEASHOP_ROUTES,
            deployment: TEASHOP_RUNNING,
            releases: TEASHOP_RELEASES,
            releasedAge: "1h ago",
            carried: carriedAs(TEASHOP_RELEASES, {
              state: "failed",
              reason: "HQ is not answering right now.",
            }),
          }}
        />
      </State>

      <State
        label="A Git production"
        note="A production that is a branch of the project's repository: the same header and sections, its delivery first, then the releases Mate pushed."
      >
        <DetailShell
          summary={
            <PlaceLine
              density="header"
              line={{
                projectId: undefined,
                kind: "production",
                name: "prod",
                dot: "running",
                words: ["Running", "v0.2.1", "released 1d ago"],
                trouble: false,
                addresses: [],
              }}
            />
          }
          title="Production"
          trail={trail("Tea Shop", "Production")}
        >
          <GitStopDetail environment={GIT_PRODUCTION} releases={GIT_RELEASES} repos={GIT_REPOS} />
        </DetailShell>
      </State>

      <State
        label="A stage at the head of main"
        note="It runs main's newest commit: the header says the commit and for how long. Two open changes wait to be merged to it, one ready."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined),
              service("app", "b21d904c", undefined),
              managed("db"),
            ],
            deployment: STAGE_RUNNING,
            routes: ROUTES,
            next: STAGE_OPEN,
            vault: true,
          }}
        />
      </State>

      <State
        label="A stage behind main"
        note="It runs a commit main has moved past; the deploys mark it Running here."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "5c3ea18b", undefined),
              service("app", "5c3ea18b", undefined),
            ],
            routes: ROUTES,
          }}
        />
      </State>

      <State
        label="A stage with a service nobody can reach"
        note="It serves HTTP and answers to nobody. The row that would list its address is the row you add one from."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("api", "b21d904c", undefined),
              service("app", "b21d904c", undefined),
            ],
            routes: ROUTES.filter((route) => route.service === "app"),
            offers: [{ service: "api", serviceId: "svc-api", port: 3000 }],
          }}
        />
      </State>
    </>
  );
}

const appearance = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

/** A failed deploy's log reads the account's projects: stand-ins that hold none. */
function Standins({ children }: { readonly children: ReactNode }) {
  const inventory: Inventory = {
    projects: [],
    isLoading: false,
    error: null,
    projectRefs: new Map(),
    authority: new Map(),
    lost: new Set(),
    deleted: [],
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

/** The harness page, standing in the hosted frame inside a sidebar, so the frame draws no lockup. */
function HarnessPage() {
  return (
    <SidebarProvider className="block">
      <Standins>
        <Harness />
      </Standins>
    </SidebarProvider>
  );
}

// A router of its own, so a place's links (its access card's way to the project page) link as
// they do in the app.
const router = createRouter({
  routeTree: createRootRoute({ component: HarnessPage }),
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
