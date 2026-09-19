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
  releaseContentsSummary,
  type EnvironmentRow,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";

import {
  ZeropsGroupPane,
  ZeropsStopPane,
  type ReleaseOffer,
} from "~/components/zerops/ZeropsGroupDetail";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";
import type { ZeropsDeployRun } from "~/zerops/useZeropsDeployRun";

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
    mergeable: true,
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

/** Nothing to release: the production already runs what the stage does. */
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

function run(state: ZeropsDeployRun["state"]): ZeropsDeployRun {
  return { state, readLog: async () => "", rerun: async () => {}, refresh: () => {} };
}

const BUILT: ZeropsDeployRun = run({
  kind: "read",
  runId: 41,
  runNumber: 12,
  jobs: [
    {
      id: 1,
      name: "build",
      status: "completed",
      conclusion: "success",
      run_id: 41,
      started_at: "2026-09-19T11:00:00Z",
      completed_at: "2026-09-19T11:01:32Z",
    },
    {
      id: 2,
      name: "deploy",
      status: "completed",
      conclusion: "success",
      run_id: 41,
      started_at: "2026-09-19T11:01:32Z",
      completed_at: "2026-09-19T11:01:50Z",
    },
  ],
});

const BROKEN: ZeropsDeployRun = run({
  kind: "read",
  runId: 42,
  runNumber: 13,
  jobs: [
    {
      id: 3,
      name: "build",
      status: "completed",
      conclusion: "success",
      run_id: 42,
      started_at: "2026-09-19T11:00:00Z",
      completed_at: "2026-09-19T11:02:11Z",
    },
    {
      id: 4,
      name: "deploy",
      status: "completed",
      conclusion: "failure",
      run_id: 42,
      started_at: "2026-09-19T11:02:11Z",
      completed_at: "2026-09-19T11:02:15Z",
    },
  ],
});

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
          pullRequests={[pull(), pull({ number: 6, title: "Bump the linter", mergeable: false })]}
          release={RELEASE_WAITING}
          readDetail={undefined}
          repo="appdev"
          slug="shop"
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
          slug="fresh"
          waiting={NOTHING_WAITING}
        />
      </State>

      <State label="A production, behind" note="Three changes merged that it is not running yet.">
        <ZeropsStopPane
          commits={COMMITS}
          deployed={new Map([["production", sha("3f9c1b2e")]])}
          crumbs={CRUMBS}
          names={NAMES}
          groupName="Shop"
          production
          readDetail={READ_DETAIL}
          release={RELEASE_WAITING}
          repo="appdev"
          routes={ROUTES}
          run={BUILT}
          stop={environment({
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
          })}
          waiting={WAITING}
        />
      </State>

      <State
        label="A stage whose deploy failed"
        note="The build is the whole story here, and it is the section nobody had wired."
      >
        <ZeropsStopPane
          commits={COMMITS}
          deployed={new Map([["stage", sha("b21d904c")]])}
          crumbs={CRUMBS}
          names={NAMES}
          groupName="Shop"
          production={false}
          readDetail={undefined}
          release={RELEASE_NONE}
          repo="appdev"
          routes={ROUTES}
          run={BROKEN}
          stop={environment({ tone: "bad" })}
          waiting={NOTHING_WAITING}
        />
      </State>

      <State
        label="A stop nobody has deployed to"
        note="Nothing ran, nothing to show: the dead end the menu draws as a grey dot."
      >
        <ZeropsStopPane
          commits={{ kind: "reading" }}
          deployed={new Map()}
          crumbs={CRUMBS}
          names={NAMES}
          groupName="Shop"
          production={false}
          readDetail={undefined}
          release={RELEASE_NONE}
          repo={undefined}
          routes={[]}
          run={run({ kind: "none" })}
          stop={environment({
            tone: "neutral",
            version: {
              name: undefined,
              label: undefined,
              commit: undefined,
              sha: undefined,
              taggedBy: undefined,
            },
            versionRepository: undefined,
          })}
          waiting={NOTHING_WAITING}
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
      <Harness />
    </StrictMode>,
  );
}
