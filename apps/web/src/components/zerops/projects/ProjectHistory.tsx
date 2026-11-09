/**
 * A project's History, from the release membership HQ recorded: a row per release — its version,
 * Live on the one production runs, and when — opening to the changes it put live, each said once as
 * a change row. Nothing here reads Git.
 */
import { releaseFailure, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon, GitMergeIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useAccountOrgId } from "~/zerops/accountData";
import { useNowMs } from "~/zerops/useNowMs";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";

import { GitBrowserLink, type GitRepoAt } from "../gitBrowser/GitBrowserLink";
import { ChangeList, ChangeRow } from "../system/ChangeRow";
import {
  groupRepository,
  historyReleases,
  outsideLine,
  RELEASE_STATE_WORDS,
  releaseFacts,
  releaseGist,
  shownReleases,
  type HistoryChange,
  type HistoryRelease,
} from "./projectHistory.logic";

/** A change as History opens it: by its repository and number. */
export type HistoryChangeKey = Pick<FlowPullRequest, "repository" | "number">;

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
  readonly onOpen: (change: HistoryChangeKey, from: HTMLElement) => void;
}) {
  const personName = usePersonNames(useAccountOrgId() ?? undefined);
  const repository = flow === undefined ? undefined : groupRepository(flow.environments);
  const releases = useMemo(
    () =>
      flow?.releasesKnown === true
        ? historyReleases({
            releases: flow.releases,
            merged: flow.merged,
            failureOf: (release) =>
              releaseFailure(release, {
                environmentInputs: flow.environmentInputs,
                stalled: flow.release.stalled,
              }),
          })
        : undefined,
    [flow],
  );
  return (
    <ProjectHistoryView
      face={face}
      mateName={mateName}
      onOpen={onOpen}
      personName={personName}
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
  personName,
  onOpen,
}: {
  /** Newest first; `undefined` until HQ has told them. */
  readonly releases: ReadonlyArray<HistoryRelease> | undefined;
  /** The repository its commits are on, to open them in the Git browser; none until known. */
  readonly repo?: GitRepoAt | undefined;
  readonly face: (projectId: string) => ReactNode;
  readonly mateName: (projectId: string) => string | undefined;
  /** Who released a release, by their Zerops user id; none where unknown. */
  readonly personName?: ((userId: string) => string | undefined) | undefined;
  readonly onOpen: (change: HistoryChangeKey, from: HTMLElement) => void;
}) {
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  // Until HQ answers, its line's place is held: the column does not grow when it lands.
  if (releases === undefined) return <p aria-hidden="true" className="ov-sec-empty pp-hist-note" />;
  if (releases.length === 0)
    return <p className="ov-sec-empty pp-hist-note">Nothing released yet.</p>;
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
      <ul className="pp-hist" data-zerops-surface="project-history">
        {shown.rows.map((release) => (
          <ReleaseRow
            byName={release.by === undefined ? undefined : personName?.(release.by)}
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
        <div className="pp-hist-more">
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

/** Tones of a release's state: Live green, a failure red, a stall amber, Rolled back quiet. */
const STATE_TONE = {
  live: "success",
  "rolled-back": "neutral",
  "deploy-failed": "danger",
  refused: "danger",
  stalled: "warning",
} as const;

function ReleaseRow({
  release,
  repo,
  open,
  onToggle,
  face,
  mateName,
  byName,
  onOpen,
}: {
  readonly release: HistoryRelease;
  readonly repo: GitRepoAt | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly face: (projectId: string) => ReactNode;
  readonly mateName: (projectId: string) => string | undefined;
  readonly byName: string | undefined;
  readonly onOpen: (change: HistoryChangeKey, from: HTMLElement) => void;
}) {
  const recorded = release.recorded ?? [];
  const outside = release.outsideCommitCount ?? 0;
  // A roll back put nothing of its own live, and an unrecorded release names nothing: no chevron.
  const opens = recorded.length > 0 || outside > 0 || release.failure !== undefined;
  const gist = releaseGist(release);
  const head = (
    <>
      <span aria-hidden="true" className="pp-hist-chevron">
        {opens ? <ChevronRightIcon data-open={open ? "true" : undefined} /> : null}
      </span>
      <span className="pp-hist-name">
        <span className="pp-hist-tag">{release.tag}</span>
        {release.state === undefined ? null : (
          <Badge data-state={release.state} tone={STATE_TONE[release.state]}>
            {RELEASE_STATE_WORDS[release.state]}
          </Badge>
        )}
      </span>
      {open ? (
        <span className="pp-hist-facts">{releaseFacts(release, byName)}</span>
      ) : (
        <span className="pp-hist-gist">
          {release.failure ?? gist.text}
          {release.failure === undefined && gist.more > 0 ? (
            <span className="pp-hist-quiet"> · +{gist.more}</span>
          ) : null}
        </span>
      )}
      <ReleaseAge at={release.taggedAt} />
    </>
  );
  return (
    <li className="pp-hist-release" data-open={open ? "true" : undefined}>
      {opens ? (
        <button aria-expanded={open} className="pp-hist-head" onClick={onToggle} type="button">
          {head}
        </button>
      ) : (
        <div className="pp-hist-head">{head}</div>
      )}
      {open ? (
        <div className="pp-hist-body">
          {release.failure === undefined ? null : (
            <p className="pp-hist-failure">{release.failure}</p>
          )}
          {recorded.length === 0 ? null : (
            <ChangeList label={`What ${release.tag} put live`}>
              {recorded.map((change) => (
                <HistoryChangeRow
                  change={change}
                  face={face}
                  key={`${change.repository}#${String(change.number)}`}
                  mateName={mateName}
                  onOpen={onOpen}
                />
              ))}
            </ChangeList>
          )}
          {outside === 0 ? null : (
            <p className="pp-hist-outside">
              {repo === undefined ? (
                outsideLine(outside)
              ) : (
                <GitBrowserLink to={{ ...repo, view: "commits" }}>
                  {outsideLine(outside)}
                </GitBrowserLink>
              )}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** One change a release put live: its Mate's face, its title, and whose and when at its end. */
function HistoryChangeRow({
  change,
  face,
  mateName,
  onOpen,
}: {
  readonly change: HistoryChange;
  readonly face: (projectId: string) => ReactNode;
  readonly mateName: (projectId: string) => string | undefined;
  readonly onOpen: (change: HistoryChangeKey, from: HTMLElement) => void;
}) {
  const { pull } = change;
  const open = (from: HTMLElement) => {
    onOpen(change, from);
  };
  if (pull === undefined)
    return (
      <ChangeRow
        face={<GitMergeIcon aria-hidden="true" className="ov-change-icon" />}
        onOpen={open}
        title={change.title}
      />
    );
  return (
    <ChangeRow
      at={pull.mergedAt}
      by={mateName(pull.mateProjectId)}
      face={face(pull.mateProjectId)}
      onOpen={open}
      // Its pull request on GitHub is its review's door: one row per change, nothing beside it.
      pull={{ ...pull, title: change.title, pullRequest: undefined }}
    />
  );
}

/** When a release was made, as the place page's releases say it: "8d ago". */
function ReleaseAge({ at }: { readonly at: string }) {
  const nowMs = useNowMs();
  return <span className="pp-hist-time">{formatRelativeTimeLabel(at, nowMs)}</span>;
}
