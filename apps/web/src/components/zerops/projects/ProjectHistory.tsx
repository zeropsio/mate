/**
 * A project page's History: its releases, newest first, one row each — its version, Live or
 * Rolled back, when, how many changes — opening to the changes it put live, each the row the
 * card's Changes draws (`historyReleases`). What no release put live yet stays in the card's
 * Changes alone.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";
import { createContext, useMemo, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useRepositoryHistory } from "~/zerops/useRepositoryHistory";

import { GitBrowserLink, gitCommitLink, type GitRepoAt } from "../gitBrowser/GitBrowserLink";
import { ChangeAge, ChangeRow } from "./ChangeRow";
import {
  groupRepository,
  historyReleases,
  outsideLine,
  RELEASE_STATE_WORDS,
  releaseLine,
  shownReleases,
  type HistoryRelease,
} from "./projectHistory.logic";

/** The page's History section, which the page's flow alone can draw, for its column. */
export const ProjectPageHistory = createContext<ReactNode>(null);

const NO_COMMITS: never[] = [];

/** A project's History from its flow, with `main`'s commits for the ones no Mate's change landed. */
export function ProjectHistory({
  groupId,
  flow,
  face,
  mateName,
  onOpen,
}: {
  readonly groupId: string;
  /** `undefined` until its flow is read. */
  readonly flow: ZeropsProjectFlow | undefined;
  readonly face: (projectId: string) => ReactNode;
  readonly mateName: (projectId: string) => string | undefined;
  readonly onOpen: (change: FlowPullRequest, from: HTMLElement) => void;
}) {
  const repository = flow === undefined ? undefined : groupRepository(flow.environments);
  const history = useRepositoryHistory({ appId: groupId, repo: repository, repos: flow?.repos });
  const commits = history.kind === "read" ? history.commits : NO_COMMITS;
  const releases = useMemo(
    () =>
      flow?.releasesKnown === true
        ? historyReleases({ releases: flow.releases, merged: flow.merged, commits })
        : undefined,
    [commits, flow],
  );
  return (
    <ProjectHistoryView
      face={face}
      mateName={mateName}
      onOpen={onOpen}
      releases={releases}
      repo={repository === undefined ? undefined : { appId: groupId, repo: repository }}
    />
  );
}

export function ProjectHistoryView({
  releases,
  repo,
  face,
  mateName,
  onOpen,
}: {
  /** Newest first; `undefined` until HQ has told them. */
  readonly releases: ReadonlyArray<HistoryRelease> | undefined;
  /** The repository its commits are on, to open them in the Git browser; none until known. */
  readonly repo?: GitRepoAt | undefined;
  readonly face: (projectId: string) => ReactNode;
  readonly mateName: (projectId: string) => string | undefined;
  readonly onOpen: (change: FlowPullRequest, from: HTMLElement) => void;
}) {
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  // Until HQ answers, its line's place is held: the column does not grow when it lands.
  if (releases === undefined)
    return <p aria-hidden="true" className="ov-sec-empty ov-history-note" />;
  if (releases.length === 0)
    return <p className="ov-sec-empty ov-history-note">Nothing released yet.</p>;
  const shown = shownReleases(releases, all);
  const toggle = (tag: string) => {
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(tag)) next.add(tag);
      return next;
    });
  };
  return (
    <>
      <ul className="ov-history" data-zerops-surface="project-history">
        {shown.rows.map((release) => (
          <ReleaseRow
            face={face}
            key={release.tag}
            mateName={mateName}
            onOpen={onOpen}
            onToggle={() => {
              toggle(release.tag);
            }}
            open={opened.has(release.tag)}
            release={release}
            repo={repo}
          />
        ))}
      </ul>
      {shown.all === undefined ? null : (
        <div className="ov-history-more">
          <Button
            onClick={() => {
              setAll((current) => !current);
            }}
            size="sm"
            variant="ghost"
          >
            {all ? "Show fewer" : `Show all ${String(shown.all)}`}
          </Button>
        </div>
      )}
    </>
  );
}

function ReleaseRow({
  release,
  repo,
  open,
  onToggle,
  face,
  mateName,
  onOpen,
}: {
  readonly release: HistoryRelease;
  readonly repo: GitRepoAt | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly face: (projectId: string) => ReactNode;
  readonly mateName: (projectId: string) => string | undefined;
  readonly onOpen: (change: FlowPullRequest, from: HTMLElement) => void;
}) {
  // A roll back put nothing of its own live: nothing to open.
  const opens = release.changes.length > 0 || release.outside.length > 0;
  const head = (
    <>
      <span aria-hidden="true" className="ov-history-chevron">
        {opens ? <ChevronRightIcon data-open={open ? "true" : undefined} /> : null}
      </span>
      <span className="ov-change-text">
        <span className="ov-history-name">
          <span className="ov-history-tag">{release.tag}</span>
          {release.state === undefined ? null : (
            <span className="ov-history-state" data-state={release.state}>
              {RELEASE_STATE_WORDS[release.state]}
            </span>
          )}
        </span>
        <span className="ov-change-line">{releaseLine(release)}</span>
      </span>
      <span className="ov-change-end">
        <ChangeAge at={release.taggedAt} />
      </span>
    </>
  );
  return (
    <li data-zerops-surface="project-history-release">
      {opens ? (
        <button aria-expanded={open} className="ov-change" onClick={onToggle} type="button">
          {head}
        </button>
      ) : (
        <div className="ov-change">{head}</div>
      )}
      {open ? (
        <ul className="ov-changes ov-history-changes">
          {release.changes.map((change) => {
            const by = mateName(change.mateProjectId);
            return (
              <ChangeRow
                at={change.mergedAt}
                face={face(change.mateProjectId)}
                key={`${change.repository}#${String(change.number)}`}
                line={by ?? change.line}
                onOpen={(from) => {
                  onOpen(change, from);
                }}
                open={false}
                pull={change}
              />
            );
          })}
          {release.outside.length === 0 ? null : (
            <OutsideLine commits={release.outside} repo={repo} />
          )}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * A release's commits no Mate's change landed: one quiet line, opening to their subjects, each
 * opening its page in the Git browser.
 */
function OutsideLine({
  commits,
  repo,
}: {
  readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  readonly repo: GitRepoAt | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li data-zerops-surface="project-history-outside">
      <button
        aria-expanded={open}
        className="ov-change"
        onClick={() => {
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span aria-hidden="true" className="ov-history-chevron">
          <ChevronRightIcon data-open={open ? "true" : undefined} />
        </span>
        <span className="ov-change-line">{outsideLine(commits.length)}</span>
      </button>
      {open ? (
        <ul className="ov-history-subjects">
          {commits.map((commit) => (
            <li className="ov-change-line" key={commit.sha}>
              {repo === undefined ? (
                commit.subject
              ) : (
                <GitBrowserLink to={gitCommitLink(repo, commit.sha)} tone="muted">
                  {commit.subject}
                </GitBrowserLink>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
