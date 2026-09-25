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
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  deployedCommit,
  deployedVersion,
  environmentRow,
  liveRelease,
  nameStopByRelease,
  releaseContentsSummary,
  releaseNamingStop,
  releaseRow,
  type EnvironmentRow,
  type EnvironmentServiceState,
  type FlowPullRequest,
  type FlowRelease,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";
import {
  serviceRows,
  stopVerdict,
  stopView,
  type Deployment,
  type StopView,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import {
  ZeropsGroupPane,
  ZeropsStopPane,
  type ReleaseOffer,
} from "~/components/zerops/ZeropsGroupDetail";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";

import { SidebarProvider } from "~/components/ui/sidebar";
import "../index.css";

/** Where these panes sit, as the harness pretends: the chat, then the project. */
const MATES = [
  {
    projectId: "p-theo",
    name: "Theo",
    tint: "amber" as const,
    face: "working" as const,
    subject: "Cache the link previews so the list stops flickering",
    snippet: "Keying on locale now, and the tests cover both.",
    when: "1h",
  },
  {
    projectId: "p-iris",
    name: "Iris",
    tint: "violet" as const,
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
    text: "#6 needs a rebase",
    verb: "Ask Theo",
    target: { kind: "change" as const, repository: "appdev", number: 6 },
  },
  {
    kind: "not-live" as const,
    text: "3 changes are merged and not live",
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

const NAMES = {
  mateNames: new Map([["p-theo", "Theo"]]),
  groupName: "Shop",
};

const crumbs = (group: string) => [
  { label: "Projects", onClick: () => {} },
  { label: group, onClick: () => {} },
];

const CRUMBS = crumbs("Shop");

const sha = (seed: string) => seed.padEnd(40, "0").slice(0, 40);

function commit(subject: string, seed: string, hoursAgo: number, author = "Theo") {
  return {
    sha: sha(seed),
    subject,
    author,
    at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  };
}

const COMMITS: ZeropsCommitsState = {
  kind: "read",
  commits: [
    commit("Key the preview cache on locale", "b21d904c", 1),
    commit("Cache the link previews", "5c3ea18b", 3),
    commit("Fix the VAT rate table for Ireland", "3f9c1b2e", 20, "ales"),
    commit("Add an index on orders.created_at", "9a7d2f10", 30),
    commit("Stop logging the full card token", "c41b8e55", 48, "Wren"),
  ],
  releases: new Map([[sha("3f9c1b2e"), "v1.4.0"]]),
};

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
    author: "mate-p-theo",
    url: undefined,
    checks: "passing",
    checkWord: "Passing",
    mergeability: "mergeable",
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
      commits: [
        { sha: "a", subject: "Two-step checkout: the basket step" },
        { sha: "b", subject: "Fix the VAT rate table for Ireland" },
        { sha: "c", subject: "Retry the payment webhook three times" },
      ],
    },
  ],
  20,
);
const NOTHING_WAITING = releaseContentsSummary([], 20);

const RELEASE_WAITING: ReleaseOffer = {
  offered: true,
  releasing: false,
  tag: "v1.5.0",
  contents: [
    {
      commits: [
        { sha: "a", subject: "Two-step checkout: the basket step" },
        { sha: "b", subject: "Fix the VAT rate table for Ireland" },
        { sha: "c", subject: "Retry the payment webhook three times" },
      ],
    },
  ],
  onRelease: () => {},
};

/** Nothing to release: production already runs every commit on main. */
const RELEASE_NONE: ReleaseOffer = {
  offered: false,
  releasing: false,
  tag: undefined,
  contents: [],
  onRelease: () => {},
};

/** Opening a commit is what grew the row and dragged the node down the rail. */
const READ_DETAIL = async (sha: string) => ({
  kind: "read" as const,
  detail: {
    sha,
    subject: "Key the preview cache on locale",
    files: [
      { filename: "src/server.js", status: "modified" },
      { filename: "src/cache.js", status: "added" },
    ],
    additions: 41,
    deletions: 7,
  },
});

const NOW = Date.now();

/** One service of a stop, as the group's Gitea read it: what it runs and how its deploy went. */
function service(
  environment: string,
  hostname: string,
  seed: string | undefined,
  name: string | undefined,
  state: "success" | "pending" | "failure" = "success",
  repository = "appdev",
): EnvironmentServiceState {
  return {
    hostname,
    repository,
    appVersionName:
      seed === undefined ? undefined : name === undefined ? sha(seed) : `${sha(seed)} ${name} ales`,
    statuses: [{ context: `mate/deploy/${environment}/${hostname}`, state }],
  };
}

/** A fact the platform stated just now. */
function known(value: Deployment): Shown<Deployment> {
  return {
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: NOW },
    coverage: "complete",
    freshness: { kind: "live" },
  };
}

const NOTHING_RUNS = known({ kind: "none" });

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
    // Only the newest release's tag time is read.
    taggedAt: index === 0 ? new Date(NOW - 3_600_000).toISOString() : undefined,
  };
});

/** What Beviro's production runs: medusa from v0.1.9, nextstore from v0.1.13. */
const BEVIRO_LIVE = [
  service("production", "medusa", MEDUSA, "v0.1.9", "success", "medusadev"),
  service("production", "nextstore", NEXTSTORE[0], "v0.1.13", "success", "nextstoredev"),
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
  contents: BEVIRO_WAITING,
  onRelease: () => {},
};

const BEVIRO_RELEASING: ReleaseOffer = { ...BEVIRO_BEHIND, releasing: true };

interface StopFixture {
  readonly tier: EnvironmentRow["tier"];
  /** The project's name; Shop unless the fixture is Beviro's. */
  readonly group?: string;
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  /** What the platform says the stop runs; unread unless given. */
  readonly deployment?: Shown<Deployment>;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers?: ReadonlyArray<ZeropsRouteOffer>;
  readonly release?: ReleaseOffer;
  /** The tag being released; production only. */
  readonly releasing?: string;
  /** Whether the failed deploy's job is known, so the verdict offers *Run again*. */
  readonly jobKnown?: boolean;
  readonly commits?: ZeropsCommitsState;
  /** A production's releases, newest first. */
  readonly releases?: ReadonlyArray<FlowRelease>;
  /** `{service}@{full sha}` → when its production deploy failed. */
  readonly failedDeploys?: ReadonlyMap<string, string | undefined>;
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
    environment: name,
  });
  const naming = production ? releaseNamingStop(listing, running) : undefined;
  const stop = naming === undefined ? row : nameStopByRelease(row, naming);
  const live = liveRelease(listing, running);
  const releases = listing.map((entry, index) =>
    releaseRow(entry, index, {
      production: running,
      failed: fixture.failedDeploys ?? new Map(),
      live: entry.tag === live,
    }),
  );
  const view = stopView({
    deployment: fixture.deployment ?? { state: "unread", waitingFor: null },
    row: stop,
    nowMs: NOW,
  });
  const routes = fixture.routes ?? [];
  const release = fixture.release ?? RELEASE_NONE;
  const waiting = production ? release.contents.flatMap((entry) => entry.commits) : [];
  const commits = fixture.commits ?? COMMITS;
  const services = serviceRows({
    environment: name,
    services: fixture.services,
    platform: { state: "unread", waitingFor: null },
    routes,
    offers: fixture.offers ?? [],
    nowMs: NOW,
    age: () => "2h ago",
  });
  const failed = stopFailure(
    fixture,
    view,
    services.find((entry) => entry.tone === "bad"),
  );
  return (
    <ZeropsStopPane
      commits={commits}
      crumbs={crumbs(group)}
      deployed={new Map(stop.version.sha === undefined ? [] : [[name, stop.version.sha]])}
      enablingServiceId={null}
      forge={{ giteaOrigin: undefined, owner: group.toLowerCase() }}
      groupId={group.toLowerCase()}
      groupName={group}
      menuWaiting={production ? releaseContentsSummary(release.contents, 8) : undefined}
      names={NAMES}
      onEnableRoute={() => {}}
      onOpenProject={() => {}}
      onRollBack={() => {}}
      pending={new Set()}
      readDetail={READ_DETAIL}
      release={release}
      releases={releases}
      repo={production ? undefined : "appdev"}
      routeTrouble={null}
      routes={routes}
      runAgain={
        failed?.jobKnown === true
          ? { rerunning: false, failure: null, onRunAgain: () => {} }
          : undefined
      }
      services={services}
      stop={stop}
      trouble={null}
      verdict={stopVerdict({
        tier: fixture.tier,
        view,
        releasing: fixture.releasing,
        failed,
        waiting: waiting.length,
        release,
        releasedAge: fixture.releasedAge,
        atMainHead:
          !production &&
          commits.kind === "read" &&
          view.version?.sha !== undefined &&
          commits.commits[0]?.sha === view.version.sha,
      })}
      view={view}
      waiting={waiting}
    />
  );
}

/**
 * The deploy that failed, as the stop page names it: the version the failed service's row names,
 * and what the stop runs instead when the platform names something else.
 */
function stopFailure(
  fixture: StopFixture,
  view: StopView,
  row: { readonly hostname: string } | undefined,
) {
  if (row === undefined) return undefined;
  const state = fixture.services.find((entry) => entry.hostname === row.hostname);
  const label = deployedVersion(state?.appVersionName).label;
  if (label === undefined) return undefined;
  const running = view.version?.label;
  return {
    label,
    service: row.hostname,
    running: running === label ? undefined : running,
    jobKnown: fixture.jobKnown ?? false,
  };
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
    <section className="flex flex-col gap-2">
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

function Harness() {
  return (
    <div className="flex flex-col gap-10 bg-background p-6">
      <State label="A project, running" note="Two stops, one change in flight, three waiting.">
        <ZeropsGroupPane
          attention={ATTENTION}
          mates={MATES}
          onAct={() => {}}
          onAddMate={() => {}}
          onOpenMate={() => {}}
          commits={COMMITS}
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
          readDetail={undefined}
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
          commits={{ kind: "no-gitea" }}
          environments={[]}
          groupId="fresh"
          name="Design tokens"
          crumbs={CRUMBS}
          names={NAMES}
          onSetUp={() => {}}
          pullRequests={[]}
          release={RELEASE_NONE}
          readDetail={undefined}
          repo={undefined}
          waiting={NOTHING_WAITING}
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
              service("production", "medusa", undefined, undefined, "success", "medusadev"),
              service("production", "nextstore", undefined, undefined, "success", "nextstoredev"),
            ],
            releases: BEVIRO_RELEASES,
          }}
        />
      </State>

      <State
        label="A production nothing was deployed to"
        note="The platform lists every service with no active deploy, and no release was cut."
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
        note="The dead end the menu draws as a grey dot; the verdict says what fills it."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [],
            deployment: NOTHING_RUNS,
            commits: { kind: "read", commits: [], releases: new Map() },
          }}
        />
      </State>

      <State
        label="A stage, deploying"
        note="A build runs for api: the verdict and the menu read Deploying…, and so does its row."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("stage", "api", "5c3ea18b", undefined, "pending"),
              service("stage", "app", "5c3ea18b", undefined),
            ],
            deployment: known({
              kind: "deploying",
              version: deployedVersion(sha("b21d904c")),
              previous: null,
            }),
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
            releasing: "v0.1.14",
            releases: BEVIRO_RELEASES,
          }}
        />
      </State>

      <State
        label="A stage whose deploy failed, its job known"
        note="The verdict names the service and runs its failed job again."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("stage", "api", "b21d904c", undefined, "failure"),
              service("stage", "app", "5c3ea18b", undefined),
            ],
            routes: ROUTES,
            jobKnown: true,
          }}
        />
      </State>

      <State
        label="A stage whose deploy failed, its job unknown"
        note="No job to run again, so no verb; the platform still runs the commit before it."
      >
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("stage", "api", "b21d904c", undefined, "failure"),
              service("stage", "app", "5c3ea18b", undefined),
            ],
            deployment: known({
              kind: "running",
              activatedAt: null,
              version: deployedVersion(sha("5c3ea18b")),
            }),
            routes: ROUTES,
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
            releases: BEVIRO_RELEASES,
          }}
        />
      </State>

      <State
        label="A production, live"
        note="Beviro: medusa runs v0.1.9's commit, nextstore v0.1.13 — the stop is v0.1.13, the release both run. v0.1.11's nextstore deploy failed; two releases wait behind the quiet verb."
      >
        <StopState
          fixture={{
            tier: "production",
            group: "Beviro",
            services: BEVIRO_LIVE,
            routes: BEVIRO_ROUTES,
            releases: BEVIRO_RELEASES,
            failedDeploys: new Map([[`nextstore@${sha(NEXTSTORE[2])}`, undefined]]),
            releasedAge: "1h ago",
          }}
        />
      </State>

      <State label="A stage at the head of main" note="It runs main's newest commit.">
        <StopState
          fixture={{
            tier: "stage",
            services: [
              service("stage", "api", "b21d904c", undefined),
              service("stage", "app", "b21d904c", undefined),
            ],
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
              service("stage", "api", "5c3ea18b", undefined),
              service("stage", "app", "5c3ea18b", undefined),
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
              service("stage", "api", "b21d904c", undefined),
              service("stage", "app", "b21d904c", undefined),
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
