/**
 * Two branches, tags or commits compared, three dots: what the second adds since it left the
 * first — its commits, newest first, and every file changed from where the two split, file after
 * file in one scrolling diff. Both are picked here and swap places on "Swap".
 */
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import { compareSummary } from "@t3tools/client-runtime/zerops/gitBrowse/compare";
import type { GitCompare } from "@t3tools/shared/hqGitBrowse/compare";
import { ArrowLeftIcon, ArrowLeftRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { useGitBrowse, useGitBrowseReads } from "~/zerops/useGitBrowse";
import { GitReadStopped } from "./GitAtCommit";
import type { GitRepoAt } from "./GitBrowserLink";
import type { GitRepoPageProps } from "./GitBrowseView";
import { CommitRow } from "./GitCommitsView";
import { GitChangedFiles, GitDiffFiles, type GitLaterHunks } from "./GitDiffFiles";
import type { PickerChange } from "./GitRefPicker.logic";
import { GitRefPicker } from "./GitRefPicker";

type CompareProps = Pick<
  GitRepoPageProps,
  "appId" | "repo" | "hrefOf" | "navigate" | "onOpenChange"
> & { readonly changes: ReadonlyArray<PickerChange> };

/** What the compare says, the commits head adds, and the files it changed, each a jump below. */
export function GitCompareSummary({
  compare,
  onJump,
  ...row
}: CompareProps & { readonly compare: GitCompare; readonly onJump: (path: string) => void }) {
  const summary = compareSummary(compare);
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-4">
      <header className="flex min-w-0 flex-col gap-1">
        <h2 className="text-base font-medium break-words text-foreground">{summary.headline}</h2>
        {summary.cut === null ? null : (
          <p className="text-xs text-muted-foreground">{summary.cut}</p>
        )}
      </header>
      {summary.nothing ? null : (
        <>
          <Card variant="flat" aria-label="Commits">
            {compare.commits.map((item) => (
              <CommitRow key={item.sha} {...row} item={item} />
            ))}
          </Card>
          <GitChangedFiles
            files={compare.files}
            filesTruncated={compare.filesTruncated}
            onJump={onJump}
            totalFiles={compare.totalFiles}
          />
        </>
      )}
    </div>
  );
}

/** The diff from where the two split to head; a file the page left for later is read on press. */
function CompareFiles({
  compare,
  mergeBase,
  ...props
}: CompareProps & { readonly compare: GitCompare; readonly mergeBase: string }) {
  const { appId, repo } = props;
  const head = compare.head.sha;
  const [asked, setAsked] = useState<ReadonlyArray<string>>([]);
  const laterReads = useGitBrowseReads(
    asked.map((path) => ({
      appId,
      repo,
      read: "compare-file" as const,
      params: { base: mergeBase, head, path },
    })),
    true,
  );
  const later = new Map<string, GitLaterHunks>(
    asked.flatMap((path, i) => {
      const read = laterReads.views[i];
      return read === undefined ? [] : [[path, read] as const];
    }),
  );
  return (
    <GitDiffFiles
      className="h-[calc(100dvh-20rem)] min-h-96 overflow-auto"
      files={compare.files}
      later={later}
      onAgain={laterReads.again}
      onLoad={(path) => setAsked((current) => [...current, path])}
      renderHeader={(jump) => <GitCompareSummary {...props} compare={compare} onJump={jump} />}
      sha={`${mergeBase}..${head}`}
    />
  );
}

function CompareState({
  at,
  view,
  onAgain,
}: {
  readonly at: GitRepoAt;
  readonly view: GitBrowseState<GitCompare>;
  readonly onAgain: () => void;
}) {
  if (view.state === "known") return null;
  if (view.state === "unread")
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Reading the compare…
      </p>
    );
  return <GitReadStopped view={view} at={at} onAgain={onAgain} />;
}

/** What a picker's button says: the side's name as the compare read it, or as it was asked. */
const sideLabel = (side: GitCompare["base"] | undefined, asked: string) =>
  side === undefined
    ? asked
    : side.ref.kind === "commit"
      ? `Commit ${side.sha.slice(0, 7)}`
      : side.ref.name;

export function GitCompareView(props: GitRepoPageProps) {
  const { appId, repo, search, home, repository, navigate } = props;
  const base = search.base ?? "main";
  const head = search.head ?? search.rev ?? "main";
  const { view, again } = useGitBrowse(
    { appId, repo, read: "compare", params: { base, head } },
    true,
  );
  const changes = useMemo(
    () => (repository?.changes ?? []).map(({ pull }) => pull),
    [repository?.changes],
  );
  const known = view.state === "known" ? view.answer : undefined;
  const mounted = home.state === "known" && home.answer.about.remote !== null;
  const open = (next: { readonly base: string; readonly head: string }) =>
    navigate({
      ...(search.rev === undefined ? {} : { rev: search.rev }),
      view: "compare",
      ...next,
    });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitRefPicker
          appId={appId}
          repo={repo}
          title="Base branch or tag"
          shortcut={false}
          label={sideLabel(known?.base, base)}
          kind={known?.base.ref.kind ?? null}
          changes={changes}
          mounted={mounted}
          onPick={(rev) => open({ base: rev, head })}
        />
        <ArrowLeftIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <GitRefPicker
          appId={appId}
          repo={repo}
          title="Branch or tag to compare"
          shortcut={false}
          label={sideLabel(known?.head, head)}
          kind={known?.head.ref.kind ?? null}
          changes={changes}
          mounted={mounted}
          onPick={(rev) => open({ base, head: rev })}
        />
        <Button variant="ghost" size="sm" onClick={() => open({ base: head, head: base })}>
          <ArrowLeftRightIcon aria-hidden="true" />
          Swap
        </Button>
      </div>
      {known === undefined ? (
        <CompareState at={{ appId, repo }} view={view} onAgain={again} />
      ) : known.mergeBase === null || compareSummary(known).nothing ? (
        <GitCompareSummary {...props} changes={changes} compare={known} onJump={() => {}} />
      ) : (
        <CompareFiles
          {...props}
          changes={changes}
          compare={known}
          key={`${known.mergeBase}..${known.head.sha}`}
          mergeBase={known.mergeBase}
        />
      )}
    </div>
  );
}
