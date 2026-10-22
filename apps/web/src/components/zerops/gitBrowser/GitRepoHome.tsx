/**
 * A repository's home at the commit its branch, tag or commit names now: its open changes, what
 * it is, its top folder, and its README — every part read at that one commit.
 */
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import { ZeropsGitChangeRow } from "../ZeropsGitChangeRow";
import type { GitRepoPageProps } from "./GitBrowseView";
import { GitAtCommit, GitHomeAgain, GitNotRead } from "./GitAtCommit";
import { GitDirectoryList } from "./GitDirectoryList";
import { GitWhen } from "./GitWhen";
import { RepoMarkdown, type RepoPathTarget } from "./RepoMarkdown";

const entryTarget = (entry: { readonly path: string; readonly type: string }): RepoPathTarget => ({
  path: entry.path,
  kind: entry.type === "folder" ? "tree" : "file",
});

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function OpenChanges({
  project,
  repo,
  repository,
  changesFailure,
  onReadChanges,
  onOpenChange,
}: Pick<
  GitRepoPageProps,
  "project" | "repo" | "repository" | "changesFailure" | "onReadChanges" | "onOpenChange"
>) {
  return (
    <section aria-label="Open changes" className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-foreground">Open changes</h2>
      {changesFailure === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-status-failed" role="alert">
            {changesFailure}
          </p>
          <Button variant="ghost" size="sm" onClick={onReadChanges}>
            Read again
          </Button>
        </div>
      )}
      {repository === undefined || repository.coverage === "unread" ? (
        <p className="text-sm text-muted-foreground">Changes not read yet.</p>
      ) : repository.coverage === "failed" ? (
        <p className="text-sm text-muted-foreground">Showing the last read changes.</p>
      ) : null}
      {repository !== undefined && repository.changes.length > 0 ? (
        <Card variant="flat">
          <div className="divide-y divide-border px-4 py-1">
            {repository.changes.map((change) => (
              <ZeropsGitChangeRow
                key={change.pull.number}
                change={change}
                project={project}
                repo={repo}
                onOpen={
                  onOpenChange === undefined ? undefined : () => onOpenChange(change.pull.number)
                }
              />
            ))}
          </div>
        </Card>
      ) : repository?.coverage === "complete" ? (
        <p className="text-sm text-muted-foreground">No open changes.</p>
      ) : null}
    </section>
  );
}

function HomeAt({
  appId,
  repo,
  home,
  sha,
  again: homeAgain,
  navigate,
  hrefOf,
}: Pick<GitRepoPageProps, "appId" | "repo" | "navigate" | "hrefOf"> & {
  readonly home: GitHome;
  readonly sha: string;
  /** Read again for the home read itself: the ref may have moved since. */
  readonly again: ReactNode;
}) {
  // The top folder at the very commit the home read resolved, so a branch moving between the two
  // reads cannot pair one commit's README with another's files.
  const { view: top, again } = useGitBrowse(
    { appId, repo, read: "tree", params: { sha, path: "" } },
    true,
  );
  const atCommit = (target: RepoPathTarget) => ({ rev: sha, view: "code" as const, ...target });
  const { about, readme } = home;
  return (
    <>
      <Card variant="flat">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm text-muted-foreground">
          <GitWhen at={about.updatedAt}>Updated {formatRelativeTimeLabel(about.updatedAt)}</GitWhen>
          <span>{count(about.branchCount, "branch", "branches")}</span>
          <span>{count(about.tagCount, "tag", "tags")}</span>
          {homeAgain}
        </div>
      </Card>
      <section aria-label="Source" className="flex min-w-0 flex-col gap-2">
        <Card variant="flat">
          <div className="flex min-w-0 flex-col gap-3 p-4">
            {top.state === "known" && top.failed ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-status-failed" role="alert">
                  HQ could not read this repository again. Showing the last read source.
                </p>
                <Button variant="ghost" size="sm" disabled={top.busy} onClick={again}>
                  Read again
                </Button>
              </div>
            ) : null}
            {top.state === "known" ? (
              <GitDirectoryList
                entries={top.answer.entries}
                truncated={top.answer.truncated}
                hrefOf={(entry) => hrefOf(atCommit(entryTarget(entry)))}
                onOpen={(entry) => navigate(atCommit(entryTarget(entry)))}
              />
            ) : (
              <GitNotRead
                view={top}
                reading="Reading source…"
                at={{ appId, repo }}
                onAgain={again}
              />
            )}
          </div>
        </Card>
      </section>
      {readme === null ? null : (
        <section aria-label="README" className="flex min-w-0 flex-col gap-2">
          <Card variant="flat">
            <div className="flex min-w-0 flex-col gap-3 p-4">
              <h2 className="font-mono text-xs text-muted-foreground">{readme.path}</h2>
              <RepoMarkdown
                appId={appId}
                repo={repo}
                sha={sha}
                path={readme.path}
                content={readme.content}
                hrefOf={(target) => hrefOf(atCommit(target))}
                onOpen={(target) => navigate(atCommit(target))}
              />
              {readme.truncated ? (
                <p className="text-sm text-muted-foreground">
                  Only the first 256 KiB are shown. Clone to read the whole file.
                </p>
              ) : null}
            </div>
          </Card>
        </section>
      )}
    </>
  );
}

export function GitRepoHome(props: GitRepoPageProps) {
  const { appId, repo, home, onHomeAgain } = props;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <OpenChanges {...props} />
      <GitAtCommit at={{ appId, repo }} home={home} onHomeAgain={onHomeAgain}>
        {(answer, sha) => (
          <HomeAt
            {...props}
            home={answer}
            sha={sha}
            again={
              home.state === "known" ? <GitHomeAgain home={home} onHomeAgain={onHomeAgain} /> : null
            }
          />
        )}
      </GitAtCommit>
    </div>
  );
}
