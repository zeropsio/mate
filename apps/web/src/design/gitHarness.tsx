/** The Git overview's states, on literal reads and without an account. */
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  codeStandingOffers,
  gitOverview,
  type CodeStanding,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { Page } from "~/components/ui/page";
import { PageHeader } from "~/components/ui/page-header";
import { ZeropsGitOverview } from "~/components/zerops/ZeropsGitPage";
import type { GitPageState } from "~/components/zerops/ZeropsGitPage.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const stateName = params.get("state") ?? "default";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const repo = (name: string, follows?: string) => ({
  name,
  updatedAt: ago(7),
  ...(follows === undefined ? {} : { follows }),
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
const source =
  stateName === "kept" || stateName === "kept-reader"
    ? kept
    : stateName === "deleting"
      ? deleting
      : stateName === "attention"
        ? attention
        : stateName === "empty"
          ? []
          : stateName === "reading"
            ? used.slice(0, 1)
            : used;
const apps = gitOverview({ apps: source, mateName: () => undefined });
const state: GitPageState =
  stateName === "unread"
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
                  ? { kind: "asked" }
                  : id === "deleting" || id === "failed"
                    ? {
                        kind: "deleting",
                        placed: false,
                        phase: id === "failed" ? "failed" : "going",
                      }
                    : { kind: "in-use", mate: true, leaving: false };
  const reader = stateName === "kept-reader";
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
  }, []);
  return (
    <main className="min-h-screen bg-background text-foreground" style={{ marginLeft: 435 }}>
      <Page width="full">
        <PageHeader title="Git" line="Your organisation's code, by project." />
        <ZeropsGitOverview
          state={state}
          standingOf={standingOf}
          onAgain={() => {}}
          repositoryHref={(appId, name) => `/git?appId=${appId}&repo=${name}`}
          onAddMate={() => {}}
          onDelete={() => {}}
          onReview={() => {}}
        />
      </Page>
    </main>
  );
}

createRoot(document.getElementById("design")!).render(<Harness />);
