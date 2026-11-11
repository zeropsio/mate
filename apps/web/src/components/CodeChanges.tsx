"use client";

/**
 * The Code page, read: what changed in the conversation's code, live from git as the Git page reads
 * it — per repository, everything not on main (its commits main lacks, and what is not committed
 * beside them, marked so) or what is not committed alone — under where the Mate's work is (`top`).
 * `CodePage` draws it; this reads it.
 */
import { resolveDiffThemeName } from "~/lib/diffPresentation";
import type { FileDiffContentsLoader, FileDiffMetadata } from "@pierre/diffs";
import { useParams } from "@tanstack/react-router";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ReviewDiffPreviewSource, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type DraftId } from "../composerDraftStore";
import { openDiffFile } from "../diffFileActions";
import { cn } from "~/lib/utils";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffRenderKey,
  getDiffLineStat,
  getRenderablePatch,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings } from "../hooks/useSettings";
import { DiffPanelLoadingState } from "./DiffPanelShell";
import { baseRefPresentation, diffChoices, shownDiff } from "./DiffPanel.logic";
import {
  choiceLabel,
  choiceValue,
  CodeChangesEmpty,
  CodeChangesToolbar,
  CodeCompare,
  CodePage,
  type CodeFile,
} from "./CodePage";
import { useDiffRepositories } from "./useDiffRepositories";
import { useThreadLeases } from "../zerops/useThreadLeases";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { filterBaseRefChoices } from "../lib/baseRefChoices";
import { createGitDiffFileContentsLoader } from "../lib/diffFileContents";

type DiffThemeType = "light" | "dark";
const AUTOMATIC_BASE_REF = "__automatic_base_ref__";
/** The cache scope of what is not committed: its files load their contents from the work tree. */
const NOT_COMMITTED_SCOPE = "code-not-committed";
const COMMITTED_SCOPE = "code-committed";

interface OpenedFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

const NO_FILE_KEYS: ReadonlySet<string> = new Set();

/** One source's files, by path, as the list shows them. */
function sourceFiles(
  source: ReviewDiffPreviewSource | undefined,
  scope: string,
  theme: string,
): { readonly files: ReadonlyArray<FileDiffMetadata>; readonly raw: string | null } {
  const patch = getRenderablePatch(source?.diff, `${scope}:${theme}`, {
    compactPartialHunkOffsets: true,
  });
  if (patch === null) return { files: [], raw: null };
  if (patch.kind === "raw") return { files: [], raw: patch.text };
  return {
    files: patch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    ),
    raw: null,
  };
}

export interface CodeChangesProps {
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  /** Where the work is: the project and each repository's change; none outside a Zerops project. */
  readonly top?: ReactNode;
  /** The Mate's change's commits in a repository, by its name; nothing where it has none. */
  readonly commitsFor?: ((repository: string) => ReactNode) | undefined;
  readonly className?: string;
}

export function CodeChanges({ composerDraftTarget, top, commitsFor, className }: CodeChangesProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings((settings) => ({
    diffIgnoreWhitespace: settings.diffIgnoreWhitespace,
    wordWrap: settings.wordWrap,
  }));
  const diffRenderMode = useDiffPanelStore((state) => state.diffRenderMode);
  const setDiffRenderMode = useDiffPanelStore((state) => state.setDiffRenderMode);
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [openedFiles, setOpenedFiles] = useState<OpenedFilesState>(() => ({
    scopeKey: null,
    fileKeys: NO_FILE_KEYS,
  }));
  const lastCompletedTurnRefreshRef = useRef<{
    readonly threadKey: string | null;
    readonly turnKey: string | null;
  } | null>(null);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const changesAsked = useDiffPanelStore(
    (state) => routeThreadKey !== null && state.changesAsked[routeThreadKey] === true,
  );
  const onChangesShown = useCallback(() => {
    if (routeThreadRef) useDiffPanelStore.getState().takeChangesAsk(routeThreadRef);
  }, [routeThreadRef]);
  const activeThread = useThread(routeThreadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useProject(
    activeThread && activeProjectId
      ? {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.workspaceRoot;
  const activeRepositoryRoot = activeThread?.worktreePath
    ? undefined
    : activeProject?.repositoryIdentity?.rootPath;
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const leases = useThreadLeases(
    activeThread?.environmentId ?? null,
    activeThread?.id ?? null,
    activeThread?.lease ?? null,
  );
  const { reads } = useDiffRepositories(
    activeThread?.environmentId ?? null,
    activeCwd ?? null,
    activeThread?.crew ?? null,
    leases,
    activeThread?.id ?? null,
  );
  const diffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(state.byThreadKey, routeThreadRef),
  );
  const choices = useMemo(() => diffChoices(reads ?? []), [reads]);
  const shown = shownDiff(reads, diffSelection);
  const shownChoice = shown.kind === "choice" ? shown.choice : null;
  const selectedGitScope = shownChoice?.scope ?? null;
  const shownCwd = shownChoice?.repository.cwd ?? null;
  const selectedBaseRef =
    (diffSelection.kind === "branch" &&
    shownChoice?.scope === "branch" &&
    (diffSelection.repository === undefined ||
      diffSelection.repository === shownChoice.repository.name)
      ? diffSelection.baseRef
      : null) ?? (shownChoice?.scope === "branch" ? shownChoice.baseRef : null);
  const reviewSectionId = shownChoice === null ? "diff" : choiceValue(shownChoice);
  const openScopeKey = routeThreadKey === null ? null : `${routeThreadKey}:${reviewSectionId}`;
  const openedFileKeys =
    openedFiles.scopeKey === openScopeKey ? openedFiles.fileKeys : NO_FILE_KEYS;
  const shownLabel = choiceLabel(shownChoice, choices);
  const branchDiffPreview = useEnvironmentQuery(
    activeThread && shownCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: shownCwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const refreshPreview = branchDiffPreview.refresh;
  // Git's status picks what Diff offers, so reading git again starts there: a commit or a push
  // shows at once rather than at the status's next cycle.
  const refreshBranchDiffPreview = useCallback(() => {
    if (activeThread)
      for (const { repository } of reads ?? [])
        void refreshVcsStatus({
          environmentId: activeThread.environmentId,
          input: { cwd: repository.cwd },
        });
    refreshPreview();
  }, [activeThread, reads, refreshPreview, refreshVcsStatus]);
  const canRefreshGitDiff = activeThread != null && reads !== null && reads.length > 0;
  const activeThreadRefreshKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}`
    : null;
  const latestTurnKey = activeThread?.latestTurn?.completedAt
    ? `${activeThread.latestTurn.turnId}:${activeThread.latestTurn.completedAt}`
    : null;

  useEffect(() => {
    if (!canRefreshGitDiff) return;
    const refreshOnFocus = () => refreshBranchDiffPreview();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [canRefreshGitDiff, refreshBranchDiffPreview]);

  // A turn that ends may have changed the code: the shown diff is read again.
  useEffect(() => {
    const current = { threadKey: activeThreadRefreshKey, turnKey: latestTurnKey };
    const previous = lastCompletedTurnRefreshRef.current;
    if (!canRefreshGitDiff) {
      return;
    }
    if (previous === null || previous.threadKey !== current.threadKey) {
      lastCompletedTurnRefreshRef.current = current;
      return;
    }
    if (previous.turnKey === current.turnKey) return;
    refreshBranchDiffPreview();
    lastCompletedTurnRefreshRef.current = current;
  }, [activeThreadRefreshKey, canRefreshGitDiff, latestTurnKey, refreshBranchDiffPreview]);

  const preview = branchDiffPreview.data;
  const notCommittedSource = preview?.sources.find((source) => source.kind === "working-tree");
  const committedSource =
    selectedGitScope === "branch"
      ? preview?.sources.find((source) => source.kind === "branch-range")
      : undefined;
  const loadDiffFiles = useMemo<FileDiffContentsLoader | undefined>(() => {
    if (!activeThread || !preview) return undefined;
    const loaderFor = (source: ReviewDiffPreviewSource | undefined) =>
      source === undefined
        ? undefined
        : createGitDiffFileContentsLoader(getDiffFileContents, {
            environmentId: activeThread.environmentId,
            cwd: preview.cwd,
            sourceKind: source.kind,
            baseRef: source.baseRef,
            headRef: source.headRef,
            cacheKey: source.diffHash,
          });
    const notCommitted = loaderFor(notCommittedSource);
    const committed = loaderFor(committedSource);
    return async (fileDiff) => {
      const loader = fileDiff.cacheKey?.startsWith(NOT_COMMITTED_SCOPE) ? notCommitted : committed;
      if (loader === undefined) throw new Error("No source to read this file from.");
      return loader(fileDiff);
    };
  }, [activeThread, committedSource, getDiffFileContents, notCommittedSource, preview]);
  const localBranchRefs = useEnvironmentQuery(
    selectedGitScope === "branch" && activeThread && preview?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: preview.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    selectedGitScope === "branch" && activeThread && preview?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: preview.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const refreshGitDiff = () => {
    refreshBranchDiffPreview();
    localBranchRefs.refresh();
    remoteBranchRefs.refresh();
  };
  const refPresentation = baseRefPresentation(
    localBranchRefs,
    remoteBranchRefs,
    committedSource?.headRef,
  );
  const baseRefChoices = refPresentation.choices;
  const matchingBaseRefChoices = filterBaseRefChoices(baseRefChoices, baseRefQuery);
  const valueForBaseRefChoice = (choice: (typeof baseRefChoices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const baseRefItems = [AUTOMATIC_BASE_REF, ...baseRefChoices.map(valueForBaseRefChoice)];
  const filteredBaseRefItems = [
    ...(baseRefQuery.trim().length === 0 ? [AUTOMATIC_BASE_REF] : []),
    ...matchingBaseRefChoices.map(valueForBaseRefChoice),
  ];

  const isLoadingPreview = branchDiffPreview.isPending;
  const previewError = branchDiffPreview.error;
  const notCommitted = useMemo(
    () => sourceFiles(notCommittedSource, NOT_COMMITTED_SCOPE, resolvedTheme),
    [notCommittedSource, resolvedTheme],
  );
  const committed = useMemo(
    () => sourceFiles(committedSource, COMMITTED_SCOPE, resolvedTheme),
    [committedSource, resolvedTheme],
  );
  const raw = selectedGitScope === null ? null : (notCommitted.raw ?? committed.raw);
  const files = useMemo<ReadonlyArray<CodeFile>>(() => {
    // Beside commits, a file not committed says so; alone, the picker already says it.
    const marks = committedSource !== undefined;
    const entry = (fileDiff: FileDiffMetadata, notCommittedFile: boolean): CodeFile => {
      const fileKey = buildFileDiffRenderKey(fileDiff);
      return {
        fileDiff,
        fileKey,
        filePath: resolveFileDiffPath(fileDiff),
        collapsed: !openedFileKeys.has(fileKey),
        notCommitted: notCommittedFile,
      };
    };
    return [
      ...notCommitted.files.map((fileDiff) => entry(fileDiff, marks)),
      ...committed.files.map((fileDiff) => entry(fileDiff, false)),
    ];
  }, [committed.files, committedSource, notCommitted.files, openedFileKeys]);
  const fileKeys = useMemo(() => files.map((file) => file.fileKey), [files]);
  const allCollapsed = fileKeys.every((fileKey) => !openedFileKeys.has(fileKey));
  const lineStat = useMemo(() => getDiffLineStat(files.map((file) => file.fileDiff)), [files]);
  /** What the shown choice draws: what is not committed, then on the branch what main lacks. */
  const shownSources = (
    selectedGitScope === null ? [] : [notCommittedSource, committedSource]
  ).filter((source) => source !== undefined);
  const isTruncated = shownSources.some((source) => source.truncated);

  const openFile = (filePath: string) => {
    if (!routeThreadRef) return;
    openDiffFile({
      threadRef: routeThreadRef,
      filePath,
      activeCwd: shownCwd ?? activeCwd,
      repositoryRoot: shownCwd ?? activeRepositoryRoot,
    });
  };
  const toggleFile = useCallback(
    (fileKey: string) => {
      setOpenedFiles((current) => {
        const next = new Set(current.scopeKey === openScopeKey ? current.fileKeys : []);
        if (next.has(fileKey)) next.delete(fileKey);
        else next.add(fileKey);
        return { scopeKey: openScopeKey, fileKeys: next };
      });
    },
    [openScopeKey],
  );
  const toggleAllFiles = useCallback(() => {
    setOpenedFiles({
      scopeKey: openScopeKey,
      fileKeys: allCollapsed ? new Set(fileKeys) : NO_FILE_KEYS,
    });
  }, [allCollapsed, fileKeys, openScopeKey]);

  // Another choice draws another list from its top: the page keeps "What changed" in view.
  const selectChoice = (value: string) => {
    const choice = choices.find((candidate) => choiceValue(candidate) === value);
    if (!routeThreadRef || !choice) return;
    const store = useDiffPanelStore.getState();
    store.selectGitScope(routeThreadRef, choice.scope, choice.repository.name);
    store.askChanges(routeThreadRef);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!routeThreadRef || shownChoice === null) return;
    const store = useDiffPanelStore.getState();
    store.selectGitScope(routeThreadRef, "branch", shownChoice.repository.name);
    store.selectBranchBaseRef(routeThreadRef, baseRef);
    store.askChanges(routeThreadRef);
  };

  const compare =
    selectedGitScope === "branch" && committedSource?.baseRef ? (
      <CodeCompare base={committedSource.baseRef} head={committedSource.headRef ?? "HEAD"}>
        <Combobox
          items={baseRefItems}
          filteredItems={filteredBaseRefItems}
          value={selectedBaseRef ?? AUTOMATIC_BASE_REF}
          onOpenChange={(open) => {
            if (!open) setBaseRefQuery("");
          }}
          onValueChange={(value) => {
            if (!value) return;
            selectBranchBaseRef(value === AUTOMATIC_BASE_REF ? null : value);
          }}
        >
          <ComboboxTrigger
            render={<Button variant="ghost" size="sm" />}
            className="min-w-0 max-w-48"
            aria-label={`Change comparison target. Currently ${committedSource.baseRef}`}
          >
            <span className="min-w-0 truncate">{committedSource.baseRef}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
          </ComboboxTrigger>
          <ComboboxPopup
            align="start"
            className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden [&>[data-slot=combobox-popup]]:min-w-0 [&>[data-slot=combobox-popup]]:overflow-hidden"
          >
            <ComboboxSearchInput
              placeholder="Search refs..."
              value={baseRefQuery}
              onChange={(event) => setBaseRefQuery(event.target.value)}
            />
            <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-3xs text-muted-foreground uppercase tracking-wide">
              <span aria-hidden="true" />
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
                <span>Branch</span>
                <span className="text-right">Remote</span>
              </div>
            </div>
            {refPresentation.message ? (
              <p role="status">
                {refPresentation.message}
                {refPresentation.retained && baseRefChoices.length > 0
                  ? " Showing last-known refs."
                  : null}
                {refPresentation.canRetry ? (
                  <Button size="sm" variant="secondary" onClick={refreshGitDiff}>
                    Refresh diff
                  </Button>
                ) : null}
              </p>
            ) : null}
            {refPresentation.emptyMessage ? (
              <ComboboxEmpty>{refPresentation.emptyMessage}</ComboboxEmpty>
            ) : null}
            <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
              <ComboboxItem
                className="w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)]"
                value={AUTOMATIC_BASE_REF}
              >
                <span className="block min-w-0 truncate">Automatic</span>
              </ComboboxItem>
              {baseRefChoices.map((choice) => {
                const item = valueForBaseRefChoice(choice);
                const hasBoth = choice.local !== null && choice.remote !== null;
                const useRemote = choice.remote?.name === item;
                return (
                  <ComboboxItem
                    key={choice.id}
                    className="w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)]"
                    value={item}
                  >
                    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center overflow-hidden">
                      <span className="block min-w-0 truncate pe-2">{choice.label}</span>
                      {hasBoth ? (
                        <div
                          className="flex justify-end"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <Switch
                            aria-label={`Use remote version of ${choice.label}`}
                            checked={useRemote}
                            className="[--thumb-size:--spacing(3)]"
                            onCheckedChange={(checked) => {
                              const nextRef = checked ? choice.remote?.name : choice.local?.name;
                              if (nextRef) selectBranchBaseRef(nextRef);
                            }}
                          />
                        </div>
                      ) : choice.remote ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="flex justify-end text-muted-foreground">
                                <CheckIcon role="img" aria-label="Remote only" className="size-3" />
                              </span>
                            }
                          />
                          <TooltipPopup side="top">Remote only</TooltipPopup>
                        </Tooltip>
                      ) : null}
                    </div>
                  </ComboboxItem>
                );
              })}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>
      </CodeCompare>
    ) : null;

  const toolbar = (
    <CodeChangesToolbar
      choices={choices}
      collapse={files.length > 0 ? { allCollapsed, onToggle: toggleAllFiles } : null}
      compare={compare}
      onChoose={selectChoice}
      refresh={
        canRefreshGitDiff
          ? { pending: branchDiffPreview.isPending, onRefresh: refreshGitDiff }
          : null
      }
      shown={shownChoice}
      stat={files.length > 0 ? lineStat : null}
      view={{
        mode: diffRenderMode,
        onMode: setDiffRenderMode,
        wrap: wordWrap,
        onWrap: setWordWrap,
        ignoreWhitespace: diffIgnoreWhitespace,
        onIgnoreWhitespace: setDiffIgnoreWhitespace,
      }}
    />
  );

  const tryAgain = (
    <Button size="sm" variant="link" onClick={refreshGitDiff}>
      Try again
    </Button>
  );
  const nothingShown = shownSources.every((source) => source.diff.trim().length === 0);
  const state: ReactNode = !activeThread ? (
    // A conversation on its way in loads; only no conversation at all asks for one.
    routeThreadRef ? (
      <DiffPanelLoadingState label="Loading conversation..." />
    ) : (
      <CodeChangesEmpty title="Select a thread to see its changes." />
    )
  ) : shown.kind === "reading" ? (
    <DiffPanelLoadingState label="Reading git..." />
  ) : shown.kind === "no-code" ? (
    <CodeChangesEmpty title="No code here yet." />
  ) : shown.kind === "nothing-outside-main" ? (
    <CodeChangesEmpty line="Every change is committed and on main." title="Nothing outside main." />
  ) : files.length > 0 ? null : raw !== null ? (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-2xs text-muted-foreground/75">Showing the raw patch.</p>
      <pre
        className={cn(
          "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-2xs leading-relaxed text-muted-foreground/90",
          wordWrap ? "overflow-auto whitespace-pre-wrap wrap-break-word" : "overflow-auto",
        )}
      >
        {raw}
      </pre>
    </div>
  ) : previewError ? (
    // A read that failed is not a diff with nothing in it: it says so, and reads again.
    <CodeChangesEmpty
      action={tryAgain}
      alert
      line={previewError}
      title="Could not read the diff."
    />
  ) : isLoadingPreview || preview === null ? (
    <DiffPanelLoadingState
      label={
        selectedGitScope === "unstaged" ? "Loading working tree diff..." : "Loading branch diff..."
      }
    />
  ) : nothingShown && shownChoice ? (
    <CodeChangesEmpty title={shownChoice.nothing} />
  ) : (
    <CodeChangesEmpty title="No patch available for this selection." />
  );
  const notices = (
    <>
      {isTruncated && files.length > 0 ? (
        <p className="rounded-md bg-muted/40 px-3 py-1.5 text-2xs text-muted-foreground">
          This diff was truncated because it exceeded the preview limit. The changes shown are
          incomplete.
        </p>
      ) : null}
      {previewError && files.length > 0 ? (
        <div className="flex items-center gap-2">
          <p className="text-2xs text-error/80">{previewError}</p>
          {tryAgain}
        </div>
      ) : null}
    </>
  );

  return (
    <CodePage
      changesAsked={changesAsked}
      className={className}
      commits={shownChoice?.scope === "branch" ? commitsFor?.(shownChoice.repository.name) : null}
      composerDraftTarget={composerDraftTarget}
      files={files}
      notices={notices}
      onChangesShown={onChangesShown}
      onOpenFile={openFile}
      onToggleFile={toggleFile}
      options={{
        diffStyle: diffRenderMode === "split" ? "split" : "unified",
        lineDiffType: "none",
        overflow: wordWrap ? "wrap" : "scroll",
        theme: resolveDiffThemeName(resolvedTheme),
        themeType: resolvedTheme as DiffThemeType,
        stickyHeaders: true,
        ...(loadDiffFiles ? { loadDiffFiles } : {}),
      }}
      sectionId={reviewSectionId}
      sectionTitle={shownLabel}
      state={state}
      toolbar={toolbar}
      top={top}
      viewKey={openScopeKey ?? reviewSectionId}
    />
  );
}
