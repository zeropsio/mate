import { resolveDiffThemeName } from "~/lib/diffPresentation";
import { AssetImage } from "~/assets/AssetImage";
import type {
  EditorId,
  EnvironmentId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import type { SelectedLineRange } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { ChevronRight, Code2, Eye, FolderTree, LoaderCircle } from "lucide-react";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import ChatMarkdown from "~/components/ChatMarkdown";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import { useRemoteOpenState } from "~/remoteOpen";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { resolvePathLinkTarget } from "~/terminal-links";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment } from "~/reviewCommentContext";
import { usePrimaryEnvironmentId } from "~/state/environments";

import FileBrowserPanel from "./FileBrowserPanel";
import WrittenFilePanel from "./WrittenFilePanel";
import {
  type FileCommentAnnotationEntry,
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "./fileCommentAnnotations";
import { installFileEditorDismissal } from "./fileEditorDismissal";
import {
  FILE_LINK_REVEAL_UNSAFE_CSS,
  useFileLineReveal,
  type FilePostRender,
} from "./useFileLineReveal";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { projectFileCacheKey, projectFileEditorCacheKey } from "./fileContentRevision";
import { fileBreadcrumbs } from "./filePath";
import {
  filePreviewReadFailure,
  type FilePreviewReadFailure,
  isMarkdownPreviewFile,
  setMarkdownTaskChecked,
} from "./filePreviewMode";
import { useFileSaveCoordinator } from "./useFileSaveCoordinator";
import {
  getProjectFileDraft,
  setProjectFileDraft,
  useProjectFileQuery,
} from "./projectFilesQueryState";

interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  relativePath: string | null;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  revealLine: number | null;
  revealRequestId: number;
  onOpenFile: (relativePath: string) => void;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

const FILE_EXPLORER_STORAGE_KEY = "t3code.fileExplorerOpen";
const RENDER_MARKDOWN_STORAGE_KEY = "t3code.renderMarkdown";

function WorkspaceImagePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly alt: string;
}) {
  const assetUrl = useAssetUrlState(props.environmentId, {
    _tag: "workspace-file",
    threadId: props.threadRef.threadId,
    path: props.absolutePath,
  });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (assetUrl._tag === "Failure" || (assetUrl._tag === "Success" && failedUrl === assetUrl.url)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
        Unable to load workspace image.
      </div>
    );
  }

  return assetUrl._tag === "Success" ? (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <AssetImage
        loading="lazy"
        decoding="async"
        className="max-h-full max-w-full object-contain"
        style={{
          width: "100%",
          aspectRatio: assetUrl.imageDimensions
            ? `${assetUrl.imageDimensions.width} / ${assetUrl.imageDimensions.height}`
            : "16 / 9",
        }}
        src={assetUrl.url}
        alt={props.alt}
        onError={() => setFailedUrl(assetUrl.url)}
      />
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  );
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  contents: string;
  resolvedTheme: "light" | "dark";
  revealRequestId: number;
  wordWrap: boolean;
  onPostRender: FilePostRender;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

interface FileSelectionOverride {
  revealRequestId: number;
  range: SelectedLineRange | null;
}

function EditableFileSurface({
  environmentId,
  cwd,
  relativePath,
  composerDraftTarget,
  contents,
  resolvedTheme,
  revealRequestId,
  wordWrap,
  onPostRender,
  onPendingChange,
}: EditableFileSurfaceProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const [lineAnnotations, setLineAnnotations] = useState<FileCommentLineAnnotation[]>([]);
  const [selectionOverride, setSelectionOverride] = useState<FileSelectionOverride | null>(null);
  const selectedRange =
    selectionOverride?.revealRequestId === revealRequestId ? selectionOverride.range : null;
  const setSelectedRange = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectionOverride({ revealRequestId, range });
    },
    [revealRequestId],
  );
  const surfaceRef = useRef<HTMLDivElement>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange,
  });
  const editor = useMemo(
    () =>
      new Editor<FileCommentAnnotationGroup>({
        persistState: true,
        persistStateStorage: "inMemory",
        onChange: (file, nextLineAnnotations) => {
          setProjectFileDraft(environmentId, cwd, relativePath, file.contents);
          saveCoordinator.change(file.contents);
          if (nextLineAnnotations) {
            const remapped = remapFileCommentAnnotations(
              nextLineAnnotations as FileCommentLineAnnotation[],
            );
            setLineAnnotations(remapped);
            for (const annotation of remapped) {
              for (const entry of annotation.metadata.entries) {
                if (entry.kind !== "comment") continue;
                addReviewComment(
                  composerDraftTarget,
                  buildFileReviewComment({
                    id: entry.id,
                    filePath: relativePath,
                    startLine: entry.startLine,
                    endLine: entry.endLine,
                    text: entry.text,
                    contents: file.contents,
                  }),
                );
              }
            }
          }
        },
      }),
    [addReviewComment, composerDraftTarget, cwd, environmentId, relativePath, saveCoordinator],
  );

  useEffect(
    () => () => {
      editor.cleanUp();
    },
    [editor],
  );

  const removeAnnotationEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      removeReviewComment(composerDraftTarget, entryId);
      setLineAnnotations((current) => {
        return current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.id !== entryId);
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
      });
    },
    [composerDraftTarget, removeReviewComment, setSelectedRange],
  );

  const submitAnnotationEntry = useCallback(
    (entryId: string, text: string) => {
      setSelectedRange(null);
      const entry = lineAnnotations
        .flatMap((annotation) => annotation.metadata.entries)
        .find((candidate) => candidate.id === entryId);
      if (entry) {
        addReviewComment(
          composerDraftTarget,
          buildFileReviewComment({
            id: entry.id,
            filePath: relativePath,
            startLine: entry.startLine,
            endLine: entry.endLine,
            text,
            contents,
          }),
        );
      }
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((annotationEntry) =>
              annotationEntry.id === entryId
                ? { ...annotationEntry, kind: "comment", text }
                : annotationEntry,
            ),
          },
        })),
      );
    },
    [
      addReviewComment,
      composerDraftTarget,
      contents,
      lineAnnotations,
      relativePath,
      setSelectedRange,
    ],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange) => {
      editor.setSelections([]);
      editor.blur();
      const { startLine, endLine } = normalizeFileCommentRange(range);
      const draftEntry: FileCommentAnnotationEntry = {
        id: nextFileCommentId(),
        kind: "draft",
        startLine,
        endLine,
        text: "",
      };
      setLineAnnotations((current) => {
        const withoutDraft = current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "draft");
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
        const existingIndex = withoutDraft.findIndex(
          (annotation) => annotation.lineNumber === endLine,
        );
        if (existingIndex < 0) {
          return [
            ...withoutDraft,
            {
              lineNumber: endLine,
              metadata: { entries: [draftEntry] },
            },
          ];
        }
        return withoutDraft.map((annotation, index) =>
          index === existingIndex
            ? {
                ...annotation,
                metadata: { entries: [...annotation.metadata.entries, draftEntry] },
              }
            : annotation,
        );
      });
    },
    [editor],
  );
  const hasOpenCommentForm = lineAnnotations.some((annotation) =>
    annotation.metadata.entries.some((entry) => entry.kind === "draft"),
  );
  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    return installFileEditorDismissal({
      root,
      editor,
      isBlocked: () => hasOpenCommentForm,
      onDismiss: () => setSelectedRange(null),
    });
  }, [editor, hasOpenCommentForm, setSelectedRange]);
  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      if (range) {
        beginComment(range);
      }
    },
    [beginComment, setSelectedRange],
  );

  const handlePostRender = useCallback<FilePostRender>(
    (fileContainer, instance, phase) => {
      onPostRender(fileContainer, instance, phase);

      if (selectionFrameRef.current !== null) {
        cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
      }
      if (phase === "unmount") return;

      selectionFrameRef.current = requestAnimationFrame(() => {
        selectionFrameRef.current = null;
        if (!fileContainer.isConnected) return;
        instance.setSelectedLines(selectedRange, { notify: false });
      });
    },
    [onPostRender, selectedRange],
  );

  return (
    <EditProvider editor={editor}>
      <div ref={surfaceRef} className="flex min-h-0 flex-1">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<FileCommentAnnotationGroup>
            file={{
              name: relativePath,
              contents,
              cacheKey: projectFileEditorCacheKey(
                environmentId,
                cwd,
                relativePath,
                contents,
                editor.getFile(),
              ),
            }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: !hasOpenCommentForm,
              enableLineSelection: !hasOpenCommentForm,
              onGutterUtilityClick: setSelectedRange,
              onLineSelectionChange: setSelectedRange,
              onLineSelectionEnd: handleLineSelectionEnd,
              overflow: wordWrap ? "wrap" : "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              onPostRender: handlePostRender,
            }}
            selectedLines={selectedRange}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => (
              <div className="py-1">
                {annotation.metadata.entries.map((entry) => (
                  <DiffCommentAnnotation
                    key={entry.id}
                    kind={entry.kind}
                    rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                    text={entry.text}
                    onCancel={() => removeAnnotationEntry(entry.id)}
                    onComment={(text) => submitAnnotationEntry(entry.id, text)}
                    onDelete={() => removeAnnotationEntry(entry.id)}
                  />
                ))}
              </div>
            )}
            className="min-h-full"
            contentEditable
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}

function RenderedMarkdownSurface({
  environmentId,
  cwd,
  relativePath,
  contents,
  threadRef,
  onPendingChange,
}: Omit<
  EditableFileSurfaceProps,
  | "resolvedTheme"
  | "composerDraftTarget"
  | "revealLine"
  | "revealRequestId"
  | "wordWrap"
  | "onPostRender"
> & {
  threadRef: ScopedThreadRef;
}) {
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange,
  });

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ChatMarkdown
        text={contents}
        cwd={cwd}
        threadRef={threadRef}
        className="mx-auto max-w-4xl px-6 py-5"
        onTaskListChange={({ markerOffset, checked }) => {
          const currentContents =
            getProjectFileDraft(environmentId, cwd, relativePath)?.contents ?? contents;
          const nextContents = setMarkdownTaskChecked(currentContents, markerOffset, checked);
          if (nextContents === currentContents) return;
          setProjectFileDraft(environmentId, cwd, relativePath, nextContents);
          saveCoordinator.change(nextContents);
        }}
      />
    </ScrollArea>
  );
}

function initialExplorerOpen(): boolean {
  try {
    return getLocalStorageItem(FILE_EXPLORER_STORAGE_KEY, Schema.Boolean) ?? true;
  } catch (error) {
    console.error(error);
    return true;
  }
}

/**
 * A path the Files tab is asked for: a workspace file by its path there, or a
 * file this conversation's agent wrote outside it, by its absolute path — as
 * the agent wrote it, from the thread's record, never read from disk
 * (`WrittenFilePanel`).
 */
/** Why the file could not be shown, with the path it tried and the folder it looked in. */
export function FileReadFailure(props: {
  readonly failure: FilePreviewReadFailure | null;
  readonly fallback: string;
}) {
  const { failure } = props;
  return (
    <div role="alert" className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="my-auto flex shrink-0 flex-col gap-3 px-6 py-6 text-center text-xs leading-relaxed">
        <p className="text-destructive">{failure?.message ?? props.fallback}</p>
        {failure?.attemptedPath ? (
          <p className="text-muted-foreground">
            Tried
            <code className="block break-all font-mono text-foreground select-all">
              {failure.attemptedPath}
            </code>
          </p>
        ) : null}
        {failure ? (
          <p className="text-muted-foreground">
            In <code className="break-all font-mono select-all">{failure.workspaceFolder}</code>.
            Check the link's path, or find the file in Files.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function FilePreviewPanel(props: FilePreviewPanelProps) {
  const { relativePath } = props;
  if (
    relativePath !== null &&
    (relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(relativePath))
  ) {
    return (
      <WrittenFilePanel
        key={relativePath}
        environmentId={props.environmentId}
        path={relativePath}
        threadRef={props.threadRef}
      />
    );
  }
  return <WorkspaceFilePreviewPanel {...props} />;
}

function WorkspaceFilePreviewPanel({
  environmentId,
  cwd,
  projectName,
  relativePath,
  threadRef,
  composerDraftTarget,
  keybindings,
  availableEditors,
  revealLine,
  revealRequestId,
  onOpenFile,
  onPendingChange,
}: FilePreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const remoteOpenState = useRemoteOpenState(environmentId);
  // Images render from their absolute path, so their contents are never shown.
  // The read still runs: a folder named `assets.png` is only knowable as a
  // folder from the read failure, and the server stats before reading.
  const file = useProjectFileQuery(environmentId, cwd, relativePath);
  // A chat link cannot tell a folder from a file, so a folder arrives here as a
  // file surface and the read fails. Keep the breadcrumbs, drop the preview
  // pane, and let the tree fill the surface with the folder revealed.
  const isDirectory = file.isNotFile;
  // Everything preview-related keys off previewPath; a folder has no preview.
  const previewPath = isDirectory ? null : relativePath;
  const isImage = previewPath !== null && isWorkspaceImagePreviewPath(previewPath);
  const [explorerOpen, setExplorerOpen] = useState(initialExplorerOpen);
  // Reading markdown rendered is a preference, not a property of one file. Keeping
  // it on the panel meant a thread switch dropped it and forced source back.
  const [renderMarkdownPreferred, setRenderMarkdownPreferred] = useLocalStorage(
    RENDER_MARKDOWN_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  // Paired with the path on purpose: each file surface counts its reveals from
  // one, so a bare id would let a dismissed reveal on one file swallow the first
  // reveal on the next.
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(
    null,
  );
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const isMarkdown = previewPath ? isMarkdownPreviewFile(previewPath) : false;
  // A reveal still wins over the preference: the line only exists in the source.
  const renderMarkdown =
    isMarkdown &&
    renderMarkdownPreferred &&
    (revealLine === null ||
      (handledReveal?.path === relativePath && handledReveal.requestId === revealRequestId));
  const absolutePath = relativePath ? resolvePathLinkTarget(relativePath, cwd) : null;
  const breadcrumbs = useMemo(
    () => (relativePath ? fileBreadcrumbs(projectName, relativePath) : []),
    [projectName, relativePath],
  );
  const onFilePostRender = useFileLineReveal(relativePath, revealLine, revealRequestId);

  useEffect(() => {
    const currentCrumb = breadcrumbRef.current?.querySelector<HTMLElement>(
      "[data-current-file-crumb='true']",
    );
    currentCrumb?.scrollIntoView({ block: "nearest", inline: "end" });
  }, [relativePath]);

  const toggleExplorer = () => {
    setExplorerOpen((current) => {
      const next = !current;
      try {
        setLocalStorageItem(FILE_EXPLORER_STORAGE_KEY, next, Schema.Boolean);
      } catch (error) {
        console.error(error);
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {relativePath ? (
        <div
          className="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
          data-surface-subheader
        >
          <ScrollArea
            radius="none"
            ref={breadcrumbRef}
            hideScrollbars
            scrollFade
            className="min-w-0 flex-1"
            data-file-breadcrumbs
          >
            <div className="flex h-full w-max min-w-full items-center text-xs">
              {breadcrumbs.map((crumb, index) => (
                <div
                  key={crumb.path || "project"}
                  className="flex min-w-0 shrink-0 items-center"
                  data-current-file-crumb={crumb.kind === "file"}
                >
                  {index > 0 ? (
                    <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground/60" />
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          className={cn(
                            "max-w-40 truncate",
                            crumb.kind === "file"
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        />
                      }
                    >
                      {crumb.label}
                    </TooltipTrigger>
                    <TooltipPopup side="top">{crumb.path || projectName}</TooltipPopup>
                  </Tooltip>
                </div>
              ))}
            </div>
          </ScrollArea>
          {absolutePath &&
          (environmentId === primaryEnvironmentId || remoteOpenState.mode !== "local-exec") ? (
            <OpenInPicker
              environmentId={environmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={absolutePath}
              compact
              enableShortcut={false}
            />
          ) : null}
          {isMarkdown ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={renderMarkdown}
                    onPressedChange={(pressed) => {
                      setRenderMarkdownPreferred(pressed);
                      setHandledReveal(
                        pressed && relativePath !== null
                          ? { path: relativePath, requestId: revealRequestId }
                          : null,
                      );
                    }}
                    aria-label={renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
                    variant="ghost"
                    size="sm"
                  >
                    {renderMarkdown ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Toggle>
                }
              />
              <TooltipPopup>
                {renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {previewPath !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={explorerOpen}
                    onPressedChange={toggleExplorer}
                    aria-label={explorerOpen ? "Hide file explorer" : "Show file explorer"}
                    variant="ghost"
                    size="sm"
                  >
                    <FolderTree className="size-3.5" />
                  </Toggle>
                }
              />
              <TooltipPopup>
                {explorerOpen ? "Hide file explorer" : "Show file explorer"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      {previewPath && file.data?.truncated ? (
        <div className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground">
          Preview limited to the first 1 MB of a {file.data.byteLength.toLocaleString()} byte file.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn("min-w-0 flex-1 flex-col overflow-hidden", previewPath ? "flex" : "hidden")}
        >
          {isDirectory ? null : relativePath && isImage && absolutePath ? (
            <WorkspaceImagePreview
              key={absolutePath}
              environmentId={environmentId}
              threadRef={threadRef}
              absolutePath={absolutePath}
              alt={relativePath}
            />
          ) : relativePath && file.error && file.data === null ? (
            <FileReadFailure
              failure={file.readError ? filePreviewReadFailure(file.readError, cwd) : null}
              fallback={file.error}
            />
          ) : relativePath && file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : relativePath && file.data ? (
            isMarkdown && renderMarkdown ? (
              // Markdown reconciles in place across text updates, so a file
              // switch needs a new key or the previous file's disclosure and
              // wrap state carries into the next document.
              <RenderedMarkdownSurface
                key={relativePath}
                environmentId={environmentId}
                cwd={cwd}
                relativePath={relativePath}
                threadRef={threadRef}
                contents={file.data.contents}
                onPendingChange={onPendingChange}
              />
            ) : file.data.truncated ? (
              <DiffWorkerPoolProvider>
                <Virtualizer
                  key={`${relativePath}:${resolvedTheme}:${file.data.byteLength}`}
                  className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
                  config={{
                    overscrollSize: 600,
                    intersectionObserverMargin: 1200,
                  }}
                >
                  <File
                    file={{
                      name: relativePath,
                      contents: file.data.contents,
                      cacheKey: projectFileCacheKey(cwd, relativePath, file.data.contents),
                    }}
                    options={{
                      disableFileHeader: true,
                      overflow: wordWrap ? "wrap" : "scroll",
                      theme: resolveDiffThemeName(resolvedTheme),
                      themeType: resolvedTheme,
                      unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
                      onPostRender: onFilePostRender,
                    }}
                    className="min-h-full"
                  />
                </Virtualizer>
              </DiffWorkerPoolProvider>
            ) : (
              <DiffWorkerPoolProvider>
                <EditableFileSurface
                  key={`${relativePath}:${resolvedTheme}`}
                  environmentId={environmentId}
                  cwd={cwd}
                  relativePath={relativePath}
                  composerDraftTarget={composerDraftTarget}
                  contents={file.data.contents}
                  resolvedTheme={resolvedTheme}
                  revealRequestId={revealRequestId}
                  wordWrap={wordWrap}
                  onPostRender={onFilePostRender}
                  onPendingChange={onPendingChange}
                />
              </DiffWorkerPoolProvider>
            )
          ) : null}
        </div>
        {explorerOpen || previewPath === null ? (
          <aside
            className={cn(
              "flex min-h-0 shrink-0 bg-background",
              previewPath
                ? // The code is what the person came for: the tree keeps a
                  // third of a narrow panel, not half of it.
                  "w-[min(18rem,32%)] min-w-40 border-l border-border/60"
                : "min-w-0 flex-1",
            )}
          >
            <FileBrowserPanel
              key={`${environmentId}:${cwd}`}
              environmentId={environmentId}
              cwd={cwd}
              projectName={projectName}
              selectedPath={relativePath}
              selectedPathRevealId={revealRequestId}
              onOpenFile={onOpenFile}
              {...(previewPath && !isImage ? { onRefreshSelectedFile: file.refresh } : {})}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
