/** The Git overview and project code, using the real components over literal reads. */
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  codeStandingOffers,
  gitOverview,
  gitOverviewGroups,
  type CodeStanding,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import {
  KEPT_GIT_UNCONFIRMED,
  type HqMateIdentity,
  type KeptGitQuestionView,
} from "@t3tools/client-runtime/data";
import { Page } from "~/components/ui/page";
import { ProjectCode, ProjectCodeGone, ZeropsGitOverview } from "~/components/zerops/ZeropsGitPage";
import { KeptCodeLine } from "~/components/zerops/KeptGitQuestions";
import type { GitPageState } from "~/components/zerops/ZeropsGitPage.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const stateName = params.get("state") ?? "default";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const repo = (name: string, usedBytes: number, follows?: string) => ({
  name,
  updatedAt: ago(7),
  usedBytes,
  ...(follows === undefined ? {} : { follows }),
});
const pull = (repository: string, number: number, conflict = false): FlowPullRequest => ({
  repository,
  number,
  title: "Improve checkout",
  kind: "code",
  mateProjectId: "m1",
  url: undefined,
  mergeability: conflict ? "conflicting" : "mergeable",
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
      repo("group", 512),
      repo("storefront", 12_400_000, "https://github.com/acme/storefront.git"),
      repo("api", 3_500_000),
      repo("admin", 942_000),
    ],
    changes: [pull("storefront", 1), pull("storefront", 2, true)],
  },
  {
    appId: "harbor",
    name: "Harbor Radio",
    repositories: [
      repo("group", 512),
      repo("stream", 50_500_000, "https://github.com/harbor-radio/stream.git"),
      repo("site", 2_200_000),
    ],
    changes: [pull("stream", 3)],
  },
  {
    appId: "docs",
    name: "Documentation",
    repositories: [repo("group", 512), repo("docs", 655_360)],
    changes: [],
  },
  {
    appId: "chief",
    name: "Chief · Ada",
    repositories: [repo("group", 512), repo("chief", 184_320)],
    changes: [],
  },
];
const kept = [
  {
    appId: "archive",
    name: "Archive",
    repositories: [
      repo("group", 512),
      repo("archive", 25_800_000, "https://github.com/acme/archive.git"),
      repo("legacy-api", 8_700_000),
    ],
    changes: [],
  },
  { appId: "dmx", name: "DMX", repositories: [repo("group", 24_576)], changes: [] },
];
const old = {
  appId: "old",
  name: "Old site",
  repositories: [repo("group", 512), repo("site", 3_355_443)],
  changes: [],
};
const deleting = [
  {
    appId: "deleting",
    name: "Pilot",
    repositories: [repo("group", 512), repo("pilot", 5_800_000)],
    changes: [],
  },
  {
    appId: "failed",
    name: "Experiments",
    repositories: [repo("group", 512), repo("lab", 12_600_000, "https://github.com/acme/lab.git")],
    changes: [],
  },
];
const asking = stateName.startsWith("asked") || stateName === "project-asked";
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
  stateName === "empty"
    ? []
    : stateName === "reading"
      ? used.slice(0, 1)
      : stateName === "deleting" || stateName === "project-deleting"
        ? [...used, ...deleting, ...kept]
        : asking && !unlisted
          ? [...used, old, ...kept]
          : [...used, ...kept];
const apps = gitOverview({ apps: source, mateName: () => undefined });
const state: GitPageState =
  stateName === "unread" || stateName === "project-unread"
    ? { kind: "unread", failure: null }
    : stateName === "refused"
      ? { kind: "refused", reason: "HQ did not offer changes to this account." }
      : {
          kind: "read",
          apps,
          failure:
            stateName === "read-failure" ? "Couldn't read the latest changes from HQ." : null,
          ...(stateName === "reading" ? { reading: true } : {}),
          ...(stateName === "unreadable"
            ? {
                refusals: [
                  {
                    appId: "private",
                    name: "Payments",
                    reason: "HQ does not offer you this project's changes.",
                  },
                ],
              }
            : {}),
        };
const standingOf = (id: string) => {
  const standing: CodeStanding =
    id === "unknown"
      ? { kind: "unread" }
      : id === "old" || id === "missing"
        ? { kind: "asked" }
        : id === "archive" || id === "dmx"
          ? { kind: "kept", holds: id === "archive" ? "code" : "setup" }
          : id === "deleting" || id === "failed"
            ? { kind: "deleting", placed: false, phase: id === "failed" ? "failed" : "going" }
            : { kind: "in-use", mate: true, leaving: false };
  const reader = stateName === "reader" || stateName === "project-reader";
  return {
    standing,
    offers: codeStandingOffers(standing, {
      deleteApp: reader ? "refused" : "allowed",
      addMate: reader ? "none" : "offered",
    }),
    ...(id === "failed"
      ? { stopped: "HQ stopped deleting Experiments: GitHub refused to let go of acme/lab." }
      : {}),
  };
};
const identity: HqMateIdentity = {
  projectId: "chief-project",
  fullName: "Ada",
  name: "Ada",
  tint: "amber",
  shape: "hexagon",
  project: "Chief · Ada",
  projectUrl: "#",
};
const chiefByApp = new Map([["chief", { identity }]]);
const repositoryHref = (appId: string, name: string, view?: "changes") =>
  `/git?${new URLSearchParams({ appId, repo: name, ...(view === undefined ? {} : { view }) })}`;

function Harness() {
  useEffect(() => {
    if (stateName === "open-changes" || stateName === "kept-tab") {
      const label = stateName === "open-changes" ? "Open changes" : "Kept code";
      [...document.querySelectorAll<HTMLButtonElement>('[data-slot="tab-press"]')]
        .find((button) => button.textContent?.includes(label))
        ?.click();
    }
    if (stateName === "search" || stateName === "search-none") {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Find a project or repository"]',
      );
      if (input !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          stateName === "search" ? "store" : "billing",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (stateName === "asked-confirm")
      [...document.querySelectorAll<HTMLButtonElement>('[data-git-project="old"] button')]
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
    stateName === "project-kept" || stateName === "project-reader"
      ? "archive"
      : stateName === "project-setup"
        ? "dmx"
        : stateName === "project-asked"
          ? "old"
          : stateName === "project-deleting"
            ? "failed"
            : stateName === "project-unread"
              ? "unknown"
              : "store";
  const name =
    [...used, ...kept, old, ...deleting].find((app) => app.appId === projectId)?.name ??
    "Checking project";
  const group = gitOverviewGroups(
    state.kind === "read" ? state.apps.filter((app) => app.appId === projectId) : [],
    (id) => standingOf(id).standing,
    asking ? [question.question] : [],
  ).groups.find((item) => item.appId === projectId);
  const content =
    stateName === "project-gone" ? (
      <ProjectCodeGone />
    ) : stateName.startsWith("project") ? (
      <ProjectCode
        appId={projectId}
        name={name}
        group={group}
        state={state}
        view={standingOf(projectId)}
        question={asking ? question : undefined}
        answer={async () => {}}
        repositoryHref={repositoryHref}
        onAddMate={() => {}}
        onDelete={() => {}}
        onReview={() => {}}
      />
    ) : (
      <ZeropsGitOverview
        state={state}
        standingOf={standingOf}
        chiefByApp={chiefByApp}
        questions={asking ? [question] : []}
        answer={async () => {}}
        onAgain={() => {}}
        repositoryHref={repositoryHref}
        onAddMate={() => {}}
        onDelete={() => {}}
        onReview={() => {}}
      />
    );
  return (
    <main className="min-h-screen bg-background text-foreground" style={{ marginLeft: 435 }}>
      <Page width="wide">{content}</Page>
    </main>
  );
}
createRoot(document.getElementById("design")!).render(<Harness />);
