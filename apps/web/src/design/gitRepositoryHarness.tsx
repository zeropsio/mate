/** The Git repository page's states, on literal reads and without an account. */
import { createRoot } from "react-dom/client";
import {
  codeStandingOffers,
  codeStandingSentence,
  gitOverview,
  type CodeStanding,
} from "@t3tools/client-runtime/zerops";
import { Page } from "~/components/ui/page";
import { Button } from "~/components/ui/button";
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
const apps = gitOverview({
  apps: [
    {
      appId: "store",
      name: "Acme Store",
      repositories: [
        {
          name: "storefront",
          updatedAt: ago(7),
          follows: "https://github.com/acme/storefront.git",
        },
      ],
      changes: [
        {
          repository: "storefront",
          number: 1,
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
          updatedAt: ago(1),
          ready: true,
        },
      ],
    },
  ],
  mateName: () => undefined,
});
const standings = {
  archive: { kind: "kept", holds: "code" },
  dmx: { kind: "kept", holds: "setup" },
  old: { kind: "asked" },
  failed: { kind: "deleting", placed: false, phase: "failed" },
} satisfies Record<string, CodeStanding>;
const standingOf = (id: keyof typeof standings) => {
  const standing = standings[id];
  const reader = stateName === "repository-banner-reader";
  return {
    standing,
    offers: codeStandingOffers(standing, {
      deleteApp: reader ? "refused" : "allowed",
      addMate: reader ? "none" : "offered",
    }),
  };
};

function Harness() {
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
  let content;
  if (["repository-gone", "repository-reading", "repository-no-access"].includes(stateName))
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
  }
  return (
    <main className="min-h-screen bg-background text-foreground" style={{ marginLeft: 435 }}>
      <Page width="full">{content}</Page>
    </main>
  );
}

createRoot(document.getElementById("design")!).render(<Harness />);
