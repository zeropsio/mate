import { defaultStringifySearch } from "@tanstack/react-router";
import { useMemo } from "react";
import type { GitOverviewRepository } from "@t3tools/client-runtime/zerops";
import { appBasePath } from "~/basePath";
import { useGitBrowse, useGitBrowseReads } from "~/zerops/useGitBrowse";
import { GitBrowseView, gitView, pageRead, type GitBrowseSearch } from "./gitBrowser/GitBrowseView";
import { GitRepoFrame, GitRepoHeading } from "./gitBrowser/GitRepoFrame";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Loading } from "~/components/ui/loading";
import { repositoryPage } from "./ZeropsRepositoryBrowser.logic";

export function RepositoryGone({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Text render={<p />} variant="description">
        This repository is not here: it was deleted or your access was removed.
      </Text>
      <Button variant="link" size="sm" onClick={onBack}>
        Back to Git
      </Button>
    </div>
  );
}

/**
 * A repository in the Git browser: its frame and the page its link names, read only while the
 * person's access to the application is verified.
 */
export function ZeropsRepositoryBrowser({
  appId,
  project,
  repository,
  changesFailure,
  onReadChanges,
  onOpenChange,
  allowed,
  accessReason,
  appsKnown,
  appListed,
  repositories,
  repo,
  query,
  onNavigate,
  onBack,
}: {
  readonly appId: string;
  readonly project: string;
  readonly repository?: GitOverviewRepository | undefined;
  readonly changesFailure?: string | undefined;
  readonly onReadChanges?: (() => void) | undefined;
  readonly onOpenChange?: ((number: number) => void) | undefined;
  readonly allowed: boolean | undefined;
  readonly accessReason?: string | undefined;
  readonly appsKnown: boolean;
  readonly appListed: boolean;
  readonly repositories: ReadonlyArray<string> | undefined;
  readonly repo: string;
  readonly query: GitBrowseSearch;
  /** Opens another page of this repository: the whole link, never merged into the last one. */
  readonly onNavigate: (search: GitBrowseSearch) => void;
  readonly onBack: () => void;
}) {
  const { rev } = query;
  const view = gitView(query);
  const home = useGitBrowse(
    {
      appId,
      repo,
      read: "home",
      params: {
        ...(rev === undefined ? {} : { rev }),
        ...(view === "home"
          ? {}
          : {
              content:
                rev !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(rev)
                  ? ("revision" as const)
                  : ("metadata" as const),
            }),
      },
    },
    allowed,
  );
  const drawn = pageRead(view, query, home.view, { appId, repo });
  const page = useGitBrowseReads(drawn === null ? [] : [drawn], allowed);
  const changes = useMemo(
    () => (repository?.changes ?? []).map(({ pull }) => pull),
    [repository?.changes],
  );
  const state = repositoryPage({
    appsKnown,
    appListed,
    repositories,
    repo,
    allowed,
    accessReason,
    // The projection also withholds while the offer is unknown, before any read is made.
    withheld:
      allowed === true &&
      (home.view.state === "withheld" || page.views.some((read) => read.state === "withheld")),
    homeRefusal: home.view.state === "refused" ? home.view.reason : undefined,
  });
  if (state.kind !== "open") {
    return (
      <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
        <GitRepoHeading project={project} repo={repo} onBack={onBack} />
        {state.kind === "reading" ? (
          <Loading label="The repository" shape="lines" />
        ) : state.kind === "gone" ? (
          <RepositoryGone onBack={onBack} />
        ) : (
          <Text render={<p />} variant="description" role="alert">
            {state.reason}
          </Text>
        )}
      </section>
    );
  }
  // The router's own stringifier: a path such as `2024` or `true` reads back as the same string.
  const hrefOf = (search: GitBrowseSearch) =>
    `${appBasePath()}/git${defaultStringifySearch({ appId, repo, ...search })}`;
  return (
    <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
      <GitRepoFrame
        appId={appId}
        repo={repo}
        project={project}
        rev={rev}
        view={view}
        home={home.view}
        changes={changes}
        onBack={onBack}
        onPick={(next) => onNavigate({ rev: next })}
        onTab={(next) => onNavigate({ ...(rev === undefined ? {} : { rev }), view: next })}
      />
      <GitBrowseView
        view={view}
        appId={appId}
        repo={repo}
        project={project}
        search={query}
        home={home.view}
        onHomeAgain={home.again}
        repository={repository}
        changesFailure={changesFailure}
        onReadChanges={onReadChanges}
        onOpenChange={onOpenChange}
        navigate={onNavigate}
        hrefOf={hrefOf}
      />
    </section>
  );
}
