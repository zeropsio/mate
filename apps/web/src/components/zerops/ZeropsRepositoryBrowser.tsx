import { FileIcon, FolderIcon } from "lucide-react";
import { useMemo } from "react";
import type { GitOverviewRepository } from "@t3tools/client-runtime/zerops";
import type { RepositorySource } from "@t3tools/shared/hqGit";
import { appBasePath } from "~/basePath";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import { GitBrowseView, gitView, type GitBrowseSearch } from "./gitBrowser/GitBrowseView";
import { GitRepoFrame, GitRepoHeading } from "./gitBrowser/GitRepoFrame";

export function ZeropsRepositorySource({
  source,
  onOpen,
}: {
  readonly source: RepositorySource;
  readonly onOpen: (path: string, kind: "tree" | "file") => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {source.kind === "file" ? (
        source.binary ? (
          <p className="text-sm text-muted-foreground">
            Binary file. Clone the repository to read it.
          </p>
        ) : (
          <pre className="overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs text-foreground">
            <code>{source.content}</code>
          </pre>
        )
      ) : source.revision === null ? (
        <p className="text-sm text-muted-foreground">No commits on this branch yet.</p>
      ) : source.entries.length === 0 && !source.truncated ? (
        <p className="text-sm text-muted-foreground">No files here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {source.entries.map((entry) => (
            <li className="flex min-h-10 items-center justify-between gap-3" key={entry.path}>
              {entry.type === "commit" ? (
                <span className="text-sm text-foreground">
                  {entry.path} · submodule {entry.sha.slice(0, 7)}
                </span>
              ) : (
                <button
                  className="flex min-w-0 cursor-pointer items-center gap-3 rounded-sm text-left text-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  onClick={() =>
                    onOpen(
                      [source.path, entry.path].filter(Boolean).join("/"),
                      entry.type === "tree" ? "tree" : "file",
                    )
                  }
                >
                  {entry.type === "tree" ? (
                    <FolderIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{entry.path}</span>
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {entry.type === "tree"
                  ? "Folder"
                  : entry.mode === "120000"
                    ? "Symbolic link"
                    : entry.type === "commit"
                      ? "Submodule"
                      : "File"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {source.truncated ? (
        <p className="text-sm text-muted-foreground">
          Only the first{" "}
          {source.kind === "file"
            ? "256 KiB are shown. Clone to read the whole file."
            : "entries are shown. Clone to read the whole directory."}
        </p>
      ) : null}
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
  const changes = useMemo(
    () => (repository?.changes ?? []).map(({ pull }) => pull),
    [repository?.changes],
  );
  if (allowed !== true || home.view.state === "withheld") {
    return (
      <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
        <GitRepoHeading project={project} repo={repo} onBack={onBack} />
        <p className="text-sm text-muted-foreground" role="alert">
          {accessReason ??
            (allowed === undefined
              ? "Your access to this repository has not been verified."
              : "You do not have access to this repository.")}
        </p>
      </section>
    );
  }
  const view = gitView(query);
  const hrefOf = (search: GitBrowseSearch) =>
    `${appBasePath()}/git?${new URLSearchParams({ appId, repo, ...search })}`;
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
