"use client";

import { resolveDiffThemeName } from "~/lib/diffPresentation";
import { useAtomValue } from "@effect/atom-react";
import type { FileDiffContentsLoader } from "@pierre/diffs";
import { useParams } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  PilcrowIcon,
  RefreshCwIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { type DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { cn } from "~/lib/utils";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { useRightPanelStore } from "../rightPanelStore";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffRenderKey,
  getDiffCollapseIconClassName,
  getDiffLineStat,
  getRenderablePatch,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { areAllDiffFilesCollapsed, toggleAllDiffFiles } from "../lib/diffCollapse";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings } from "../hooks/useSettings";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import {
  baseRefPresentation,
  diffChoiceCount,
  diffChoices,
  shownDiff,
  type DiffChoice,
} from "./DiffPanel.logic";
import { useDiffRepositories } from "./useDiffRepositories";
import { useThreadLeases } from "../zerops/useThreadLeases";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { Button } from "./ui/button";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { filterBaseRefChoices } from "../lib/baseRefChoices";
import { createGitDiffFileContentsLoader } from "../lib/diffFileContents";

type DiffThemeType = "light" | "dark";
const AUTOMATIC_BASE_REF = "__automatic_base_ref__";

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

const EMPTY_COLLAPSED_DIFF_FILE_KEYS: ReadonlySet<string> = new Set();

const choiceValue = (choice: DiffChoice) => `${choice.repository.name}:${choice.scope}`;

interface DiffPanelProps {
  mode?: DiffPanelMode;
  composerDraftTarget: ScopedThreadRef | DraftId;
}

/**
 * What the conversation's code has that main does not, live from git as the Git page reads it:
 * per repository, the changes not committed and the commits not on main (on main, not pushed).
 */
export default function DiffPanel({ mode = "inline", composerDraftTarget }: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const diffRenderMode = useDiffPanelStore((state) => state.diffRenderMode);
  const setDiffRenderMode = useDiffPanelStore((state) => state.setDiffRenderMode);
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const [codeViewRevision, setCodeViewRevision] = useState(0);
  const [codeView, setCodeView] = useState<AnnotatableCodeViewHandle | null>(null);
  const lastCompletedTurnRefreshRef = useRef<{
    readonly threadKey: string | null;
    readonly turnKey: string | null;
  } | null>(null);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
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
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(activeThread?.environmentId ?? null),
  );
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeThread?.environmentId ?? null,
    serverConfig?.availableEditors ?? [],
  );
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const leases = useThreadLeases(
    activeThread?.environmentId ?? null,
    activeThread?.id ?? null,
    activeThread?.lease ?? null,
  );
  const { reads, gitPage } = useDiffRepositories(
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
  const collapseScopeKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}:${reviewSectionId}`
    : null;
  const codeViewMountKey = `${collapseScopeKey ?? reviewSectionId}:${codeViewRevision}`;
  const collapsedDiffFileKeys =
    collapsedDiffFiles.scopeKey === collapseScopeKey
      ? collapsedDiffFiles.fileKeys
      : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
  const manyRepositories = new Set(choices.map((choice) => choice.repository.name)).size > 1;
  const shownLabel =
    shownChoice === null
      ? "Diff"
      : manyRepositories
        ? `${shownChoice.repository.name} · ${shownChoice.label}`
        : shownChoice.label;
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

  const selectedGitSource =
    selectedGitScope === null
      ? undefined
      : branchDiffPreview.data?.sources.find(
          (source) =>
            source.kind === (selectedGitScope === "unstaged" ? "working-tree" : "branch-range"),
        );
  const loadDiffFiles = useMemo<FileDiffContentsLoader | undefined>(() => {
    const preview = branchDiffPreview.data;
    if (!activeThread || !preview || !selectedGitSource) {
      return undefined;
    }

    return createGitDiffFileContentsLoader(getDiffFileContents, {
      environmentId: activeThread.environmentId,
      cwd: preview.cwd,
      sourceKind: selectedGitSource.kind,
      baseRef: selectedGitSource.baseRef,
      headRef: selectedGitSource.headRef,
      cacheKey: selectedGitSource.diffHash,
    });
  }, [activeThread, branchDiffPreview.data, getDiffFileContents, selectedGitSource]);
  const localBranchRefs = useEnvironmentQuery(
    selectedGitScope === "branch" && activeThread && branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    selectedGitScope === "branch" && activeThread && branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
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
    selectedGitSource?.headRef,
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

  const selectedPatch = selectedGitSource?.diff;
  const isSelectedPatchTruncated = selectedGitSource?.truncated === true;
  const isLoadingSelectedPatch = branchDiffPreview.isPending;
  const selectedPatchError = branchDiffPreview.error;
  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
        compactPartialHunkOffsets: true,
      }),
    [resolvedTheme, selectedPatch],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const codeViewFiles = useMemo(
    () =>
      renderableFiles.map((fileDiff) => {
        const fileKey = buildFileDiffRenderKey(fileDiff);
        return {
          fileDiff,
          filePath: resolveFileDiffPath(fileDiff),
          fileKey,
          collapsed: collapsedDiffFileKeys.has(fileKey),
        };
      }),
    [collapsedDiffFileKeys, renderableFiles],
  );
  const diffFileKeys = useMemo(() => codeViewFiles.map((file) => file.fileKey), [codeViewFiles]);
  const allDiffFilesCollapsed = areAllDiffFilesCollapsed(diffFileKeys, collapsedDiffFileKeys);
  const diffLineStat = useMemo(() => getDiffLineStat(renderableFiles), [renderableFiles]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd: shownCwd ?? activeCwd,
        repositoryRoot: shownCwd ?? activeRepositoryRoot,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(routeThreadRef
                  ? {
                      environmentId: routeThreadRef.environmentId,
                      threadId: routeThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, activeRepositoryRoot, openInPreferredEditor, routeThreadRef, shownCwd],
  );
  const toggleDiffFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => {
        const next = new Set(current.scopeKey === collapseScopeKey ? current.fileKeys : []);
        if (next.has(fileKey)) {
          next.delete(fileKey);
        } else {
          next.add(fileKey);
        }
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey],
  );

  const toggleDiffFileCollapse = useCallback(() => {
    setCodeViewRevision((current) => current + 1);
    setCollapsedDiffFiles((current) => {
      const currentKeys =
        current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS;

      return {
        scopeKey: collapseScopeKey,
        fileKeys: toggleAllDiffFiles(diffFileKeys, currentKeys),
      };
    });
  }, [collapseScopeKey, diffFileKeys]);

  const selectChoice = (value: string) => {
    const choice = choices.find((candidate) => choiceValue(candidate) === value);
    if (!routeThreadRef || !choice) return;
    useDiffPanelStore
      .getState()
      .selectGitScope(routeThreadRef, choice.scope, choice.repository.name);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!routeThreadRef || shownChoice === null) return;
    const store = useDiffPanelStore.getState();
    store.selectGitScope(routeThreadRef, "branch", shownChoice.repository.name);
    store.selectBranchBaseRef(routeThreadRef, baseRef);
  };
  const openGit = routeThreadRef
    ? () => useRightPanelStore.getState().open(routeThreadRef, "git")
    : null;
  const openGitButton =
    gitPage && openGit ? (
      <Button size="sm" variant="ghost" onClick={openGit}>
        Open Git
      </Button>
    ) : null;
  const repositoryNames = [...new Set(choices.map((choice) => choice.repository.name))];

  const headerRow = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3 [-webkit-app-region:no-drag]">
        {choices.length === 0 ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" variant="secondary" />}
              className="max-w-full"
              aria-label={`Diff shows: ${shownLabel}`}
            >
              <span className="truncate">{shownLabel}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={shownChoice === null ? "" : choiceValue(shownChoice)}
                onValueChange={selectChoice}
              >
                {repositoryNames.map((name) => (
                  <DropdownMenuGroup key={name}>
                    {manyRepositories ? <DropdownMenuLabel>{name}</DropdownMenuLabel> : null}
                    {choices
                      .filter((choice) => choice.repository.name === name)
                      .map((choice) => (
                        <DropdownMenuRadioItem
                          key={choiceValue(choice)}
                          value={choiceValue(choice)}
                          closeOnClick
                        >
                          <span className="flex w-full items-center gap-3">
                            <span>{choice.label}</span>
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                              {diffChoiceCount(choice)}
                            </span>
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {selectedGitScope === "branch" && selectedGitSource?.baseRef && (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
            aria-label={`Comparing ${selectedGitSource.headRef ?? "HEAD"} against ${selectedGitSource.baseRef}`}
          >
            <Tooltip>
              <TooltipTrigger render={<span className="flex min-w-0 items-center gap-2" />}>
                <span className="min-w-0 max-w-48 truncate">
                  {selectedGitSource.headRef ?? "HEAD"}
                </span>
                <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {`${selectedGitSource.headRef ?? "HEAD"} → ${selectedGitSource.baseRef}`}
              </TooltipPopup>
            </Tooltip>
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
                aria-label={`Change comparison target. Currently ${selectedGitSource.baseRef}`}
              >
                <span className="min-w-0 truncate">{selectedGitSource.baseRef}</span>
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
                                  const nextRef = checked
                                    ? choice.remote?.name
                                    : choice.local?.name;
                                  if (nextRef) selectBranchBaseRef(nextRef);
                                }}
                              />
                            </div>
                          ) : choice.remote ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="flex justify-end text-muted-foreground">
                                    <CheckIcon
                                      role="img"
                                      aria-label="Remote only"
                                      className="size-3"
                                    />
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
          </div>
        )}
      </div>
      {/* Views of a diff, while there is one to show. */}
      {shownChoice === null ? null : (
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {codeViewFiles.length > 0 && (
            <DiffStatLabel
              additions={diffLineStat.additions}
              deletions={diffLineStat.deletions}
              className="mr-1 text-2xs"
              layout="inline"
            />
          )}
          {openGitButton}
          {canRefreshGitDiff && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={branchDiffPreview.isPending ? "Refreshing diff" : "Refresh diff"}
                    onClick={refreshGitDiff}
                  />
                }
              >
                <RefreshCwIcon
                  className={cn("size-3.5", branchDiffPreview.isPending && "animate-spin")}
                />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {branchDiffPreview.isPending ? "Refreshing diff…" : "Refresh diff"}
              </TooltipPopup>
            </Tooltip>
          )}
          {codeViewFiles.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
                    onClick={toggleDiffFileCollapse}
                  />
                }
              >
                {allDiffFilesCollapsed ? (
                  <ChevronsUpDownIcon className="size-3.5" />
                ) : (
                  <ChevronsDownUpIcon className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
              </TooltipPopup>
            </Tooltip>
          )}
          <ToggleGroup
            aria-label="Diff layout"
            className="shrink-0"
            variant="segmented"
            value={[diffRenderMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                setDiffRenderMode(next);
              }
            }}
          >
            <Toggle aria-label="Stacked diff view" value="stacked">
              <Rows3Icon className="size-3.5" />
            </Toggle>
            <Toggle aria-label="Split diff view" value="split">
              <Columns2Icon className="size-3.5" />
            </Toggle>
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
                  variant="ghost"
                  size="sm"
                  pressed={wordWrap}
                  onPressedChange={(pressed) => {
                    setWordWrap(Boolean(pressed));
                  }}
                />
              }
            >
              <TextWrapIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={
                    diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                  }
                  variant="ghost"
                  size="sm"
                  pressed={diffIgnoreWhitespace}
                  onPressedChange={(pressed) => {
                    setDiffIgnoreWhitespace(Boolean(pressed));
                  }}
                />
              }
            >
              <PilcrowIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
            </TooltipPopup>
          </Tooltip>
        </div>
      )}
    </>
  );

  const emptyState = (title: string, line: string | null) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-xs text-muted-foreground">
      <p className="text-foreground">{title}</p>
      {line === null ? null : <p>{line}</p>}
      {openGit && gitPage ? (
        <Button size="sm" variant="link" onClick={openGit}>
          Open Git
        </Button>
      ) : null}
    </div>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        // A conversation on its way in loads; only no conversation at all asks for one.
        routeThreadRef ? (
          <DiffPanelLoadingState label="Loading conversation..." />
        ) : (
          <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
            Select a thread to see its changes.
          </div>
        )
      ) : shown.kind === "reading" ? (
        <DiffPanelLoadingState label="Reading git..." />
      ) : shown.kind === "no-code" ? (
        emptyState("No code here yet.", null)
      ) : shown.kind === "nothing-outside-main" ? (
        emptyState("Nothing outside main.", "Every change is committed and on main.")
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            {isSelectedPatchTruncated && (
              <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-2xs text-muted-foreground">
                This diff was truncated because it exceeded the preview limit. The changes shown are
                incomplete.
              </p>
            )}
            {selectedPatchError && renderablePatch && (
              <div className="flex items-center gap-2 px-3">
                <p className="text-2xs text-error/80">{selectedPatchError}</p>
                <Button size="sm" variant="link" onClick={refreshGitDiff}>
                  Try again
                </Button>
              </div>
            )}
            {!renderablePatch ? (
              selectedPatchError ? (
                // A read that failed is not a diff with nothing in it: it says so, and reads again.
                <div
                  role="alert"
                  className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-xs text-muted-foreground"
                >
                  <p className="text-foreground">Could not read the diff.</p>
                  <p className="text-error/80">{selectedPatchError}</p>
                  <Button size="sm" variant="link" onClick={refreshGitDiff}>
                    Try again
                  </Button>
                </div>
              ) : isLoadingSelectedPatch ? (
                <DiffPanelLoadingState
                  label={
                    selectedGitScope === "unstaged"
                      ? "Loading working tree diff..."
                      : "Loading branch diff..."
                  }
                />
              ) : typeof selectedPatch === "string" &&
                selectedPatch.trim().length === 0 &&
                shownChoice ? (
                emptyState(shownChoice.nothing, null)
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                  <p>No patch available for this selection.</p>
                </div>
              )
            ) : renderablePatch.kind === "files" ? (
              <div
                className="min-h-0 flex-1"
                onClickCapture={(event) => {
                  const composedPath = event.nativeEvent.composedPath?.() ?? [];
                  for (const node of composedPath) {
                    if (!(node instanceof HTMLElement)) continue;
                    // Header controls keep their own actions. In particular, the chevron must
                    // not also trigger the row handler or the two toggles cancel each other.
                    if (node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement) {
                      return;
                    }
                  }
                  const title = composedPath.find(
                    (node): node is HTMLElement =>
                      node instanceof HTMLElement && node.hasAttribute("data-title"),
                  );
                  const filePath = title?.textContent?.trim();
                  // The filename remains the explicit "open in editor" affordance.
                  if (filePath) {
                    openDiffFile(filePath);
                    return;
                  }
                  const header = composedPath.find(
                    (node): node is HTMLElement =>
                      node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
                  );
                  const headerFilePath = header?.querySelector("[data-title]")?.textContent?.trim();
                  if (!headerFilePath) return;
                  const file = codeViewFiles.find(
                    (candidate) => candidate.filePath === headerFilePath,
                  );
                  if (file) toggleDiffFileCollapsed(file.fileKey);
                }}
              >
                <AnnotatableCodeView
                  key={collapseScopeKey ?? reviewSectionId}
                  viewerRef={setCodeView}
                  codeViewKey={codeViewMountKey}
                  className="h-full min-h-0 overflow-auto"
                  files={codeViewFiles}
                  sectionId={reviewSectionId}
                  sectionTitle={shownLabel}
                  composerDraftTarget={composerDraftTarget}
                  renderHeaderPrefix={(fileDiff, fileKey, collapsed) => {
                    const filePath = resolveFileDiffPath(fileDiff);
                    return (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="-ms-0.5"
                              aria-label={collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`}
                              aria-expanded={!collapsed}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleDiffFileCollapsed(fileKey);
                              }}
                            />
                          }
                        >
                          {collapsed ? (
                            <ChevronRightIcon
                              className={cn("size-4", getDiffCollapseIconClassName(fileDiff))}
                            />
                          ) : (
                            <ChevronDownIcon
                              className={cn("size-4", getDiffCollapseIconClassName(fileDiff))}
                            />
                          )}
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          {collapsed ? "Expand diff" : "Collapse diff"}
                        </TooltipPopup>
                      </Tooltip>
                    );
                  }}
                  options={{
                    diffStyle: diffRenderMode === "split" ? "split" : "unified",
                    lineDiffType: "none",
                    overflow: wordWrap ? "wrap" : "scroll",
                    theme: resolveDiffThemeName(resolvedTheme),
                    themeType: resolvedTheme as DiffThemeType,
                    stickyHeaders: true,
                    ...(loadDiffFiles ? { loadDiffFiles } : {}),
                  }}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                  <pre
                    className={cn(
                      "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-2xs leading-relaxed text-muted-foreground/90",
                      wordWrap
                        ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                        : "overflow-auto",
                    )}
                  >
                    {renderablePatch.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}
