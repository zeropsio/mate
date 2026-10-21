/**
 * What a commit changed, file after file in one scrolling diff drawn by the Diff panel's code
 * view: unified or split as the person last chose there, each file folded or open, and a file
 * the page left for later read on press. Lockfiles and minified files start folded.
 */
import type { CodeViewDiffItem, FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { GitBrowseView } from "@t3tools/client-runtime/data";
import { startsFolded } from "@t3tools/client-runtime/zerops/gitBrowse/commit";
import type { GitCommitFile, GitCommitFileHunks } from "@t3tools/shared/hqGitBrowse/commit";
import { ChevronDownIcon, ChevronRightIcon, Columns2Icon, Rows3Icon } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { useDiffPanelStore } from "~/diffPanelStore";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { fnv1a32, resolveDiffThemeName } from "~/lib/diffPresentation";
import { getRenderablePatch } from "~/lib/diffRendering";
import { StyledDiffCodeView } from "../../diffs/StyledDiffCodeView";
import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";

/** A file's hunks the page left for later, as their own read stands. */
export type GitLaterHunks = GitBrowseView<GitCommitFileHunks>;

/**
 * A file's counts are the commit's, beside its note: the viewer counts only the lines it was
 * given, which is none for a file left for later.
 */
const COUNTS_FROM_THE_COMMIT = `[data-diffs-header] :is([data-additions-count], [data-deletions-count]) {
  display: none !important;
}`;

const CHANGE_TYPE = { added: "new", deleted: "deleted", modified: "change" } as const;

/** A file with no lines to draw: its header only. */
const headerOnly = (sha: string, file: GitCommitFile): FileDiffMetadata => ({
  name: file.path,
  type: CHANGE_TYPE[file.status],
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: true,
  deletionLines: [],
  additionLines: [],
  cacheKey: `git-commit:${sha}:${file.path}:none`,
});

/** What a file's header says beside its counts: why it has no lines, or how to read them. */
export const fileNote = (
  file: GitCommitFile,
  later: GitLaterHunks | undefined,
):
  | { readonly kind: "none" }
  | { readonly kind: "words"; readonly words: string; readonly alert?: boolean }
  | { readonly kind: "load"; readonly label: string; readonly busy: boolean } => {
  if (file.binary) return { kind: "words", words: "Binary file" };
  if (file.hunks !== null) return { kind: "none" };
  if (!file.loadable) return { kind: "words", words: "Too long to read here." };
  if (later === undefined) return { kind: "load", label: "Show the diff", busy: false };
  if (later.state === "known")
    return later.answer.hunks === null
      ? { kind: "words", words: "Too long to read here." }
      : { kind: "none" };
  if (later.state === "failed" || later.state === "refused")
    return { kind: "load", label: "Read again", busy: false };
  return { kind: "load", label: "Reading the diff…", busy: true };
};

const STATUS_LETTER: Record<GitCommitFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Every file the diff changed with its counts, each a jump to its diff below. */
export function GitChangedFiles({
  files,
  totalFiles,
  filesTruncated,
  onJump,
}: {
  readonly files: ReadonlyArray<GitCommitFile>;
  readonly totalFiles: number;
  readonly filesTruncated: boolean;
  readonly onJump: (path: string) => void;
}) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <section aria-label="Changed files" className="flex min-w-0 flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        {filesTruncated
          ? `Showing ${count(files.length, "file", "files")} of ${totalFiles} changed`
          : `${count(totalFiles, "file", "files")} changed`}
        {additions > 0 ? (
          <span className="ml-2 font-mono text-diff-addition-foreground">+{additions}</span>
        ) : null}
        {deletions > 0 ? (
          <span className="ml-1 font-mono text-diff-deletion-foreground">−{deletions}</span>
        ) : null}
      </p>
      <ul className="flex min-w-0 flex-col">
        {files.map((file) => (
          <li key={file.path}>
            <button
              className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onJump(file.path)}
              type="button"
            >
              <span className="w-3 shrink-0 font-mono text-muted-foreground">
                {STATUS_LETTER[file.status]}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">{file.path}</span>
              {file.binary ? (
                <span className="text-muted-foreground">Binary file</span>
              ) : (
                <span className="shrink-0 font-mono">
                  <span className="text-diff-addition-foreground">+{file.additions}</span>{" "}
                  <span className="text-diff-deletion-foreground">−{file.deletions}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GitDiffFiles({
  sha,
  files,
  later,
  onLoad,
  onAgain,
  renderHeader,
  className,
}: {
  readonly sha: string;
  readonly files: ReadonlyArray<GitCommitFile>;
  /** Hunks read on press, by path. */
  readonly later: ReadonlyMap<string, GitLaterHunks>;
  readonly onLoad: (path: string) => void;
  readonly onAgain: () => void;
  /** What stands above the files and scrolls with them; `jump` brings a file to the top. */
  readonly renderHeader: (jump: (path: string) => void) => ReactNode;
  readonly className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings().wordWrap;
  const diffRenderMode = useDiffPanelStore((state) => state.diffRenderMode);
  const setDiffRenderMode = useDiffPanelStore((state) => state.setDiffRenderMode);
  const viewer = useRef<CodeViewHandle<undefined>>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(
    () => new Set(files.filter((file) => startsFolded(file.path)).map((file) => file.path)),
  );
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const items = useMemo<Array<CodeViewDiffItem<undefined>>>(
    () =>
      files.map((file) => {
        const read = later.get(file.path);
        const hunks = file.hunks ?? (read?.state === "known" ? (read.answer.hunks ?? null) : null);
        const patch = hunks === null ? null : getRenderablePatch(hunks, `git-commit:${sha}`);
        const parsed = patch?.kind === "files" ? patch.files[0] : undefined;
        const collapsed = folded.has(file.path);
        return {
          id: file.path,
          type: "diff",
          fileDiff: parsed ?? headerOnly(sha, file),
          collapsed,
          version: fnv1a32(`${collapsed ? "1" : "0"}:${read?.state ?? ""}:${parsed ? "1" : "0"}`),
        };
      }),
    [files, folded, later, sha],
  );
  const toggle = (path: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const jump = (path: string) => {
    if (folded.has(path)) toggle(path);
    viewer.current?.scrollTo({ type: "item", id: path, align: "start", behavior: "instant" });
  };

  return (
    <StyledDiffCodeView
      viewerRef={viewer}
      {...(className ? { className } : {})}
      unsafeCSSExtra={COUNTS_FROM_THE_COMMIT}
      items={items}
      options={{
        diffStyle: diffRenderMode === "split" ? "split" : "unified",
        lineDiffType: "none",
        overflow: wordWrap ? "wrap" : "scroll",
        theme: resolveDiffThemeName(resolvedTheme),
        themeType: resolvedTheme,
        stickyHeaders: true,
        // A minified line stays plain text: tokenizing it would stall the page.
        tokenizeMaxLineLength: 1000,
      }}
      renderCodeViewHeader={() => (
        <>
          {renderHeader(jump)}
          <div className="flex justify-end pb-2">
            <ToggleGroup
              aria-label="Diff layout"
              onValueChange={(value) => {
                const next = value[0];
                if (next === "stacked" || next === "split") setDiffRenderMode(next);
              }}
              value={[diffRenderMode]}
              variant="segmented"
            >
              <Toggle aria-label="Unified diff view" value="stacked">
                <Rows3Icon className="size-3.5" />
              </Toggle>
              <Toggle aria-label="Split diff view" value="split">
                <Columns2Icon className="size-3.5" />
              </Toggle>
            </ToggleGroup>
          </div>
        </>
      )}
      renderHeaderPrefix={(item) => {
        const isFolded = item.collapsed === true;
        // Header controls keep within the viewer's 32 px header metric (`-my-1`): a taller
        // header pushes the list's end past its reachable scroll range, per folded file.
        return (
          <Button
            aria-label={`${isFolded ? "Unfold" : "Fold"} ${item.id}`}
            className="-my-1"
            onClick={() => toggle(item.id)}
            size="icon-sm"
            variant="ghost"
          >
            {isFolded ? <ChevronRightIcon /> : <ChevronDownIcon />}
          </Button>
        );
      }}
      renderHeaderMetadata={(item) => {
        const file = byPath.get(item.id);
        if (file === undefined) return null;
        const note = fileNote(file, later.get(file.path));
        return (
          <span className="flex items-center gap-2 font-mono text-xs">
            {note.kind === "words" ? (
              <span className="font-sans text-muted-foreground">{note.words}</span>
            ) : null}
            {note.kind === "load" ? (
              <Button
                className="-my-1"
                disabled={note.busy}
                onClick={() => (later.get(file.path) === undefined ? onLoad(file.path) : onAgain())}
                size="sm"
                variant="secondary"
              >
                {note.label}
              </Button>
            ) : null}
            {file.additions > 0 ? (
              <span className="text-diff-addition-foreground">+{file.additions}</span>
            ) : null}
            {file.deletions > 0 ? (
              <span className="text-diff-deletion-foreground">−{file.deletions}</span>
            ) : null}
          </span>
        );
      }}
    />
  );
}
