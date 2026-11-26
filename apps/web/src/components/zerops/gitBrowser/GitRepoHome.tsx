/**
 * A repository's top folder and README at the commit its branch, tag or commit names now.
 */
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Failure } from "~/components/ui/failure";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import type { GitRepoPageProps } from "./GitBrowseView";
import { GitAtCommit, GitNotRead } from "./GitAtCommit";
import { GitDirectoryList } from "./GitDirectoryList";
import { RepoMarkdown, type RepoPathTarget } from "./RepoMarkdown";
import { Text } from "~/components/ui/text";

const entryTarget = (entry: { readonly path: string; readonly type: string }): RepoPathTarget => ({
  path: entry.path,
  kind: entry.type === "folder" ? "tree" : "file",
});

function HomeAt({
  appId,
  repo,
  home,
  sha,
  navigate,
  hrefOf,
}: Pick<GitRepoPageProps, "appId" | "repo" | "navigate" | "hrefOf"> & {
  readonly home: GitHome;
  readonly sha: string;
}) {
  // The top folder at the very commit the home read resolved, so a branch moving between the two
  // reads cannot pair one commit's README with another's files.
  const { view: top, again } = useGitBrowse(
    { appId, repo, read: "tree", params: { sha, path: "" } },
    true,
  );
  const atCommit = (target: RepoPathTarget) => ({ rev: sha, view: "code" as const, ...target });
  const { readme } = home;
  return (
    <>
      <section aria-label="Source" className="flex min-w-0 flex-col gap-2">
        <Card variant="flat">
          <div className="flex min-w-0 flex-col gap-3 p-4">
            {top.state === "known" && top.failed ? (
              <Failure
                size="line"
                role="alert"
                cause="HQ could not read this repository again. Showing the last read source."
                action={
                  <Button variant="ghost" size="sm" disabled={top.busy} onClick={again}>
                    Read again
                  </Button>
                }
              />
            ) : null}
            {top.state === "known" ? (
              <GitDirectoryList
                entries={top.answer.entries}
                truncated={top.answer.truncated}
                hrefOf={(entry) => hrefOf(atCommit(entryTarget(entry)))}
                onOpen={(entry) => navigate(atCommit(entryTarget(entry)))}
              />
            ) : (
              <GitNotRead view={top} subject="The source" at={{ appId, repo }} onAgain={again} />
            )}
          </div>
        </Card>
      </section>
      {readme === null ? null : (
        <section aria-label="README" className="flex min-w-0 flex-col gap-2">
          <Card variant="flat">
            <div className="flex min-w-0 flex-col gap-3 p-4">
              <h2 className="font-mono text-caption text-muted-foreground">{readme.path}</h2>
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
                <Text render={<p />} variant="description">
                  Only the first 256 KiB are shown. Clone to read the whole file.
                </Text>
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
      <GitAtCommit at={{ appId, repo }} home={home} onHomeAgain={onHomeAgain}>
        {(answer, sha) => <HomeAt {...props} home={answer} sha={sha} />}
      </GitAtCommit>
    </div>
  );
}
