/** The Git overview's states, on literal reads and without an account. */
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  codeStandingOffers,
  codeStandingSentence,
  gitOverview,
  type CodeStanding,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { KEPT_GIT_UNCONFIRMED, type KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { Page } from "~/components/ui/page";
import { PageHeader } from "~/components/ui/page-header";
import { Button } from "~/components/ui/button";
import {
  ZeropsGitOverview,
  ProjectCodeHeading,
  ProjectCodeGone,
} from "~/components/zerops/ZeropsGitPage";
import { KeptCodeLine } from "~/components/zerops/KeptGitQuestions";
import type { GitPageState } from "~/components/zerops/ZeropsGitPage.logic";
import { RepositoryPageEnd } from "~/components/zerops/ZeropsRepositoryBrowser";
import { CodeStandingBanner } from "~/components/zerops/CodeStandingActions";
import {
  GitRepoFacts,
  GitRepoHeading,
  GitRepoTabs,
} from "~/components/zerops/gitBrowser/GitRepoFrame";
import { GitRepositoryStorage } from "~/components/zerops/gitBrowser/GitRepositoryStorage";
import { GitRepoChanges } from "~/components/zerops/gitBrowser/GitRepoChanges";
import { GitBrowserLink } from "~/components/zerops/gitBrowser/GitBrowserLink";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import "../index.css";

const params = new URLSearchParams(location.search);
const stateName = params.get("state") ?? "default";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const repo = (name: string, follows?: string, usedBytes?: number) => ({
  name,
  updatedAt: ago(7),
  ...(follows === undefined ? {} : { follows }),
  ...(usedBytes === undefined ? {} : { usedBytes }),
});
const pull = (repository: string, number: number): FlowPullRequest => ({
  repository,
  number,
  title: "Improve checkout",
  kind: "code",
  mateProjectId: "m1",
  url: undefined,
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  state: "open",
  headSha: undefined,
  baseBranch: "main",
  line: "",
  updatedAt: ago(number),
  ready: true,
});
const used = [
  {
    appId: "store",
    name: "Acme Store",
    repositories: [
      repo("group"),
      repo("storefront", "https://github.com/acme/storefront.git"),
      repo("api"),
    ],
    changes: [pull("storefront", 1), pull("group", 2)],
  },
  {
    appId: "docs",
    name: "Documentation",
    repositories: [repo("group"), repo("docs")],
    changes: [],
  },
  { appId: "site", name: "Website", repositories: [repo("group"), repo("web")], changes: [] },
];
const kept = [
  {
    appId: "archive",
    name: "Archive",
    repositories: [repo("group"), repo("archive")],
    changes: [],
  },
  { appId: "dmx", name: "DMX", repositories: [repo("group")], changes: [] },
  { appId: "old", name: "Old site", repositories: [repo("group"), repo("site")], changes: [] },
];
const deleting = [
  {
    appId: "deleting",
    name: "Deleting project",
    repositories: [repo("group"), repo("app")],
    changes: [],
  },
  {
    appId: "failed",
    name: "Stopped project",
    repositories: [repo("group"), repo("app")],
    changes: [],
  },
];
const attention = [
  { appId: "unknown", name: "Checking project", repositories: [repo("group")], changes: [] },
  { appId: "leaving", name: "Leaving project", repositories: [repo("group")], changes: [] },
  { appId: "off", name: "Waiting project", repositories: [repo("group")], changes: [] },
  { appId: "waiting", name: "Deletion waiting", repositories: [repo("group")], changes: [] },
];
const sized = [
  {
    appId: "store",
    name: "Acme Store",
    changes: [],
    repositories: [
      repo("group", undefined, 512),
      repo("api", undefined, 2048),
      repo("storefront", "https://github.com/acme/storefront.git", 111462),
    ],
  },
  {
    appId: "docs",
    name: "Documentation",
    changes: [],
    repositories: [repo("group", undefined, 1024), repo("docs")],
  },
  {
    appId: "archive",
    name: "Archive",
    changes: [],
    repositories: [repo("group", undefined, 512), repo("archive", undefined, 2048)],
  },
];
const asking = stateName.startsWith("asked");
const unlisted = stateName === "asked-unlisted";
const question: KeptGitQuestionView = {
  question: {
    appId: unlisted ? "missing" : "old",
    appName: unlisted ? "Lost project" : "Old site",
    projectId: "removed",
    projectName: unlisted ? null : "Old site",
    askedAt: "2026-11-25T12:00:00Z",
  },
  requestId: "question-1",
  pending: stateName === "asked-pending",
  message:
    stateName === "asked-pending"
      ? KEPT_GIT_UNCONFIRMED
      : stateName === "asked-refused"
        ? "HQ refused this answer."
        : null,
};
const source =
  stateName === "sizes"
    ? sized
    : asking
      ? unlisted
        ? []
        : kept.filter(({ appId }) => appId === "old")
      : stateName === "kept" ||
          stateName === "kept-reader" ||
          stateName === "project-kept" ||
          stateName === "project-empty" ||
          stateName === "project-asked" ||
          stateName.startsWith("repository-banner")
        ? kept
        : stateName === "deleting" || stateName === "project-deleting"
          ? deleting
          : stateName === "attention" || stateName === "project-unread"
            ? attention
            : stateName === "empty"
              ? []
              : stateName === "reading"
                ? used.slice(0, 1)
                : used;
const apps = gitOverview({ apps: source, mateName: () => undefined });
const state: GitPageState =
  stateName === "unread" || unlisted
    ? { kind: "unread", failure: null }
    : stateName === "refused"
      ? { kind: "refused", reason: "HQ did not offer changes to this account." }
      : {
          kind: "read",
          apps,
          failure: stateName === "attention" ? "HQ could not refresh changes." : null,
          ...(stateName === "reading" ? { reading: true } : {}),
          ...(stateName === "attention"
            ? {
                refusals: [
                  { appId: "private", name: "Private project", reason: "HQ refused access." },
                ],
              }
            : {}),
        };
const standingOf = (id: string) => {
  const standing: CodeStanding =
    id === "unknown"
      ? { kind: "unread" }
      : id === "leaving"
        ? { kind: "in-use", mate: false, leaving: true }
        : id === "off"
          ? { kind: "kept", holds: "code" }
          : id === "waiting"
            ? { kind: "deleting", placed: false, phase: "waiting" }
            : id === "archive"
              ? { kind: "kept", holds: "code" }
              : id === "dmx"
                ? { kind: "kept", holds: "setup" }
                : id === "old"
                  ? stateName === "kept-reader"
                    ? { kind: "kept", holds: "code" }
                    : { kind: "asked" }
                  : id === "deleting" || id === "failed"
                    ? {
                        kind: "deleting",
                        placed: false,
                        phase: id === "failed" ? "failed" : "going",
                      }
                    : { kind: "in-use", mate: true, leaving: false };
  const reader = stateName === "kept-reader" || stateName === "repository-banner-reader";
  return {
    standing,
    offers: codeStandingOffers(standing, {
      deleteApp: id === "off" ? "unknown" : reader ? "refused" : "allowed",
      addMate: id === "off" ? "off" : reader ? "none" : "offered",
    }),
    ...(id === "off" ? { addMateWhy: "Ask an Owner or Admin to let you add Mates." } : {}),
  };
};

function Harness() {
  useEffect(() => {
    if (stateName === "open-only")
      document.querySelector<HTMLButtonElement>('[aria-pressed="false"]')?.click();
    if (stateName === "asked-confirm")
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-zerops-surface="kept-code-question"] button',
        ),
      ]
        .find((button) => button.textContent?.includes("Delete code"))
        ?.click();
  }, []);
  if (stateName === "menu-one" || stateName === "menu-three")
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div
          className="min-h-screen border-e border-border bg-sidebar text-sidebar-foreground"
          style={{ width: 435 }}
          data-git-menu
        >
          <KeptCodeLine count={stateName === "menu-one" ? 1 : 3} href="/git" />
        </div>
      </main>
    );
  const projectId =
    stateName === "project-kept"
      ? "archive"
      : stateName === "project-empty"
        ? "dmx"
        : stateName === "project-asked"
          ? "old"
          : stateName === "project-deleting"
            ? "failed"
            : stateName === "project-unread"
              ? "unknown"
              : "store";
  const projectName =
    [...used, ...kept, ...deleting, ...attention].find((app) => app.appId === projectId)?.name ??
    "Project";
  const projectView = standingOf(projectId);
  const about: GitHomeAbout = {
    remote: { provider: "github", url: "https://github.com/acme/archive" },
    mirror: { syncedAt: ago(1), divergedSince: null, governance: null },
    updatedAt: ago(7),
    branchCount: 4,
    tagCount: 2,
    storage: {
      usedBytes: 12345678,
      limitBytes: 1073741824,
      large: false,
      routeBodyLimitBytes: null,
    },
  };
  const overview = (
    <ZeropsGitOverview
      state={state}
      standingOf={standingOf}
      questions={
        asking ||
        stateName === "kept" ||
        stateName === "project-asked" ||
        stateName === "project-kept"
          ? [question]
          : []
      }
      answer={async () => {}}
      onAgain={() => {}}
      only={
        stateName.startsWith("project-") && stateName !== "project-gone" ? projectId : undefined
      }
      repositoryHref={(appId, name, view) =>
        `/git?${new URLSearchParams({ appId, repo: name, ...(view === undefined ? {} : { view }) })}`
      }
      onAddMate={() => {}}
      onDelete={() => {}}
      onReview={() => {}}
    />
  );
  let content;
  if (stateName === "project-gone") content = <ProjectCodeGone />;
  else if (["repository-gone", "repository-reading", "repository-no-access"].includes(stateName))
    content = (
      <div className="flex flex-col gap-4">
        <GitRepoHeading appId="store" project="Acme Store" repo="missing" />
        <RepositoryPageEnd
          state={
            stateName === "repository-gone"
              ? { kind: "gone" }
              : stateName === "repository-reading"
                ? { kind: "reading" }
                : { kind: "no-access", reason: "You do not have access to this repository." }
          }
          onBack={() => {}}
        />
      </div>
    );
  else if (stateName.startsWith("repository-banner")) {
    const id =
      stateName === "repository-banner-setup"
        ? "dmx"
        : stateName === "repository-banner-asked"
          ? "old"
          : stateName === "repository-banner-deleting"
            ? "failed"
            : "archive";
    const name =
      id === "dmx"
        ? "DMX"
        : id === "old"
          ? "Old site"
          : id === "failed"
            ? "Stopped project"
            : "Archive";
    const view = standingOf(id);
    content = (
      <div className="flex flex-col gap-3">
        <GitRepoHeading appId={id} project={name} repo="archive" />
        <GitRepoFacts about={about} storage={<GitRepositoryStorage storage={about.storage} />} />
        <CodeStandingBanner
          name={name}
          view={view}
          sentence={codeStandingSentence(name, view.standing)}
          onAddMate={() => {}}
          onDelete={() => {}}
          onReview={() => {}}
          answer={<GitBrowserLink to={{ appId: id }}>Answer on Git</GitBrowserLink>}
        />
        <GitRepoTabs
          view="home"
          openChanges={2}
          onTab={() => {}}
          picker={
            <Button size="sm" variant="secondary">
              main
            </Button>
          }
        />
      </div>
    );
  } else if (stateName.startsWith("repository-changes-")) {
    const existing = apps
      .find((app) => app.appId === "store")!
      .repositories.find((repo) => repo.name === "storefront")!;
    const repository =
      stateName === "repository-changes-open"
        ? existing
        : {
            ...existing,
            changes: stateName === "repository-changes-failed" ? existing.changes : [],
            coverage:
              stateName === "repository-changes-failed"
                ? ("failed" as const)
                : stateName === "repository-changes-unread"
                  ? ("unread" as const)
                  : ("complete" as const),
          };
    content = (
      <div className="flex flex-col gap-4">
        <GitRepoHeading appId="store" project="Acme Store" repo="storefront" />
        <GitRepoChanges
          appId="store"
          project="Acme Store"
          repo="storefront"
          search={{}}
          repository={repository}
          changesFailure={
            stateName === "repository-changes-failed" ? "HQ could not refresh changes." : undefined
          }
          onReadChanges={() => {}}
          onOpenChange={() => {}}
        />
      </div>
    );
  } else if (stateName.startsWith("project-"))
    content = (
      <>
        <ProjectCodeHeading
          appId={projectId}
          name={projectName}
          view={projectView}
          sentence={codeStandingSentence(projectName, projectView.standing)}
          onAddMate={() => {}}
          onDelete={() => {}}
        />
        {overview}
      </>
    );
  else
    content = (
      <>
        <PageHeader title="Git" line="Your organisation's code, by project." />
        {overview}
      </>
    );
  return (
    <main className="min-h-screen bg-background text-foreground" style={{ marginLeft: 435 }}>
      <Page width="full">{content}</Page>
    </main>
  );
}

createRoot(document.getElementById("design")!).render(<Harness />);
