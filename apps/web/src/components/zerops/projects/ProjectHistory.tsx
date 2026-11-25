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
import { Collapsible, CollapsibleTrigger } from "~/components/ui/collapsible";
import { EmptyState } from "~/components/ui/empty";
import { Loading } from "~/components/ui/loading";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useAccountOrgId } from "~/zerops/accountData";
import { useNowMs } from "~/zerops/useNowMs";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";

import { GitBrowserLink, type GitRepoAt } from "../gitBrowser/GitBrowserLink";
import { CHANGE_ICON, ChangeList, ChangeRow } from "../system/ChangeRow";
import { cn } from "~/lib/utils";
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
import { Text } from "~/components/ui/text";

/** A change as History opens it: by its repository and number. */
type HistoryChangeKey = Pick<FlowPullRequest, "repository" | "number">;

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
  if (releases === undefined)
    return <Loading className="flex h-5 items-center" label="Releases" quiet shape="line" />;
  if (releases.length === 0) return <EmptyState size="line">Nothing released yet.</EmptyState>;
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
      <ul className="m-0 grid list-none gap-0.5 p-0" data-zerops-surface="project-history">
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
        <div className="flex pt-0.5">
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

/** A line of an opened release: why it failed, what went live outside Mate. */
const HIST_LINE = "border-t border-border/60 py-2.25 text-line leading-5";

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
      <span
        aria-hidden="true"
        className="flex size-4.5 items-center justify-center text-muted-foreground"
      >
        {opens ? (
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-[rotate] duration-150 ease-out-strong motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        ) : null}
      </span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-body leading-5 font-medium text-foreground">
          {release.tag}
        </span>
        {release.state === undefined ? null : (
          <Badge data-state={release.state} tone={STATE_TONE[release.state]}>
            {RELEASE_STATE_WORDS[release.state]}
          </Badge>
        )}
      </span>
      {open ? (
        <Text className="min-w-0" truncate variant="remark">
          {releaseFacts(release, byName)}
        </Text>
      ) : (
        <span className="min-w-0 truncate text-body leading-5 text-foreground/85">
          {release.failure ?? gist.text}
          {release.failure === undefined && gist.more > 0 ? (
            <span className="text-muted-foreground"> · +{gist.more}</span>
          ) : null}
        </span>
      )}
      <ReleaseAge at={release.taggedAt} />
    </>
  );
  return (
    // A release opens, on a lifted ground, to the changes it put live; shut, it lights under the
    // pointer.
    <Collapsible
      onOpenChange={onToggle}
      open={open}
      render={
        <li
          className={cn(
            "grid min-w-0 rounded-control transition-colors duration-150 ease-out-strong",
            open ? "bg-item-hover pb-1.5" : "has-[>[data-hist-head]:hover]:bg-item-hover",
          )}
        />
      }
    >
      {opens ? (
        <CollapsibleTrigger
          className="grid w-full min-w-0 grid-cols-[18px_auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3 text-start outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          data-hist-head=""
        >
          {head}
        </CollapsibleTrigger>
      ) : (
        <div className="grid w-full min-w-0 grid-cols-[18px_auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3">
          {head}
        </div>
      )}
      {open ? (
        // Its changes, set in under its version, a hairline over each.
        <div className="grid min-w-0 ps-11 pe-3.5">
          {release.failure === undefined ? null : (
            <p className={cn(HIST_LINE, "text-status-failed-text")}>{release.failure}</p>
          )}
          {recorded.length === 0 ? null : (
            <ChangeList label={`What ${release.tag} put live`} look="release">
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
            <p className={cn(HIST_LINE, "text-muted-foreground")}>
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
    </Collapsible>
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
        face={<GitMergeIcon aria-hidden="true" className={CHANGE_ICON} />}
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
  return (
    <span className="text-line leading-5 whitespace-nowrap text-muted-foreground tabular-nums">
      {formatRelativeTimeLabel(at, nowMs)}
    </span>
  );
}
