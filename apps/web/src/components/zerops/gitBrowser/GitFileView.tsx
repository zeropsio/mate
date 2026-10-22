/**
 * A file of a commit: its text with line numbers, a line or range a link names marked and
 * scrolled to, rendered markdown with its source a toggle away, an image drawn from its bytes, and
 * what the browser cannot show said with its size. Every link it makes names the commit, never a
 * branch that may move.
 */
import type { SelectedLineRange } from "@pierre/diffs";
import { File, Virtualizer } from "@pierre/diffs/react";
import { noBlame } from "@t3tools/client-runtime/zerops/gitBrowse/blame";
import {
  fileShape,
  fileSize,
  isMarkdownPath,
  lineCount,
  readableRaw,
} from "@t3tools/client-runtime/zerops/gitBrowse/blob";
import { linesParam, parseLines } from "@t3tools/client-runtime/zerops/gitBrowse/lineRange";
import type { GitBlob } from "@t3tools/shared/hqGitBrowse/blob";
import { useEffect, useRef, useState } from "react";
import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import {
  FILE_LINK_REVEAL_UNSAFE_CSS,
  useFileLineReveal,
} from "~/components/files/useFileLineReveal";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Toggle } from "~/components/ui/toggle";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { isEditableFocused } from "~/lib/editableFocus";
import { resolveDiffThemeName } from "~/lib/diffPresentation";
import { useGitRaw } from "~/zerops/useGitRaw";
import type { GitBrowseSearch, GitView } from "./GitBrowseView";
import { RepoMarkdown, type RepoPathTarget } from "./RepoMarkdown";

export interface GitFileViewProps {
  readonly appId: string;
  readonly repo: string;
  /** The commit the page reads at. */
  readonly sha: string;
  readonly blob: GitBlob;
  /** The page's link: its branch, tag or commit, and the line or range it names. */
  readonly search: GitBrowseSearch;
  readonly navigate: (search: GitBrowseSearch) => void;
  readonly hrefOf: (search: GitBrowseSearch) => string;
  readonly hasView: (view: GitView) => boolean;
}

const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

const copied = (title: string) => toastManager.add({ type: "success", title });
const notCopied = (error: unknown) =>
  toastManager.add({
    type: "error",
    title: "Could not copy",
    description: error instanceof Error ? error.message : undefined,
  });

/** Bytes as a file the browser saves under the file's own name. */
function save(url: string, path: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.slice(path.lastIndexOf("/") + 1);
  anchor.click();
}

function FileText({
  path,
  content,
  wrap,
  search,
  onLines,
}: {
  readonly path: string;
  readonly content: string;
  readonly wrap: boolean;
  readonly search: GitBrowseSearch;
  readonly onLines: (range: SelectedLineRange | null) => void;
}) {
  const { resolvedTheme } = useTheme();
  const selected = parseLines(search.lines);
  // The line a link names is revealed once, when the file opens; selecting lines later marks
  // them without scrolling the page away from where the person is reading.
  const [reveal] = useState(() => selected?.start ?? null);
  const onPostRender = useFileLineReveal(path, reveal, 0);
  return (
    <DiffWorkerPoolProvider>
      <Virtualizer
        className="file-preview-virtualizer max-h-[75vh] min-h-0 overflow-auto"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        <File
          file={{ name: path, contents: content }}
          options={{
            disableFileHeader: true,
            overflow: wrap ? "wrap" : "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            themeType: resolvedTheme,
            unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
            enableLineSelection: true,
            onLineSelectionEnd: onLines,
            onPostRender,
          }}
          selectedLines={selected}
        />
      </Virtualizer>
    </DiffWorkerPoolProvider>
  );
}

export function GitFileView({
  appId,
  repo,
  sha,
  blob,
  search,
  navigate,
  hrefOf,
  hasView,
}: GitFileViewProps) {
  const shape = fileShape(blob);
  const markdown = shape.kind === "text" && isMarkdownPath(blob.path);
  const [source, setSource] = useState(false);
  const [wrap, setWrap] = useState(false);
  // The bytes are read only when the page draws them or the person asks for them.
  const [wantRaw, setWantRaw] = useState(shape.kind === "image");
  const raw = useGitRaw({ appId, repo, sha, path: blob.path }, wantRaw);
  // What to do with the bytes once they arrive: open them in a tab, or save them.
  const pending = useRef<
    { readonly kind: "open"; readonly tab: Window | null } | { readonly kind: "save" } | null
  >(null);
  useEffect(() => {
    const next = pending.current;
    if (raw.url === null || next === null) return;
    pending.current = null;
    if (next.kind === "save") save(raw.url, blob.path);
    else if (next.tab !== null) next.tab.location.href = raw.url;
  }, [raw.url, blob.path]);
  const askRaw = (next: NonNullable<typeof pending.current>) => {
    if (raw.url !== null) {
      if (next.kind === "save") save(raw.url, blob.path);
      else if (next.tab !== null) next.tab.location.href = raw.url;
      return;
    }
    pending.current = next;
    setWantRaw(true);
  };
  // A tab opened by the click itself, before the bytes arrive, is one no popup blocker stops.
  const openRaw = () => {
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    askRaw({ kind: "open", tab });
  };
  const download = () => askRaw({ kind: "save" });

  const at = (patch: GitBrowseSearch): GitBrowseSearch => ({
    rev: sha,
    view: "code",
    path: blob.path,
    kind: "file",
    ...patch,
  });
  const link = () =>
    new URL(
      hrefOf(at(search.lines === undefined ? {} : { lines: search.lines })),
      window.location.href,
    ).href;
  const copyLink = () =>
    void writeTextToClipboard(link(), "link").then(() => copied("Link copied"), notCopied);
  const blame = () =>
    navigate({
      rev: sha,
      view: "blame",
      path: blob.path,
      ...(search.lines === undefined ? {} : { lines: search.lines }),
    });
  const copyLinkRef = useRef(copyLink);
  const blameRef = useRef(blame);
  useEffect(() => {
    copyLinkRef.current = copyLink;
    blameRef.current = blame;
  });
  // `y` copies the link; `b` opens the file's blame, which says why where it has none.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "y" && event.key !== "b") return;
      if (event.defaultPrevented || isEditableFocused(event.target)) return;
      event.preventDefault();
      if (event.key === "y") copyLinkRef.current();
      else blameRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onLines = (range: SelectedLineRange | null) => {
    const { lines: _lines, ...rest } = at({});
    navigate(range === null ? rest : { ...rest, lines: linesParam(range) });
  };
  const openPath = (target: RepoPathTarget) => navigate({ rev: sha, view: "code", ...target });

  const fits = readableRaw(blob);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-auto text-xs text-muted-foreground">
          {shape.kind === "text"
            ? `${lines(lineCount(shape.content))} · ${fileSize(blob.size)}`
            : fileSize(blob.size)}
        </span>
        {markdown ? (
          <Toggle
            className="shrink-0"
            variant="ghost"
            size="sm"
            pressed={source}
            onPressedChange={setSource}
          >
            Source
          </Toggle>
        ) : null}
        {shape.kind === "text" && (!markdown || source) ? (
          <Toggle
            className="shrink-0"
            variant="ghost"
            size="sm"
            pressed={wrap}
            onPressedChange={setWrap}
          >
            Wrap
          </Toggle>
        ) : null}
        <Button variant="ghost" size="sm" onClick={copyLink}>
          Copy link
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void writeTextToClipboard(blob.path, "path").then(
              () => copied("Path copied"),
              notCopied,
            )
          }
        >
          Copy path
        </Button>
        {fits ? (
          <>
            <Button variant="ghost" size="sm" onClick={openRaw}>
              Raw
            </Button>
            <Button variant="ghost" size="sm" onClick={download}>
              Download
            </Button>
          </>
        ) : null}
        {hasView("commits") ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({
                ...(search.rev === undefined ? {} : { rev: search.rev }),
                view: "commits",
                path: blob.path,
              })
            }
          >
            History
          </Button>
        ) : null}
        {hasView("blame") && noBlame(blob) === null ? (
          <Button variant="ghost" size="sm" onClick={blame}>
            Blame
          </Button>
        ) : null}
      </div>
      {raw.view.state === "failed" || raw.view.state === "refused" ? (
        <p className="text-sm text-status-failed" role="alert">
          {raw.view.words}
        </p>
      ) : null}
      {shape.kind === "image" ? (
        raw.url !== null && raw.type?.startsWith("image/") ? (
          <img className="max-w-full self-start" src={raw.url} alt={blob.path} />
        ) : null
      ) : shape.kind === "beyond" ? (
        <p className="text-sm text-muted-foreground">
          {fileSize(blob.size)} is more than the browser reads. Clone the repository to read it.
        </p>
      ) : shape.kind === "binary" ? (
        <p className="text-sm text-muted-foreground">Binary file, {fileSize(blob.size)}.</p>
      ) : (
        <>
          {shape.cut ? (
            <p className="text-sm text-muted-foreground">
              Showing the first 256 KiB of {fileSize(blob.size)}.{" "}
              {fits ? "Download it to read the rest." : "Clone the repository to read the rest."}
            </p>
          ) : null}
          {markdown && !source ? (
            <RepoMarkdown
              appId={appId}
              repo={repo}
              sha={sha}
              path={blob.path}
              content={shape.content}
              hrefOf={(target) => hrefOf({ rev: sha, view: "code", ...target })}
              onOpen={openPath}
            />
          ) : (
            <FileText
              path={blob.path}
              content={shape.content}
              wrap={wrap}
              search={search}
              onLines={onLines}
            />
          )}
        </>
      )}
    </div>
  );
}
