/** Open changes held by the overview, with a way to their history. */
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty";
import { Failure } from "~/components/ui/failure";
import { LogoTile } from "~/components/ui/logo-tile";
import { Section } from "~/components/ui/section";
import { GitPullRequestIcon } from "lucide-react";
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
    <Section title="Open changes" count={answer.kind === "read" ? changes.length : undefined}>
      {changesFailure === undefined ? (
        answer.kind === "read" && answer.stale ? (
          <Text variant="description">Showing the last read changes.</Text>
        ) : null
      ) : (
        <Failure
          size="line"
          role="alert"
          cause={changesFailure}
          action={
            <Button variant="ghost" size="sm" onClick={onReadChanges}>
              Read again
            </Button>
          }
        >
          {answer.kind === "read" && answer.stale ? "Showing the last read changes." : null}
        </Failure>
      )}
      {answer.kind === "unread" ? <EmptyState size="line">Changes not read yet.</EmptyState> : null}
      {changes.length > 0 ? (
        <Card size="rows" variant="sheet">
          <div className="flex flex-col gap-0.5">
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
          </div>
        </Card>
      ) : answer.kind === "read" && !answer.stale ? (
        <Card variant="sheet">
          <EmptyState
            mark={
              <LogoTile size="xl">
                <GitPullRequestIcon />
              </LogoTile>
            }
            title="No open changes"
          >
            When a Mate of {project} opens a change{" "}
            {repo === "group" ? "on its setup" : `on ${repo}`}, it waits here for review.
          </EmptyState>
        </Card>
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
    </Section>
  );
}
