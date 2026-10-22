import { defaultStringifySearch } from "@tanstack/react-router";
import { useMemo } from "react";
import type { GitOverviewRepository } from "@t3tools/client-runtime/zerops";
import { appBasePath } from "~/basePath";
import { useGitBrowse, useGitBrowseReads } from "~/zerops/useGitBrowse";
import { NO_LONGER_ALLOWED } from "./gitBrowser/GitAtCommit";
import { GitBrowseView, gitView, pageRead, type GitBrowseSearch } from "./gitBrowser/GitBrowseView";
import { GitRepoFrame, GitRepoHeading } from "./gitBrowser/GitRepoFrame";

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
  readonly repo: string;
  readonly query: GitBrowseSearch;
  /** Opens another page of this repository: the whole link, never merged into the last one. */
  readonly onNavigate: (search: GitBrowseSearch) => void;
  readonly onBack: () => void;
}) {
  const { rev } = query;
  const home = useGitBrowse(
    { appId, repo, read: "home", params: rev === undefined ? {} : { rev } },
    allowed,
  );
  const view = gitView(query);
  const drawn = pageRead(view, query, home.view, { appId, repo });
  const page = useGitBrowseReads(drawn === null ? [] : [drawn], allowed);
  const changes = useMemo(
    () => (repository?.changes ?? []).map(({ pull }) => pull),
    [repository?.changes],
  );
  // Any read HQ refused for this repository withholds all of it, before the offers catch up.
  if (
    allowed !== true ||
    home.view.state === "withheld" ||
    page.views.some((read) => read.state === "withheld")
  ) {
    return (
      <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
        <GitRepoHeading project={project} repo={repo} onBack={onBack} />
        <p className="text-sm text-muted-foreground" role="alert">
          {allowed === true
            ? // HQ said no after the offers said yes.
              NO_LONGER_ALLOWED
            : (accessReason ??
              (allowed === undefined
                ? "Your access to this repository has not been verified."
                : "You do not have access to this repository."))}
        </p>
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
