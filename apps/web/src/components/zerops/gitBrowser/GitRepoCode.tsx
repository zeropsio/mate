/**
 * A folder or file of the repository at the commit the page's branch, tag or commit names now:
 * the folder tree beside it, where it is, and its entries or its text. Every read and every link
 * out names that one commit.
 */
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type { ReactNode } from "react";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import type { GitBrowseSearch, GitRepoPageProps } from "./GitBrowseView";
import { GitAtCommit, GitNotRead } from "./GitAtCommit";
import { GitDirectoryList } from "./GitDirectoryList";
import { GitFileView } from "./GitFileView";
import { GitPathCrumbs } from "./GitPathCrumbs";
import { GitTreeSidebar } from "./GitTreeSidebar";
import type { RepoPathTarget } from "./RepoMarkdown";

/** The last answer kept through a failed read again, said with Read again. */
function Stale({ onAgain }: { readonly onAgain: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-status-failed" role="alert">
        HQ could not read this repository again. Showing the last read source.
      </p>
      <Button variant="ghost" size="sm" onClick={onAgain}>
        Read again
      </Button>
    </div>
  );
}

function Folder({
  appId,
  repo,
  sha,
  path,
  open,
  hrefOf,
}: {
  readonly appId: string;
  readonly repo: string;
  readonly sha: string;
  readonly path: string;
  readonly open: (target: RepoPathTarget) => void;
  readonly hrefOf: (target: RepoPathTarget) => string;
}) {
  const { view, again } = useGitBrowse({ appId, repo, read: "tree", params: { sha, path } }, true);
  if (view.state !== "known")
    return (
      <GitNotRead view={view} reading="Reading source…" at={{ appId, repo }} onAgain={again} />
    );
  const target = (entry: { readonly path: string; readonly type: string }): RepoPathTarget => ({
    path: entry.path,
    kind: entry.type === "folder" ? "tree" : "file",
  });
  return (
    <>
      {view.failed ? <Stale onAgain={again} /> : null}
      <GitDirectoryList
        entries={view.answer.entries}
        truncated={view.answer.truncated}
        hrefOf={(entry) => hrefOf(target(entry))}
        onOpen={(entry) => open(target(entry))}
      />
    </>
  );
}

function FileAt({
  appId,
  repo,
  sha,
  path,
  search,
  navigate,
  hrefOf,
  hasView,
  folder,
}: Pick<GitRepoPageProps, "appId" | "repo" | "search" | "navigate" | "hrefOf" | "hasView"> & {
  readonly sha: string;
  readonly path: string;
  /** The path as the folder it is at the commit: a link may name a folder as a file. */
  readonly folder: ReactNode;
}) {
  const { view, again } = useGitBrowse({ appId, repo, read: "blob", params: { sha, path } }, true);
  if (view.state === "refused" && view.reason === "not_a_file") return folder;
  if (view.state !== "known")
    return (
      <GitNotRead view={view} reading="Reading source…" at={{ appId, repo }} onAgain={again} />
    );
  return (
    <>
      {view.failed ? <Stale onAgain={again} /> : null}
      <GitFileView
        key={`${sha}:${path}`}
        appId={appId}
        repo={repo}
        sha={sha}
        blob={view.answer}
        search={search}
        navigate={navigate}
        hrefOf={hrefOf}
        hasView={hasView}
      />
    </>
  );
}

export function GitRepoCode(props: GitRepoPageProps) {
  const { appId, repo, search, home, onHomeAgain, navigate, hrefOf, hasView } = props;
  const path = search.path ?? "";
  const kind = search.kind ?? "tree";
  return (
    <GitAtCommit at={{ appId, repo }} home={home} onHomeAgain={onHomeAgain}>
      {(_home, sha) => {
        // A link out of what was read names the commit it was read at, never the branch.
        const at = (target: RepoPathTarget): GitBrowseSearch => ({
          rev: sha,
          view: "code",
          ...target,
        });
        const open = (target: RepoPathTarget) => navigate(at(target));
        const href = (target: RepoPathTarget) => hrefOf(at(target));
        const folder = (
          <Folder appId={appId} repo={repo} sha={sha} path={path} open={open} hrefOf={href} />
        );
        return (
          <div className="flex min-w-0 gap-4">
            <GitTreeSidebar
              key={sha}
              appId={appId}
              repo={repo}
              sha={sha}
              path={path}
              kind={kind}
              onOpen={open}
            />
            <div className="min-w-0 flex-1">
              <Card variant="flat">
                <div className="flex min-w-0 flex-col gap-3 p-4">
                  <GitPathCrumbs repo={repo} at={{ path, kind }} hrefOf={href} onOpen={open} />
                  {kind === "tree" ? (
                    folder
                  ) : (
                    <FileAt
                      appId={appId}
                      repo={repo}
                      sha={sha}
                      path={path}
                      search={search}
                      navigate={navigate}
                      hrefOf={hrefOf}
                      hasView={hasView}
                      folder={folder}
                    />
                  )}
                </div>
              </Card>
            </div>
          </div>
        );
      }}
    </GitAtCommit>
  );
}
