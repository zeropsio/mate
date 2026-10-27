/** Application history reads recorded release membership; only an expanded row requests Git content. */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";
import { createContext, useMemo, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useRepositoryHistory } from "~/zerops/useRepositoryHistory";

import { GitBrowserLink, gitCommitLink, type GitRepoAt } from "../gitBrowser/GitBrowserLink";
import { ChangeAge, ChangeRow } from "./ChangeRow";
import {
  changeTitle,
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

/** A project's History from its recorded release membership and domain change rows. */
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
  const releases = useMemo(
    () =>
      flow?.releasesKnown === true
        ? historyReleases({ releases: flow.releases, merged: flow.merged })
        : undefined,
    [flow],
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
  const opens = repo !== undefined || release.changes.length > 0;
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
        <span className="ov-change-line">
          {releaseLine(release)}
          {release.commitCount === undefined
            ? null
            : ` · ${String(release.commitCount)} ${release.commitCount === 1 ? "commit" : "commits"}`}
        </span>
        {release.changeTitles?.map((title, index) => (
          <span className="ov-change-line" key={`${String(index)}-${title}`}>
            {title}
          </span>
        ))}
        {release.outsideCommitCount ? (
          <span className="ov-change-line">{outsideLine(release.outsideCommitCount)}</span>
        ) : null}
        {release.changeTitles === undefined && repo !== undefined ? (
          <span className="ov-change-line">Earlier membership not recorded · Open History</span>
        ) : null}
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
          {repo === undefined ? null : <ExpandedRelease release={release} repo={repo} />}
        </ul>
      ) : null}
    </li>
  );
}

/** Git content is requested only while the person has opened this release. */
function ExpandedRelease({
  release,
  repo,
}: {
  readonly release: HistoryRelease;
  readonly repo: GitRepoAt;
}) {
  if (release.ranges === undefined)
    return (
      <li className="ov-change-line">
        <GitBrowserLink to={{ ...repo, view: "commits" }}>History</GitBrowserLink>
      </li>
    );
  const ranges = release.ranges;
  return (
    <>
      {ranges.map((range) => (
        <ExpandedRange
          key={`${range.repo}-${range.head}`}
          repo={{ ...repo, repo: range.repo }}
          head={range.head}
          base={range.base ?? undefined}
        />
      ))}
    </>
  );
}

function ExpandedRange({
  repo,
  head,
  base,
}: {
  readonly repo: GitRepoAt;
  readonly head: string;
  readonly base: string | undefined;
}) {
  const history = useRepositoryHistory({
    appId: repo.appId,
    repo: repo.repo,
    repos: undefined,
    revision: head,
    base,
  });
  if (history.kind === "reading")
    return <li className="ov-change-line">Reading commit messages…</li>;
  if (history.kind === "failed") return <li className="ov-change-line">{history.reason}</li>;
  if (history.commits.length === 0) return <li className="ov-change-line">No commits.</li>;
  return (
    <>
      {history.commits.map((commit) => (
        <li className="ov-change-line" key={commit.sha}>
          <GitBrowserLink to={gitCommitLink(repo, commit.sha)}>
            {changeTitle(commit.subject)}
          </GitBrowserLink>
        </li>
      ))}
    </>
  );
}
