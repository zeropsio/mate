/**
 * A repository's home at the commit its branch, tag or commit names now: its open changes, what
 * it is, its top folder, and its README — every part read at that one commit.
 */
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { ZeropsGitChangeRow } from "../ZeropsGitChangeRow";
import { ZeropsRepositorySource } from "../ZeropsRepositorySource";
import type { GitRepoPageProps } from "./GitBrowseView";
import { GitWhen } from "./GitWhen";
import { RepoMarkdown, type RepoPathTarget } from "./RepoMarkdown";

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

/** A home read moves with its ref: read again on the person's ask, said when that read failed. */
function HomeAgain({
  home,
  onHomeAgain,
}: {
  readonly home: { readonly busy: boolean; readonly failed: boolean };
  readonly onHomeAgain: () => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-3">
      {home.failed ? (
        <span className="text-status-failed" role="alert">
          HQ could not read this again. Showing the last read.
        </span>
      ) : null}
      <Button variant="ghost" size="sm" disabled={home.busy} onClick={onHomeAgain}>
        Read again
      </Button>
    </span>
  );
}

function HomeAt({
  home,
  sha,
  again: homeAgain,
  source: { source, again },
  navigate,
  hrefOf,
}: Pick<GitRepoPageProps, "source" | "navigate" | "hrefOf"> & {
  readonly home: GitHome;
  readonly sha: string;
  readonly again: ReactNode;
}) {
  // The frame reads the top folder at the very commit the home read resolved (`pageSource`), so a
  // branch moving between the two reads cannot pair one commit's README with another's files.
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
            {source.state === "known" && source.failed ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-status-failed" role="alert">
                  HQ could not read this repository again. Showing the last read source.
                </p>
                <Button variant="ghost" size="sm" disabled={source.busy} onClick={again}>
                  Read again
                </Button>
              </div>
            ) : null}
            {source.state === "known" ? (
              <ZeropsRepositorySource
                source={source.source}
                onOpen={(path, kind) =>
                  navigate({
                    rev: sha,
                    view: "code",
                    path,
                    kind,
                  })
                }
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p
                  className="text-sm text-muted-foreground"
                  role={source.alert ? "alert" : "status"}
                >
                  {source.state === "reading" ? "Reading source…" : source.words}
                </p>
                <Button variant="ghost" size="sm" disabled={source.busy} onClick={again}>
                  Read again
                </Button>
              </div>
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
  const { home, onHomeAgain } = props;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <OpenChanges {...props} />
      {home.state === "known" ? (
        home.answer.sha === null ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <p>No commits on this branch yet.</p>
            <HomeAgain home={home} onHomeAgain={onHomeAgain} />
          </div>
        ) : (
          <HomeAt
            {...props}
            home={home.answer}
            sha={home.answer.sha}
            again={<HomeAgain home={home} onHomeAgain={onHomeAgain} />}
          />
        )
      ) : home.state === "withheld" ? null : home.state === "unread" ? (
        <p className="text-sm text-muted-foreground" role="status">
          Reading the repository…
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-status-failed" role="alert">
            {home.state === "refused" &&
            // A revision HQ cannot read as one (empty, or read as an option) names no commit either.
            (home.reason === "commit_not_found" || home.reason === "invalid")
              ? "This branch, tag or commit is not in the repository."
              : home.words}
          </p>
          <Button variant="ghost" size="sm" onClick={onHomeAgain}>
            Read again
          </Button>
        </div>
      )}
    </div>
  );
}
