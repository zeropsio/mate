import type {
  CheckpointHistory,
  CheckpointHistoryRoot,
  EnvironmentId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import {
  checkpointDetailState,
  checkpointHistoryNotice,
  checkpointRootNotice,
  checkpointRootResponseError,
} from "@t3tools/client-runtime/state/threads";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftId } from "../composerDraftStore";
import { useCheckpointDiff } from "../lib/checkpointDiffState";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { Button } from "./ui/button";

interface HistoryDiffProps {
  history: CheckpointHistory;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  fromTurnCount: number;
  toTurnCount: number;
  ignoreWhitespace: boolean;
  resolvedTheme: "light" | "dark";
  diffRenderMode: "split" | "stacked";
  wordWrap: boolean;
  composerDraftTarget: ScopedThreadRef | DraftId;
  selectedFilePath: string | null;
  revealRequestId: number;
}

export function CheckpointHistoryDiff(props: HistoryDiffProps) {
  const firstAvailable = props.history.roots.find(
    (entry) => entry.before.status === "captured" && entry.after.status === "captured",
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {checkpointHistoryNotice(props.history)}
      </p>
      {props.history.overlappingRunIds?.length ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Other Mate runs overlapped this work.
        </p>
      ) : null}
      {props.history.roots.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No working roots were recorded for this run.
        </p>
      ) : (
        props.history.roots.map((entry) => (
          <CheckpointRootDiff
            key={`${props.history.runId}:${entry.root.rootId}`}
            {...props}
            entry={entry}
            initiallyOpen={entry === (firstAvailable ?? props.history.roots[0])}
          />
        ))
      )}
    </div>
  );
}

function CheckpointRootDiff(
  props: HistoryDiffProps & { entry: CheckpointHistoryRoot; initiallyOpen: boolean },
) {
  const { entry } = props;
  const selectionKey = `${props.revealRequestId}:${props.selectedFilePath ?? ""}`;
  const selectionMatchesRoot = Boolean(
    props.selectedFilePath &&
    (!entry.root.pathPrefix || props.selectedFilePath.startsWith(entry.root.pathPrefix)),
  );
  const [expansion, setExpansion] = useState({
    expanded: props.initiallyOpen || selectionMatchesRoot,
    selectionKey,
  });
  const expanded =
    expansion.selectionKey !== selectionKey && selectionMatchesRoot ? true : expansion.expanded;
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const sectionRef = useRef<HTMLElement>(null);
  const viewerRef = useRef<AnnotatableCodeViewHandle>(null);
  const query = useCheckpointDiff(
    {
      environmentId: props.environmentId,
      threadId: props.threadId,
      fromTurnCount: props.fromTurnCount,
      toTurnCount: props.toTurnCount,
      ignoreWhitespace: props.ignoreWhitespace,
      rootId: entry.root.rootId,
      cacheScope: props.history.runId,
      runId: props.history.runId,
    },
    { enabled: expanded },
  );
  const responseError = checkpointRootResponseError(query.data, entry.root.rootId);
  const detail = responseError ? null : query.data;
  const state = checkpointDetailState(detail, query.error ?? responseError, query.isPending);
  const patch = useMemo(
    () => getRenderablePatch(detail?.diff, `history:${props.resolvedTheme}`),
    [detail?.diff, props.resolvedTheme],
  );
  const files = useMemo(
    () =>
      patch?.kind === "files"
        ? patch.files.map((fileDiff) => {
            const fileKey = buildFileDiffRenderKey(fileDiff);
            return {
              fileDiff,
              fileKey,
              filePath: resolveFileDiffPath(fileDiff),
              collapsed: collapsedFiles.has(fileKey),
            };
          })
        : [],
    [patch, collapsedFiles],
  );
  useEffect(() => {
    if (selectionKey !== "0:" && selectionMatchesRoot && expanded) {
      sectionRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectionKey, selectionMatchesRoot, expanded]);
  useEffect(() => {
    const selected = files.find((file) => file.filePath === props.selectedFilePath);
    if (selectionKey !== "0:" && selected)
      viewerRef.current?.scrollTo({ type: "item", id: selected.fileKey, align: "start" });
  }, [files, props.selectedFilePath, selectionKey]);
  return (
    <section
      ref={sectionRef}
      className="border-t border-border"
      aria-label={`${entry.root.label} changes`}
    >
      <div className="flex items-center gap-2 bg-secondary px-3 py-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium"
          aria-expanded={expanded}
          onClick={() => setExpansion({ expanded: !expanded, selectionKey })}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
          <span className="truncate">{entry.root.label}</span>
          {entry.files !== undefined && (
            <span className="font-normal text-muted-foreground">
              {entry.files.length} recorded file{entry.files.length === 1 ? "" : "s"}
            </span>
          )}
        </button>
        {expanded && (
          <Button
            size="xs"
            variant="outline"
            disabled={query.isPending && !query.error}
            onClick={query.refresh}
            aria-label={`Retry ${entry.root.label} diff`}
          >
            {query.isPending && !query.error ? "Loading…" : "Retry"}
          </Button>
        )}
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground">{checkpointRootNotice(entry)}</p>
      {expanded && (
        <>
          {state.message && (
            <p
              role={state.kind === "unavailable" ? "status" : undefined}
              className="px-3 pb-2 text-xs text-muted-foreground"
            >
              {state.message}
            </p>
          )}
          {state.kind === "loading" && (
            <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
              Loading {entry.root.label} changes…
            </p>
          )}
          {files.length > 0 && (
            <AnnotatableCodeView
              viewerRef={viewerRef}
              codeViewKey={`${props.history.runId}:${entry.root.rootId}:${props.ignoreWhitespace}`}
              className="h-96 min-h-0 overflow-auto"
              files={files}
              sectionId={`run:${props.history.runId}:root:${entry.root.rootId}`}
              sectionTitle={entry.root.label}
              composerDraftTarget={props.composerDraftTarget}
              renderHeaderPrefix={(_file, key, collapsed) => (
                <Button
                  size="icon-micro"
                  variant="ghost"
                  aria-label={collapsed ? "Expand file" : "Collapse file"}
                  onClick={() =>
                    setCollapsedFiles((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  {collapsed ? (
                    <ChevronRightIcon className="size-3.5" />
                  ) : (
                    <ChevronDownIcon className="size-3.5" />
                  )}
                </Button>
              )}
              options={{
                diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
                lineDiffType: "none",
                overflow: props.wordWrap ? "wrap" : "scroll",
                theme: resolveDiffThemeName(props.resolvedTheme),
                themeType: props.resolvedTheme,
                stickyHeaders: true,
              }}
            />
          )}
          {state.kind === "changes" && patch?.kind === "raw" && (
            <div className="p-3">
              <p className="text-xs text-muted-foreground">{patch.reason}</p>
              <pre className="overflow-auto whitespace-pre-wrap text-xs">{patch.text}</pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
