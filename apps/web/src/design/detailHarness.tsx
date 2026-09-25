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
  environmentRow,
  releaseContentsSummary,
  releaseRow,
  type EnvironmentRow,
  type EnvironmentServiceState,
  type FlowPullRequest,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";
import {
  serviceRows,
  stopVerdict,
  stopView,
  type Deployment,
  type StopFailure,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import {
  ZeropsGroupPane,
  ZeropsStopPane,
  type ReleaseOffer,
  type StopRunAgain,
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

const CRUMBS = [
  { label: "Projects", onClick: () => {} },
  { label: "Shop", onClick: () => {} },
];

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
  seed: string,
  name: string | undefined,
  state: "success" | "failure" = "success",
): EnvironmentServiceState {
  return {
    hostname,
    repository: "appdev",
    appVersionName: name === undefined ? sha(seed) : `${sha(seed)} ${name} ales`,
    statuses: [{ context: `mate/deploy/${environment}/${hostname}`, state }],
  };
}

const NOTHING_RUNS: Shown<Deployment> = {
  state: "known",
  value: { kind: "none" },
  asOf: { ordinal: 1, atMs: NOW },
  coverage: "complete",
  freshness: { kind: "live" },
};

/** What production's releases read, newest first, the newest running there. */
const RELEASES = ["v1.4.0", "v1.3.2", "v1.3.1"].map((tag, index) =>
  releaseRow(
    {
      tag,
      verdict: "approved",
      detail: undefined,
      line: index === 0 ? "app 3f9c1b2 · api 3f9c1b2" : `app ${tag}`,
      entries:
        index === 0
          ? [
              { service: "api", commit: sha("3f9c1b2e") },
              { service: "app", commit: sha("3f9c1b2e") },
            ]
          : [{ service: "app", commit: sha(`9a${String(index)}`) }],
      taggedAt: index === 0 ? new Date(NOW - 20 * 3_600_000).toISOString() : undefined,
    },
    index,
    {
      production: new Map([
        ["api", sha("3f9c1b2e")],
        ["app", sha("3f9c1b2e")],
      ]),
      failed: new Map(),
      live: index === 0,
    },
  ),
);

interface StopFixture {
  readonly tier: EnvironmentRow["tier"];
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  readonly deployment?: Shown<Deployment>;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers?: ReadonlyArray<ZeropsRouteOffer>;
  readonly release?: ReleaseOffer;
  readonly failed?: StopFailure;
  readonly runAgain?: StopRunAgain;
  readonly commits?: ZeropsCommitsState;
}

/** A stop's page as its page would hand it over: every line the producers', none the harness's. */
function StopState({ fixture }: { readonly fixture: StopFixture }) {
  const name = fixture.tier === "production" ? "production" : "stage";
  const stop = environmentRow({
    projectId: `shop-${name}`,
    name,
    tier: fixture.tier,
    sources: fixture.tier === "production" ? "release" : ["main"],
    services: fixture.services,
    environment: name,
  });
  const view = stopView({
    deployment: fixture.deployment ?? { state: "unread", waitingFor: null },
    row: stop,
    nowMs: NOW,
  });
  const routes = fixture.routes ?? [];
  const release = fixture.release ?? RELEASE_NONE;
  const waiting =
    fixture.tier === "production" ? release.contents.flatMap((entry) => entry.commits) : [];
  const commits = fixture.commits ?? COMMITS;
  return (
    <ZeropsStopPane
      commits={commits}
      crumbs={CRUMBS}
      deployed={new Map(view.version?.sha === undefined ? [] : [[name, view.version.sha]])}
      enablingServiceId={null}
      forge={{ giteaOrigin: undefined, owner: "shop" }}
      groupId="shop"
      groupName="Shop"
      menuWaiting={
        fixture.tier === "production" ? releaseContentsSummary(release.contents, 8) : undefined
      }
      names={NAMES}
      onEnableRoute={() => {}}
      onOpenProject={() => {}}
      onRollBack={() => {}}
      pending={new Set()}
      readDetail={READ_DETAIL}
      release={release}
      releases={fixture.tier === "production" ? RELEASES : []}
      repo="appdev"
      routeTrouble={null}
      routes={routes}
      runAgain={fixture.runAgain}
      services={serviceRows({
        environment: name,
        services: fixture.services,
        platform: { state: "unread", waitingFor: null },
        routes,
        offers: fixture.offers ?? [],
        nowMs: NOW,
        age: () => "2h ago",
      })}
      stop={stop}
      trouble={null}
      verdict={stopVerdict({
        tier: fixture.tier,
        view,
        releasing: undefined,
        failed: fixture.failed,
        waiting: waiting.length,
        release,
        releasedAge: fixture.tier === "production" ? "20h ago" : undefined,
        atMainHead:
          commits.kind === "read" &&
          view.version?.sha !== undefined &&
          commits.commits[0]?.sha === view.version.sha,
      })}
      view={view}
      waiting={waiting}
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

      <State label="A production, behind" note="Three changes merged that it is not running yet.">
        <StopState
          fixture={{
            tier: "production",
            services: [
              service("production", "api", "3f9c1b2e", "v1.4.0"),
              service("production", "app", "3f9c1b2e", "v1.4.0"),
            ],
            routes: ROUTES,
            release: RELEASE_WAITING,
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

      <State
        label="A stage whose deploy failed"
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
            failed: { label: "b21d904", service: "api", running: undefined, jobKnown: true },
            runAgain: { rerunning: false, failure: null, onRunAgain: () => {} },
          }}
        />
      </State>

      <State
        label="A stop nobody has deployed to"
        note="Nothing ran, nothing to show: the dead end the menu draws as a grey dot."
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
