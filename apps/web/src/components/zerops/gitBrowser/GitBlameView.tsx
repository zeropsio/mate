/**
 * A file of a commit with, beside each run of its lines, the commit that last changed them: its
 * subject linking the commit, author, time and a shade of how long ago it was made, and a way to
 * blame the file as that commit's parent had it. `b` goes back to the file. A file blame cannot
 * read says why.
 */
import type { SelectedLineRange } from "@pierre/diffs";
import { VirtualizedFile } from "@pierre/diffs";
import { File, Virtualizer } from "@pierre/diffs/react";
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import { BLAME_AGES, blameAges, noBlame } from "@t3tools/client-runtime/zerops/gitBrowse/blame";
import { fileSize, lineCount } from "@t3tools/client-runtime/zerops/gitBrowse/blob";
import { linesParam, parseLines } from "@t3tools/client-runtime/zerops/gitBrowse/lineRange";
import type { GitBlame, GitBlameCommit, GitBlameRange } from "@t3tools/shared/hqGitBrowse/blame";
import type { GitBlob } from "@t3tools/shared/hqGitBrowse/blob";
import { HistoryIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import {
  FILE_LINK_REVEAL_UNSAFE_CSS,
  useFileLineReveal,
  type FilePostRender,
} from "~/components/files/useFileLineReveal";
import { Button, InlineButton } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useTheme } from "~/hooks/useTheme";
import { isEditableFocused } from "~/lib/editableFocus";
import { resolveDiffThemeName } from "~/lib/diffPresentation";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import { GitAtCommit, GitReadTrouble, GitReading, troubleWords } from "./GitAtCommit";
import type { GitBrowseSearch, GitRepoPageProps } from "./GitBrowseView";
import { GitPageLink } from "./GitFileFinder";
import { GitPathCrumbs } from "./GitPathCrumbs";
import { GitTreeSidebar } from "./GitTreeSidebar";
import { GitWhen } from "./GitWhen";
import type { RepoPathTarget } from "./RepoMarkdown";

/** Newest commit's shade first: the file's newest lines stand out, its oldest fade. */
const AGE_SHADES: Readonly<Record<number, string>> = {
  0: "bg-primary",
  1: "bg-primary/70",
  2: "bg-primary/45",
  3: "bg-primary/25",
  4: "bg-primary/10",
};

/** Lines drawn past the view on either side, as the file draws them (its observer margin). */
const OVERSCAN_PX = 1200;
/** The drawn lines move in steps this large: scrolling within one draws nothing anew. */
const WINDOW_STEP_LINES = 50;

/** Where the file draws its lines: the first one's top, and each line's height. */
interface LineMetrics {
  readonly top: number;
  readonly height: number;
}

/** Why a file has no blame, in the person's words. */
export const noBlameWords = (blob: GitBlob) => {
  const why = noBlame(blob);
  if (why === "too-large")
    return `Blame reads files up to 256 KiB. This file is ${fileSize(blob.size)}. Clone the repository to blame it.`;
  if (why === "not-text") return "Only text files have blame.";
  return null;
};

/** One run of lines' commit: its shade, time, subject, change and the blame before it. */
export function BlameRangeRow({
  range,
  commit,
  age,
  metrics,
  hrefOf,
  navigate,
  onOpenChange,
}: Pick<GitRepoPageProps, "hrefOf" | "navigate" | "onOpenChange"> & {
  readonly range: GitBlameRange;
  readonly commit: GitBlameCommit | undefined;
  readonly age: number;
  readonly metrics: LineMetrics;
}) {
  const previous = commit?.previous;
  return (
    <div
      className="absolute inset-x-0 flex min-w-0 items-start gap-2 border-t border-border pe-2 text-xs leading-5"
      style={{
        top: metrics.top + (range.start - 1) * metrics.height,
        height: range.count * metrics.height,
      }}
      data-blame-start={range.start}
    >
      <span className={`h-full w-1 shrink-0 ${AGE_SHADES[age] ?? AGE_SHADES[BLAME_AGES - 1]}`} />
      {commit === undefined ? null : (
        <>
          <span className="w-16 shrink-0 truncate text-muted-foreground">
            <GitWhen at={commit.authoredAt}>{formatRelativeTimeLabel(commit.authoredAt)}</GitWhen>
          </span>
          <GitPageLink
            to={{ rev: commit.sha, view: "commit" }}
            hrefOf={hrefOf}
            navigate={navigate}
            className="min-w-0 flex-1 truncate text-foreground hover:underline"
          >
            {commit.subject}
          </GitPageLink>
          {commit.change === undefined ? null : (
            <InlineButton
              tone="muted"
              disabled={onOpenChange === undefined}
              onClick={() => onOpenChange?.(commit.change!.number)}
            >
              #{commit.change.number}
            </InlineButton>
          )}
          <span className="max-w-24 shrink-0 truncate text-muted-foreground">
            {commit.authorName}
          </span>
          {previous === undefined ? (
            <span className="size-4 shrink-0" />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <GitPageLink
                    to={{ rev: previous.sha, view: "blame", path: previous.path }}
                    hrefOf={hrefOf}
                    navigate={navigate}
                    className="flex h-5 shrink-0 items-center text-muted-foreground hover:text-foreground"
                  >
                    <HistoryIcon className="size-3.5" aria-label="Blame before this commit" />
                  </GitPageLink>
                }
              />
              <TooltipPopup>Blame before this commit</TooltipPopup>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
}

/** The runs of lines whose rows stand within `lines`, by binary search on their order. */
export const rangesWithin = (
  ranges: ReadonlyArray<GitBlameRange>,
  lines: { readonly first: number; readonly last: number },
) => {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const range = ranges[mid]!;
    if (range.start + range.count - 1 < lines.first) low = mid + 1;
    else high = mid;
  }
  const within: GitBlameRange[] = [];
  for (let i = low; i < ranges.length && ranges[i]!.start <= lines.last; i++)
    within.push(ranges[i]!);
  return within;
};

/** The lines the file's scroll shows, with its overscan, in steps: a scroll within one is quiet. */
function useShownLines(gutter: HTMLElement | null, metrics: LineMetrics | null) {
  const [shown, setShown] = useState({ first: 1, last: WINDOW_STEP_LINES * 2 });
  useEffect(() => {
    const scroller = gutter?.closest<HTMLElement>(".file-preview-virtualizer");
    if (scroller == null || metrics === null) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const top = scroller.scrollTop - metrics.top - OVERSCAN_PX;
      const bottom = scroller.scrollTop + scroller.clientHeight + OVERSCAN_PX;
      const first =
        Math.floor(Math.max(0, top) / metrics.height / WINDOW_STEP_LINES) * WINDOW_STEP_LINES + 1;
      const last = Math.ceil(bottom / metrics.height / WINDOW_STEP_LINES) * WINDOW_STEP_LINES;
      setShown((prior) => (prior.first === first && prior.last === last ? prior : { first, last }));
    };
    const onScroll = () => {
      frame ??= requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const resized = new ResizeObserver(onScroll);
    resized.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      resized.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [gutter, metrics]);
  return shown;
}

/** The file's text in the file view's own renderer, its blame gutter beside it, line for line. */
function BlameFile({
  blob,
  content,
  blame,
  search,
  onLines,
  hrefOf,
  navigate,
  onOpenChange,
}: Pick<GitRepoPageProps, "hrefOf" | "navigate" | "onOpenChange"> & {
  readonly blob: GitBlob;
  readonly content: string;
  readonly blame: GitBlame;
  readonly search: GitBrowseSearch;
  readonly onLines: (range: SelectedLineRange | null) => void;
}) {
  const { resolvedTheme } = useTheme();
  const selected = parseLines(search.lines);
  const [reveal] = useState(() => selected?.start ?? null);
  const revealLine = useFileLineReveal(blob.path, reveal, 0);
  const [metrics, setMetrics] = useState<LineMetrics | null>(null);
  // The gutter stands where the file draws each line, measured once the file has drawn.
  const onPostRender = useCallback<FilePostRender>(
    (container, instance, phase) => {
      revealLine(container, instance, phase);
      if (phase === "unmount" || !(instance instanceof VirtualizedFile)) return;
      const first = instance.getLinePosition(1);
      if (first === undefined) return;
      setMetrics((prior) =>
        prior !== null && prior.top === first.top && prior.height === first.height
          ? prior
          : { top: first.top, height: first.height },
      );
    },
    [revealLine],
  );
  const [gutter, setGutter] = useState<HTMLDivElement | null>(null);
  const shown = useShownLines(gutter, metrics);
  const commits = useMemo(
    () => new Map(blame.commits.map((commit) => [commit.sha, commit])),
    [blame.commits],
  );
  const ages = useMemo(() => blameAges(blame.commits), [blame.commits]);
  return (
    <DiffWorkerPoolProvider>
      <Virtualizer
        className="file-preview-virtualizer max-h-[75vh] min-h-0 overflow-auto"
        contentClassName="flex min-w-0"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        <div ref={setGutter} className="relative w-80 shrink-0 border-e border-border">
          {metrics === null
            ? null
            : rangesWithin(blame.ranges, shown).map((range) => (
                <BlameRangeRow
                  key={range.start}
                  range={range}
                  commit={commits.get(range.commit)}
                  age={ages.get(range.commit) ?? BLAME_AGES - 1}
                  metrics={metrics}
                  hrefOf={hrefOf}
                  navigate={navigate}
                  onOpenChange={onOpenChange}
                />
              ))}
        </div>
        <div className="min-w-0 flex-1">
          <File
            file={{ name: blob.path, contents: content }}
            options={{
              disableFileHeader: true,
              overflow: "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              enableLineSelection: true,
              onLineSelectionEnd: onLines,
              onPostRender,
            }}
            selectedLines={selected}
          />
        </div>
      </Virtualizer>
    </DiffWorkerPoolProvider>
  );
}

/** A read not answered: still reading, waiting for HQ, or why it stopped. */
function NotRead({
  view,
  words,
  onAgain,
}: {
  readonly view: Exclude<GitBrowseState, { readonly state: "known" }>;
  readonly words: string;
  readonly onAgain: () => void;
}) {
  if (view.state === "withheld") return null;
  if (view.state === "unread") return <GitReading busy={view.busy} words={words} />;
  return <GitReadTrouble words={troubleWords(view)} onAgain={onAgain} />;
}

function BlameAt({
  appId,
  repo,
  sha,
  path,
  search,
  navigate,
  hrefOf,
  hasView,
  onOpenChange,
}: Pick<
  GitRepoPageProps,
  "appId" | "repo" | "search" | "navigate" | "hrefOf" | "hasView" | "onOpenChange"
> & {
  readonly sha: string;
  readonly path: string;
}) {
  const file = useGitBrowse({ appId, repo, read: "blob", params: { sha, path } }, true);
  const blob = file.view.state === "known" ? file.view.answer : null;
  const why = blob === null ? null : noBlameWords(blob);
  // Blame is asked only of a file it can read.
  const blame = useGitBrowse(
    { appId, repo, read: "blame", params: { sha, path } },
    blob !== null && why === null,
  );
  const code: GitBrowseSearch = {
    rev: sha,
    view: "code",
    path,
    kind: "file",
    ...(search.lines === undefined ? {} : { lines: search.lines }),
  };
  const toCode = useRef(() => navigate(code));
  useEffect(() => {
    toCode.current = () => navigate(code);
  });
  // `b` goes back to the file, as it came here from it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "b" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isEditableFocused(event.target)) return;
      event.preventDefault();
      toCode.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (file.view.state !== "known")
    return <NotRead view={file.view} words="Reading source…" onAgain={file.again} />;
  const { answer } = file.view;
  const onLines = (range: SelectedLineRange | null) =>
    navigate({
      rev: sha,
      view: "blame",
      path,
      ...(range === null ? {} : { lines: linesParam(range) }),
    });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-auto text-xs text-muted-foreground">
          {answer.content === null
            ? fileSize(answer.size)
            : `${lineCount(answer.content)} lines · ${fileSize(answer.size)}`}
        </span>
        <Button variant="ghost" size="sm" onClick={() => navigate(code)}>
          Code
        </Button>
        {hasView("commits") ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({
                ...(search.rev === undefined ? {} : { rev: search.rev }),
                view: "commits",
                path,
              })
            }
          >
            History
          </Button>
        ) : null}
      </div>
      {why !== null ? (
        <p className="text-sm text-muted-foreground">{why}</p>
      ) : blame.view.state !== "known" ? (
        <NotRead view={blame.view} words="Reading blame…" onAgain={blame.again} />
      ) : (
        <BlameFile
          key={`${sha}:${path}`}
          blob={answer}
          content={answer.content ?? ""}
          blame={blame.view.answer}
          search={search}
          onLines={onLines}
          hrefOf={hrefOf}
          navigate={navigate}
          onOpenChange={onOpenChange}
        />
      )}
    </div>
  );
}

export function GitBlameView(props: GitRepoPageProps) {
  const { appId, repo, search, home, onHomeAgain, navigate, hrefOf, hasView, onOpenChange } = props;
  const path = search.path ?? "";
  return (
    <GitAtCommit home={home} onHomeAgain={onHomeAgain}>
      {(_home, sha) => {
        // A link out of what was read names the commit it was read at, never the branch.
        const at = (target: RepoPathTarget): GitBrowseSearch => ({
          rev: sha,
          view: "code",
          ...target,
        });
        return (
          <div className="flex min-w-0 gap-4">
            <GitTreeSidebar
              key={sha}
              appId={appId}
              repo={repo}
              sha={sha}
              path={path}
              kind="file"
              onOpen={(target) => navigate(at(target))}
            />
            <div className="min-w-0 flex-1">
              <Card variant="flat">
                <div className="flex min-w-0 flex-col gap-3 p-4">
                  <GitPathCrumbs
                    repo={repo}
                    at={{ path, kind: "file" }}
                    hrefOf={(target) => hrefOf(at(target))}
                    onOpen={(target) => navigate(at(target))}
                  />
                  {path === "" ? (
                    <p className="text-sm text-muted-foreground">Open a file to see its blame.</p>
                  ) : (
                    <BlameAt
                      key={`${sha}:${path}`}
                      appId={appId}
                      repo={repo}
                      sha={sha}
                      path={path}
                      search={search}
                      navigate={navigate}
                      hrefOf={hrefOf}
                      hasView={hasView}
                      onOpenChange={onOpenChange}
                    />
                  )}
                </div>
              </Card>
            </div>
          </div>
        );
      }}
    </GitAtCommit>
  );
}
