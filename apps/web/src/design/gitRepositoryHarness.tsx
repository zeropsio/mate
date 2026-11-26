/** The Git repository page's states, on literal reads and without an account. */
import { createRoot } from "react-dom/client";
import {
  codeStandingOffers,
  codeStandingSentence,
  gitOverview,
  type CodeStanding,
} from "@t3tools/client-runtime/zerops";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import type { GitTreeEntry } from "@t3tools/shared/hqGitBrowse/tree";
import { BookOpenIcon, ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { GitHubIcon } from "~/components/Icons";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Failure } from "~/components/ui/failure";
import { Page } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { RepositoryPageEnd } from "~/components/zerops/ZeropsRepositoryBrowser";
import { repositoryChanges } from "~/components/zerops/ZeropsRepositoryBrowser.logic";
import { repositoryWhere } from "~/components/zerops/ZeropsGitPage.logic";
import { CodeStandingBanner } from "~/components/zerops/CodeStandingActions";
import { GitHomeAgain } from "~/components/zerops/gitBrowser/GitAtCommit";
import { GitDirectoryList } from "~/components/zerops/gitBrowser/GitDirectoryList";
import {
  GitRepoColumns,
  GitRepoFacts,
  GitRepoHeading,
  GitRepoTabs,
} from "~/components/zerops/gitBrowser/GitRepoFrame";
import { GitRepositoryStorage } from "~/components/zerops/gitBrowser/GitRepositoryStorage";
import { GitRepoChanges } from "~/components/zerops/gitBrowser/GitRepoChanges";
import { GitBrowserLink } from "~/components/zerops/gitBrowser/GitBrowserLink";
import { RepoMarkdown } from "~/components/zerops/gitBrowser/RepoMarkdown";
import "../index.css";

const params = new URLSearchParams(location.search);
const stateName = params.get("state") ?? "repository-code";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const sha = "1234567890123456789012345678901234567890";
const entries: ReadonlyArray<GitTreeEntry> = [
  { name: ".github", path: ".github", type: "folder", mode: "040000", sha },
  { name: "src", path: "src", type: "folder", mode: "040000", sha },
  { name: "public", path: "public", type: "folder", mode: "040000", sha },
  { name: "README.md", path: "README.md", type: "file", mode: "100644", sha, size: 1248 },
  { name: "package.json", path: "package.json", type: "file", mode: "100644", sha, size: 682 },
  { name: "current", path: "current", type: "symlink", mode: "120000", sha, size: 3 },
  { name: "shared", path: "shared", type: "submodule", mode: "160000", sha },
];
const apps = gitOverview({
  apps: [
    {
      appId: "store",
      name: "Acme Store",
      repositories: [
        {
          name: "storefront",
          updatedAt: ago(7),
          remote: {
            url: "https://github.com/acme/storefront.git",
            repositoryId: null,
            keptAt: ago(7),
            keptBy: "p1",
            expiresAt: null,
            invalidSince: null,
            via: "token",
            githubAppId: null,
          },
        },
      ],
      changes: [1, 2].map((number) => ({
        repository: "storefront",
        number,
        title: number === 1 ? "Improve checkout" : "Make product search faster",
        kind: "code" as const,
        mateProjectId: `m${number}`,
        url: undefined,
        mergeability: "mergeable" as const,
        behind: false,
        merged: false,
        mergedAt: undefined,
        state: "open" as const,
        headSha: undefined,
        baseBranch: "main",
        line: "",
        updatedAt: ago(number),
        ready: true,
      })),
    },
  ],
  mateName: (id) => (id === "m1" ? "Fern" : "Theo"),
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
  const mateOnly = stateName === "repository-code-mate";
  const bannerId =
    stateName === "repository-banner-setup"
      ? "dmx"
      : stateName === "repository-banner-asked"
        ? "old"
        : stateName === "repository-banner-deleting"
          ? "failed"
          : "archive";
  const hasBanner = stateName.startsWith("repository-banner");
  const project = !hasBanner
    ? "Acme Store"
    : bannerId === "dmx"
      ? "DMX"
      : bannerId === "old"
        ? "Old site"
        : bannerId === "failed"
          ? "Stopped project"
          : "Archive";
  const repo = hasBanner
    ? bannerId === "dmx"
      ? "group"
      : "archive"
    : stateName === "repository-changes-setup-empty"
      ? "group"
      : "storefront";
  const about: GitHomeAbout = {
    remote: mateOnly ? null : { provider: "github", url: `https://github.com/acme/${repo}` },
    mirror: mateOnly ? null : { syncedAt: ago(1), divergedSince: null, governance: null },
    updatedAt: ago(7),
    branchCount: 4,
    tagCount: 2,
    storage: {
      usedBytes: mateOnly ? null : 12345678,
      limitBytes: 1073741824,
      large: mateOnly,
      routeBodyLimitBytes: null,
    },
  };
  const isChanges = stateName.startsWith("repository-changes-");
  const existing = apps[0]!.repositories[0]!;
  const repository =
    stateName === "repository-changes-open" || !isChanges
      ? existing
      : {
          ...existing,
          changes: stateName === "repository-changes-failed" ? existing.changes : [],
          coverage:
            stateName === "repository-changes-failed" ||
            stateName === "repository-changes-failed-empty"
              ? ("failed" as const)
              : stateName === "repository-changes-unread"
                ? ("unread" as const)
                : ("complete" as const),
        };
  const answer = repositoryChanges(repository);
  const picker = (
    <Button size="sm" variant="secondary">
      <GitBranchIcon />
      main
      <ChevronDownIcon />
    </Button>
  );
  const heading = (
    <GitRepoHeading
      appId="store"
      project={project}
      repo={repo}
      where={repositoryWhere(
        mateOnly
          ? { updatedAt: ago(7) }
          : {
              ...existing.facts!,
              remote: { ...existing.facts!.remote!, url: `https://github.com/acme/${repo}.git` },
            },
      )}
      actions={
        <div className="flex max-w-36 flex-wrap items-center justify-end gap-2 sm:max-w-none">
          {mateOnly ? null : (
            <Button size="sm" variant="secondary">
              <GitHubIcon />
              Open on GitHub
            </Button>
          )}
          <Button size="sm" variant="secondary">
            Clone
          </Button>
          <Button size="sm" variant="secondary" aria-label="Repository menu">
            •••
          </Button>
        </div>
      }
    />
  );
  const files = (
    <div className="flex min-w-0 flex-col gap-5">
      {stateName === "repository-source-failed" ? (
        <Failure
          size="line"
          cause="HQ could not read this repository again. Showing the last read source."
          action={
            <Button variant="ghost" size="sm">
              Read again
            </Button>
          }
        />
      ) : null}
      <GitDirectoryList entries={entries} truncated={false} hrefOf={() => "#"} onOpen={() => {}} />
      <Card size="md" variant="sheet">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <BookOpenIcon aria-hidden="true" className="size-4" />
            <Text render={<h2 />} variant="heading">
              README.md
            </Text>
          </div>
          <RepoMarkdown
            appId="store"
            repo="storefront"
            sha={sha}
            path="README.md"
            content={
              "# storefront\n\nThe shop's front: product pages, the cart and checkout. Deployed by Zerops from zerops.yaml; the Mates of Acme Store work on it in their own copies."
            }
            hrefOf={() => "#"}
            onOpen={() => {}}
          />
        </div>
      </Card>
    </div>
  );
  let content;
  if (["repository-gone", "repository-reading", "repository-no-access"].includes(stateName)) {
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
  } else {
    const banner = hasBanner ? standingOf(bannerId) : null;
    content = (
      <div className="flex min-w-0 flex-col gap-12">
        {heading}
        <div className="flex min-w-0 flex-col gap-5">
          {banner === null ? null : (
            <CodeStandingBanner
              name={project}
              view={banner}
              sentence={codeStandingSentence(project, banner.standing)}
              onAddMate={() => {}}
              onDelete={() => {}}
              onReview={() => {}}
              answer={<GitBrowserLink to={{ appId: bannerId }}>Answer on Git</GitBrowserLink>}
            />
          )}
          <GitRepoTabs
            view={isChanges ? "changes" : "home"}
            openChanges={answer.kind === "read" ? answer.open.length : undefined}
            onTab={() => {}}
            picker={picker}
          />
          {stateName === "repository-home-failed" ? (
            <GitHomeAgain home={{ busy: false, failed: true }} onHomeAgain={() => {}} />
          ) : null}
          {isChanges ? (
            <GitRepoChanges
              appId="store"
              project={project}
              repo={repo}
              search={{}}
              repository={repository}
              changesFailure={
                stateName === "repository-changes-failed" ||
                stateName === "repository-changes-failed-empty"
                  ? "HQ could not refresh changes."
                  : undefined
              }
              onReadChanges={() => {}}
              onOpenChange={() => {}}
            />
          ) : (
            <GitRepoColumns
              about={
                <GitRepoFacts
                  about={about}
                  storage={<GitRepositoryStorage storage={about.storage} />}
                />
              }
            >
              {files}
            </GitRepoColumns>
          )}
        </div>
      </div>
    );
  }
  return (
    <main className="min-h-screen bg-background text-foreground lg:ml-[435px]">
      <Page width="full">{content}</Page>
    </main>
  );
}

createRoot(document.getElementById("design")!).render(<Harness />);
