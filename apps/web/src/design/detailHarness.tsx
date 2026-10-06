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
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  carriedReads,
  deployedCommit,
  deployedVersion,
  environmentRow,
  environmentSlots,
  releaseRunBy,
  nameStopByRelease,
  sameCommit,
  releaseContentsSummary,
  releaseRow,
  type EnvironmentRow,
  type EnvironmentServiceState,
  type FlowPullRequest,
  type FlowRelease,
  type MovedCommits,
  type ReleaseDeployFailure,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";
import {
  serviceRows,
  stopFailedDeploy,
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

import {
  ZeropsGroupPane,
  ZeropsStopPane,
  type ReleaseOffer,
} from "~/components/zerops/ZeropsGroupDetail";
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import type { ZeropsHistoryState } from "~/zerops/useRepositoryHistory";

import { SidebarProvider } from "~/components/ui/sidebar";
import "../index.css";

/** Where these panes sit, as the harness pretends: the chat, then the project. */
const MATES = [
  {
    projectId: "p-theo",
    name: "Theo",
    tint: "amber" as const,
    shape: "hexagon" as const,
    face: "working" as const,
    subject: "Cache the link previews so the list stops flickering",
    snippet: "Keying on locale now, and the tests cover both.",
    when: "1h",
  },
  {
    projectId: "p-iris",
    name: "Iris",
    tint: "violet" as const,
    shape: "clover" as const,
    face: "needs" as const,
    subject: "Split the checkout into two steps",
    snippet: "Which of the two VAT rates should the basket show?",
    when: "12m",
  },
];

const ATTENTION = [
  {
    kind: "mate-waiting" as const,
    text: "Iris is waiting on an answer",
    verb: "Open",
    target: { kind: "mate" as const, projectId: "p-iris" },
  },
  {
    kind: "change-blocked" as const,
    text: "#6 conflicts with main",
    verb: "Ask Theo",
    target: { kind: "change" as const, repository: "appdev", number: 6 },
  },
  {
    kind: "not-live" as const,
    text: "3 changes waiting for production",
    verb: "Release",
    target: undefined,
  },
];

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

const crumbs = (group: string) => [
  { label: "Projects", onClick: () => {} },
  { label: group, onClick: () => {} },
];

const CRUMBS = crumbs("Shop");

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
    commit("Fix the VAT rate table for Ireland", "3f9c1b2e", 20, "ales"),
    commit("Add an index on orders.created_at", "9a7d2f10", 30),
    commit("Stop logging the full card token", "c41b8e55", 48, "Wren"),
  ],
};
/** What v1.4.0 shipped, as HQ's release records name it. */
const TAGS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([[sha("3f9c1b2e"), ["v1.4.0"]]]);

function environment(over: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    projectId: "shop-stage",
    name: "stage",
    tier: "stage",
    source: "main",
    tone: "good",
    version: {
      name: undefined,
      label: "3f9c1b2",
      commit: "3f9c1b2e",
      sha: sha("3f9c1b2e"),
      taggedBy: undefined,
    },
    versionRepository: "appdev",
    ...over,
  } as EnvironmentRow;
}

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 5,
    title: "Cache the link previews so the list stops flickering",
    kind: "code",
    mateProjectId: "p-theo",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: sha("b21d904c"),
    baseBranch: "main",
    line: "appdev #5",
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const WAITING = releaseContentsSummary(
  [
    {
      repository: "appdev",
      services: ["app"],
      commits: [
        "Two-step checkout: the basket step",
        "Fix the VAT rate table for Ireland",
        "Retry the payment webhook three times",
      ].map((subject, index) => ({
        sha: `c${String(index)}`,
        subject,
        authorName: "Juno",
        at: "2026-10-02T10:00:00.000Z",
        change: null,
      })),
      total: 3,
      truncated: false,
    },
  ],
  20,
);
const NOTHING_WAITING = releaseContentsSummary([], 20);

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
      seed === undefined ? undefined : name === undefined ? sha(seed) : `${sha(seed)} ${name} ales`,
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
 * Beviro's production as it was read on 2026-09-25: medusa has run one commit since v0.1.9, and
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
const BEVIRO_RELEASES: ReadonlyArray<FlowRelease> = NEXTSTORE.map((nextstore, index) => {
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
 * What Beviro's production runs: medusa from v0.1.9, nextstore from v0.1.13 — and db, redis and
 * storage, which the platform lists and nothing deploys.
 */
const BEVIRO_LIVE = [
  managed("db"),
  service("medusa", MEDUSA, "v0.1.9", "live", "medusadev"),
  service("nextstore", NEXTSTORE[0], "v0.1.13", "live", "nextstoredev"),
  managed("redis"),
  managed("storage"),
];

const BEVIRO_ROUTES = [
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

/** The three changes merged to main that Beviro's production does not run. */
const BEVIRO_WAITING = [
  {
    commits: [
      { sha: sha("5e6f7a8b"), subject: "Show the delivery estimate on the product page" },
      { sha: sha("6f7a8b9c"), subject: "Cache the category listing for a minute" },
      { sha: sha("7a8b9c0d"), subject: "Fix the basket total when a coupon is removed" },
    ],
  },
];

const BEVIRO_BEHIND: ReleaseOffer = {
  offered: true,
  releasing: false,
  tag: "v0.1.14",
  reason: undefined,
  onReview: () => {},
};

const BEVIRO_RELEASING: ReleaseOffer = { ...BEVIRO_BEHIND, releasing: true };

/** Beviro's production as the platform lists it: every service running what its deploy named. */
const BEVIRO_RUNNING: Deployment = {
  kind: "running",
  activatedAt: new Date(NOW - 7_200_000).toISOString(),
  version: deployedVersion(`${sha(NEXTSTORE[0])} v0.1.13 ales`),
};

/** The nextstore commit v0.1.14 listed, whose production deploy failed. */
const NEXTSTORE_FAILED = "9c41d2e0";

/** v0.1.14 tagged on top of Beviro's releases: only the newest tag's time is read. */
const BEVIRO_FAILED_RELEASES: ReadonlyArray<FlowRelease> = [
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
  ...BEVIRO_RELEASES,
];

/**
 * Beviro's two repositories as their default branches read, newest first: every commit a release
 * names, and the ones merged between them. v0.1.14 and every release down to v0.1.10 moved
 * nextstore alone; v0.1.9 moved both, medusa for the last time.
 */
const NEXTSTORE_BRANCH = [
  commit("Move the checkout to the new payment API", NEXTSTORE_FAILED, 0.5, "mate-p-theo"),
  commit("Show the size guide on every product page", "8b3a1c07", 3, "ales"),
  commit("Fix the basket badge on mobile", NEXTSTORE[0], 5, "ales"),
  commit("Translate the footer into Czech", "2d4e6f80", 8, "mate-p-theo"),
  commit("Lazy-load the product gallery", NEXTSTORE[1], 20, "mate-p-theo"),
  commit("Add Apple Pay to the checkout", NEXTSTORE[2], 30, "ales"),
  commit("Round prices to whole crowns", "3c5e7a91", 34, "ales"),
  commit("Filter the catalogue by size", NEXTSTORE[3], 50, "mate-p-theo"),
  commit("Cache the category pages", NEXTSTORE[4], 70, "ales"),
  commit("Show delivery times at checkout", "5a6b7c8d", 80, "mate-p-theo"),
  commit("Wire the storefront to the Medusa store API", NEXTSTORE[5], 100, "ales"),
  commit("Start the storefront", NEXTSTORE[6], 120, "ales"),
  commit("Initial commit", "1f2e3d4c", 130, "ales"),
];

const MEDUSA_BRANCH = [
  commit("Add the Czech VAT rates to the tax provider", MEDUSA, 60, "mate-p-theo"),
  commit("Send the order confirmation from the new template", "6d7e8f90", 64, "ales"),
  commit("Seed the Beviro product catalogue", "7e8f9a0b", 90, "ales"),
  commit("Configure the Medusa backend for Beviro", "1a2b3c4d", 110, "ales"),
  commit("Initial commit", "0a1b2c3d", 130, "ales"),
];

/** Beviro's repositories, newest first, as HQ holds them. */
const BEVIRO_BRANCHES: ReadonlyMap<string, ReadonlyArray<CompareCommit>> = new Map([
  ["medusadev", MEDUSA_BRANCH],
  ["nextstoredev", NEXTSTORE_BRANCH],
]);
const BEVIRO_REPOSITORY_OF = new Map([
  ["medusa", "medusadev"],
  ["nextstore", "nextstoredev"],
]);

/**
 * What each release carried, as HQ would compare it (`carriedReads`): a repository's commits from
 * the release before's down to its own, sliced off its branch.
 */
function carriedOf(releases: ReadonlyArray<FlowRelease>): ReadonlyMap<string, MovedCommits> {
  return new Map(
    [...carriedReads({ releases, repositoryOf: BEVIRO_REPOSITORY_OF })].map(([tag, reads]) => {
      const moved = reads.map((read) => {
        const branch = BEVIRO_BRANCHES.get(read.repository) ?? [];
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
  /** The project's name; Shop unless the fixture is Beviro's. */
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
  readonly history?: ZeropsHistoryState;
  /** A production's releases, newest first. */
  readonly releases?: ReadonlyArray<FlowRelease>;
  /** What each of a production's releases carried; the rows are shas without it. */
  readonly carried?: ReadonlyMap<string, MovedCommits>;
  /** The production deploys that failed, each as a release's. */
  readonly failedDeploys?: ReadonlyArray<ReleaseDeployFailure>;
  readonly releasedAge?: string;
}

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
function StopState({ fixture }: { readonly fixture: StopFixture }) {
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
  const services = serviceRows({
    environment: name,
    services: fixture.services,
    platform: platformListing(fixture),
    mainHead,
    routes,
    offers: fixture.offers ?? [],
    nowMs: NOW,
    age: () => "2h ago",
  });
  const failedDeploy = stopFailedDeploy({ tier: fixture.tier, rows: services, releases });
  const failed =
    failedDeploy === undefined
      ? undefined
      : { ...failedDeploy, mayRunAgain: fixture.mayRunAgain ?? false };
  return (
    <ZeropsStopPane
      deployAnswer={fixture.deployAnswer}
      notInZerops={fixture.notInZerops}
      addService={{ running: () => false, onAdd: () => {} }}
      deployAgain={{ running: () => false, onDeployAgain: () => {} }}
      carried={production ? fixture.carried : undefined}
      crumbs={crumbs(group)}
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
        failed?.redeploy !== undefined && failed.mayRunAgain
          ? { running: false, refused: null, onRunAgain: () => {} }
          : undefined
      }
      services={services}
      stop={stop}
      tags={TAGS}
      trouble={null}
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
        keyGap: stopKeyGap({
          keyHeld: fixture.keyHeld ?? true,
          keyInvalid: fixture.keyInvalid ?? false,
          mayKeep: fixture.mayKeep,
          project: stop.name,
        }),
      })}
      view={view}
      untold={[]}
      waiting={{ commits: waiting, total: waiting.length, atLeast: false }}
    />
  );
}

function State({
  label,
  note,
  children,
}: {
  readonly label: string;
  readonly note: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-2"
      data-detail-harness-state={label}
      id={label
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "")}
    >
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

const PRODUCTION_ROW = environment({
  projectId: "shop-prod",
  name: "production",
  tier: "production",
  source: "release",
  version: {
    name: "v1.4.0",
    label: "v1.4.0",
    commit: "3f9c1b2e",
    sha: sha("3f9c1b2e"),
    taggedBy: "ales",
  },
});

/**
 * The application page with only its Environments section of interest: the section's rows are
 * `environmentSlots`' answer over the facts a frame sets, and nothing else of the page is drawn but
 * the stops' own rows.
 */
function EnvironmentsFrame({
  environments,
  facts,
  release = RELEASE_NONE,
  waiting = NOTHING_WAITING,
}: {
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly facts: Partial<Parameters<typeof environmentSlots>[0]>;
  readonly release?: ReleaseOffer;
  readonly waiting?: typeof NOTHING_WAITING;
}) {
  return (
    <ZeropsGroupPane
      attention={[]}
      mates={[]}
      onAct={() => {}}
      onAddMate={() => {}}
      onOpenMate={() => {}}
      history={{ kind: "read", commits: [], total: 0 }}
      tags={new Map()}
      environments={environments}
      slots={environmentSlots({
        environments: environments.map((entry) => ({ id: entry.projectId, tier: entry.tier })),
        devstages: [],
        pending: [],
        halfMade: [],
        recipeTiers: ["stage", "production"],
        recipeRead: true,
        offered: { stage: true, production: true },
        productionRuns: "unknown",
        waiting: { count: waiting.total, atLeast: false },
        mainHasCode: true,
        releaseOffered: release.offered,
        releasing: undefined,
        ...facts,
      })}
      onAdd={() => {}}
      onFinish={() => {}}
      finishing={false}
      groupId="shop"
      name="Shop"
      crumbs={CRUMBS}
      names={NAMES}
      onSetUp={() => {}}
      pullRequests={[]}
      release={release}
      repo={undefined}
      waiting={waiting}
    />
  );
}

function Harness() {
  return (
    <div className="flex flex-col gap-10 bg-background p-6">
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

      <State label="A project, running" note="Two stops, one change in flight, three waiting.">
        <ZeropsGroupPane
          attention={ATTENTION}
          mates={MATES}
          onAct={() => {}}
          onAddMate={() => {}}
          onOpenMate={() => {}}
          history={HISTORY}
          tags={TAGS}
          environments={[
            environment(),
            environment({
              projectId: "shop-prod",
              name: "production",
              tier: "production",
              source: "release",
              version: {
                name: "v1.4.0",
                label: "v1.4.0",
                commit: "3f9c1b2e",
                sha: sha("3f9c1b2e"),
                taggedBy: "ales",
              },
            }),
          ]}
          slots={[
            { kind: "environment", tier: "stage", id: "shop-stage", note: undefined },
            {
              kind: "environment",
              tier: "production",
              id: "shop-prod",
              note: { text: "3 changes waiting for production", review: true },
            },
          ]}
          onAdd={() => {}}
          onFinish={() => {}}
          finishing={false}
          groupId="shop"
          name="Shop"
          crumbs={CRUMBS}
          names={NAMES}
          onSetUp={() => {}}
          pullRequests={[
            pull(),
            pull({ number: 6, title: "Bump the linter", mergeability: "conflicting" }),
          ]}
          release={RELEASE_WAITING}
          repo="appdev"
          waiting={WAITING}
        />
      </State>

      <State
        label="A project with nothing set up"
        note="No stops, no changes, no repository: every section is an empty state at once."
      >
        <ZeropsGroupPane
          attention={[]}
          mates={[]}
          onAct={() => {}}
          onAddMate={() => {}}
          onOpenMate={() => {}}
          history={{ kind: "read", commits: [], total: 0 }}
          tags={new Map()}
          environments={[]}
          slots={[
            { kind: "slot", tier: "stage", name: "Stage", line: "Not added", add: true },
            { kind: "slot", tier: "production", name: "Production", line: "Not added", add: true },
          ]}
          onAdd={() => {}}
          onFinish={() => {}}
          finishing={false}
          groupId="fresh"
          name="Design tokens"
          crumbs={CRUMBS}
          names={NAMES}
          onSetUp={() => {}}
          pullRequests={[]}
          release={RELEASE_NONE}
          repo={undefined}
          waiting={NOTHING_WAITING}
        />
      </State>

      <State
        label="Environments · nothing, recipe not ready"
        note="Neither tier is held by the recipe on main yet: both slots say they wait for the Mate's recipe, with no Add."
      >
        <EnvironmentsFrame environments={[]} facts={{ recipeTiers: [] }} />
      </State>
      <State
        label="Environments · nothing, recipe ready"
        note="Two quiet slots, each with its own Add — peers, neither optional, neither first."
      >
        <EnvironmentsFrame environments={[]} facts={{}} />
      </State>
      <State
        label="Environments · stage only"
        note="A stage runs; production is a quiet slot with Add."
      >
        <EnvironmentsFrame environments={[environment()]} facts={{}} />
      </State>
      <State
        label="Environments · a Mate is the stage"
        note="A devstage Mate stands for the stage: its agent deploys, HQ does not. No second stage is offered to a developer."
      >
        <EnvironmentsFrame
          environments={[]}
          facts={{ devstages: [{ id: "vera-dev", name: "Vera" }] }}
        />
      </State>
      <State
        label="Environments · production only, empty"
        note="Production attached, no release yet, main has code: the first release is one press away."
      >
        <EnvironmentsFrame
          environments={[PRODUCTION_ROW]}
          facts={{ productionRuns: "empty" }}
          release={RELEASE_WAITING}
        />
      </State>
      <State
        label="Environments · production only, 3 waiting"
        note="Production runs v1.4.0; three merged changes wait for it."
      >
        <EnvironmentsFrame
          environments={[PRODUCTION_ROW]}
          facts={{ productionRuns: "running" }}
          release={RELEASE_WAITING}
          waiting={WAITING}
        />
      </State>
      <State label="Environments · both" note="A stage and a production: no slots at all.">
        <EnvironmentsFrame
          environments={[environment(), PRODUCTION_ROW]}
          facts={{ productionRuns: "running" }}
        />
      </State>
      <State
        label="Environments · a stage being created"
        note="The stage stands in its slot as being set up; Add is not offered twice."
      >
        <EnvironmentsFrame
          environments={[]}
          facts={{ pending: [{ id: "shop-stage-new", tier: "stage" }] }}
        />
      </State>
      <State
        label="Environments · half-made production"
        note="A project made as the production that HQ does not hold in full: Finish setup, never a second Add."
      >
        <EnvironmentsFrame
          environments={[]}
          facts={{ halfMade: [{ id: "shop-prod", tier: "production", finish: true }] }}
        />
      </State>
      <State
        label="Environments · a person HQ offers no tier"
        note="The same two empty slots, drawn without any Add."
      >
        <EnvironmentsFrame
          environments={[]}
          facts={{ offered: { stage: false, production: false } }}
        />
      </State>

      <State
        label="A stop, checking what runs"
        note="The platform has not answered yet and no deploy has named a version: the stop holds its line."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Beviro",
            services: [
              service("medusa", undefined, undefined, "live", "medusadev"),
              service("nextstore", undefined, undefined, "live", "nextstoredev"),
            ],
            releases: BEVIRO_RELEASES,
            carried: carriedOf(BEVIRO_RELEASES),
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
            group: "Beviro",
            services: BEVIRO_LIVE,
            routes: BEVIRO_ROUTES,
            release: BEVIRO_RELEASING,
            waiting: BEVIRO_WAITING,
            releasing: "v0.1.14",
            releases: BEVIRO_RELEASES,
            carried: carriedOf(BEVIRO_RELEASES),
          }}
        />
      </State>

      <State
        label="A stage whose deploy failed, for one who may run it again"
        note="HQ records api's newest deploy failed: the verdict names the service and asks HQ to run it again."
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
        label="A production whose release failed to deploy"
        note="Beviro: v0.1.14's nextstore deploy failed and nextstore runs on v0.1.13 — the verdict says so, and the release row reads Deploy failed."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Beviro",
            services: BEVIRO_LIVE,
            deployment: BEVIRO_RUNNING,
            routes: BEVIRO_ROUTES,
            releases: BEVIRO_FAILED_RELEASES,
            carried: carriedOf(BEVIRO_FAILED_RELEASES),
            failedDeploys: [{ tag: "v0.1.14", service: "nextstore", sha: sha(NEXTSTORE_FAILED) }],
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
            group: "Beviro",
            services: BEVIRO_LIVE,
            routes: BEVIRO_ROUTES,
            release: BEVIRO_BEHIND,
            waiting: BEVIRO_WAITING,
            releases: BEVIRO_RELEASES,
            carried: carriedOf(BEVIRO_RELEASES),
          }}
        />
      </State>

      <State
        label="A production, live"
        note="Beviro: medusa runs v0.1.9's commit, nextstore v0.1.13 — the stop is v0.1.13, the release both run. Two releases wait behind the quiet verb."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Beviro",
            services: BEVIRO_LIVE,
            routes: BEVIRO_ROUTES,
            deployment: BEVIRO_RUNNING,
            releases: BEVIRO_RELEASES,
            releasedAge: "1h ago",
            carried: carriedOf(BEVIRO_RELEASES),
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
            group: "Beviro",
            services: BEVIRO_LIVE,
            routes: BEVIRO_ROUTES,
            deployment: BEVIRO_RUNNING,
            releases: BEVIRO_RELEASES,
            releasedAge: "1h ago",
            carried: carriedAs(BEVIRO_RELEASES, { state: "reading" }),
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
            group: "Beviro",
            services: BEVIRO_LIVE,
            routes: BEVIRO_ROUTES,
            deployment: BEVIRO_RUNNING,
            releases: BEVIRO_RELEASES,
            releasedAge: "1h ago",
            carried: carriedAs(BEVIRO_RELEASES, {
              state: "failed",
              reason: "HQ is not answering right now.",
            }),
          }}
        />
      </State>

      <State
        label="A stage at the head of main"
        note="It runs main's newest commit, which no release names: the verdict says the commit and for how long, each row says head of main under it, and the database beside it has no row."
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
    </div>
  );
}

document.documentElement.classList.toggle(
  "dark",
  new URLSearchParams(location.search).get("theme") === "dark",
);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      {/* The panes stand in the hosted frame, which outside the app shell
          draws its lockup as a router link; inside a sidebar it draws none,
          so the harness needs no router. */}
      <SidebarProvider className="block">
        <Harness />
      </SidebarProvider>
    </StrictMode>,
  );
}
