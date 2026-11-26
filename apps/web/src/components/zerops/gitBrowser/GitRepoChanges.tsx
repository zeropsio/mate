/** Open changes held by the overview, with a way to their history. */
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty";
import { List } from "~/components/ui/list";
import { Text } from "~/components/ui/text";
import { ZeropsGitChangeRow } from "../ZeropsGitChangeRow";
import { repositoryChanges } from "../ZeropsRepositoryBrowser.logic";
import { GitBrowserLink } from "./GitBrowserLink";
import type { GitRepoPageProps } from "./GitBrowseView";

export function GitRepoChanges({
  appId,
  project,
  repo,
  search,
  repository,
  changesFailure,
  onReadChanges,
  onOpenChange,
}: Pick<
  GitRepoPageProps,
  | "appId"
  | "project"
  | "repo"
  | "repository"
  | "changesFailure"
  | "onReadChanges"
  | "onOpenChange"
  | "search"
>) {
  const answer = repositoryChanges(repository);
  const changes = answer.kind === "read" ? answer.open : [];
  return (
    <section aria-label="Open changes" className="flex flex-col gap-2">
      <h2 className="text-emphasis font-medium text-foreground">Open changes</h2>
      {changesFailure === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body text-status-failed" role="alert">
            {changesFailure}
          </p>
          <Button variant="ghost" size="sm" onClick={onReadChanges}>
            Read again
          </Button>
        </div>
      )}
      {answer.kind === "unread" ? (
        <Text render={<p />} variant="description">
          Changes not read yet.
        </Text>
      ) : answer.stale ? (
        <Text render={<p />} variant="description">
          Showing the last read changes.
        </Text>
      ) : null}
      {changes.length > 0 ? (
        <Card variant="flat">
          <div className="px-4 py-1">
            <List>
              {changes.map((change) => (
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
            </List>
          </div>
        </Card>
      ) : answer.kind === "read" && !answer.stale ? (
        <EmptyState size="line">No open changes.</EmptyState>
      ) : null}
      <Text render={<p />} variant="note">
        Merged changes are in{" "}
        <GitBrowserLink
          to={{
            appId,
            repo,
            ...(search.rev === undefined ? {} : { rev: search.rev }),
            view: "commits",
          }}
        >
          History
        </GitBrowserLink>
        .
      </Text>
    </section>
  );
}
