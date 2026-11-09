/**
 * The Code page as it draws, given what it reads: where the Mate's work is (`top`: its project and
 * each repository's change), then "What changed" — its toolbar, the change's commits, and the
 * files, each folded to its name and counts until opened in place to its lines.
 *
 * One scroller for all of it: the files are the code view's own list, so a long diff stays
 * virtualized, and everything above them is the list's header, scrolling with it. A state with no
 * files (reading, nothing outside main, a failed read) draws in the header too, so the page never
 * swaps its scroller and nothing above "What changed" is drawn twice.
 */
import type { FileDiffMetadata } from "@pierre/diffs";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  ArrowRightIcon,
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
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import type { DraftId } from "../composerDraftStore";
import type { DiffRenderMode } from "../diffPanelStore";
import { getDiffCollapseIconClassName, resolveFileDiffPath } from "../lib/diffRendering";
import { cn } from "~/lib/utils";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { diffChoiceCount, type DiffChoice } from "./DiffPanel.logic";
import { AnnotatableCodeView } from "./diffs/AnnotatableCodeView";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { MatePanelColumn } from "./zerops/MatePanelPlaces";
import { SectionLabel } from "./zerops/system";

/** One file of "What changed", folded unless opened. */
export interface CodeFile {
  readonly fileDiff: FileDiffMetadata;
  readonly fileKey: string;
  readonly filePath: string;
  readonly collapsed: boolean;
  /** Its changes are not committed, in a list that has committed ones beside it. */
  readonly notCommitted: boolean;
}

export const choiceValue = (choice: DiffChoice) => `${choice.repository.name}:${choice.scope}`;

/** What a choice is called in the picker: with its repository's name where there are several. */
export function choiceLabel(choice: DiffChoice | null, choices: ReadonlyArray<DiffChoice>) {
  if (choice === null) return "What changed";
  const many = new Set(choices.map((entry) => entry.repository.name)).size > 1;
  return many ? `${choice.repository.label} · ${choice.label}` : choice.label;
}

/**
 * What changed's own toolbar: what it shows (a repository's changes not committed, or everything
 * not on main), what the branch is compared with, the counts, and the views of the lines.
 */
export function CodeChangesToolbar({
  choices,
  shown,
  onChoose,
  compare,
  stat,
  refresh,
  collapse,
  view,
}: {
  readonly choices: ReadonlyArray<DiffChoice>;
  readonly shown: DiffChoice | null;
  readonly onChoose: (value: string) => void;
  /** The branch and the base it is compared with (`CodeCompare`); none outside the branch. */
  readonly compare: ReactNode;
  readonly stat: { readonly additions: number; readonly deletions: number } | null;
  readonly refresh: { readonly pending: boolean; readonly onRefresh: () => void } | null;
  readonly collapse: { readonly allCollapsed: boolean; readonly onToggle: () => void } | null;
  readonly view: {
    readonly mode: DiffRenderMode;
    readonly onMode: (mode: DiffRenderMode) => void;
    readonly wrap: boolean;
    readonly onWrap: (wrap: boolean) => void;
    readonly ignoreWhitespace: boolean;
    readonly onIgnoreWhitespace: (ignore: boolean) => void;
  };
}) {
  const label = choiceLabel(shown, choices);
  const many = new Set(choices.map((choice) => choice.repository.name)).size > 1;
  const repositories = [
    ...new Map(choices.map(({ repository }) => [repository.name, repository])).values(),
  ];
  if (choices.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" data-code-toolbar="">
      {/* What it shows takes a row of its own where the views would squeeze the branch away. */}
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="sm" variant="secondary" />}
            className="max-w-full"
            aria-label={`What changed shows: ${label}`}
          >
            <span className="truncate">{label}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={shown === null ? "" : choiceValue(shown)}
              onValueChange={onChoose}
            >
              {repositories.map(({ name, label: repositoryLabel }) => (
                <DropdownMenuGroup key={name}>
                  {many ? <DropdownMenuLabel>{repositoryLabel}</DropdownMenuLabel> : null}
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
        {compare}
      </div>
      {/* Views of a diff, while there is one to show. */}
      {shown === null ? null : (
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {stat === null ? null : (
            <DiffStatLabel
              additions={stat.additions}
              deletions={stat.deletions}
              className="mr-1 text-2xs"
              layout="inline"
            />
          )}
          {refresh === null ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={refresh.pending ? "Refreshing diff" : "Refresh diff"}
                    onClick={refresh.onRefresh}
                  />
                }
              >
                {refresh.pending ? <Spinner size="sm" /> : <RefreshCwIcon className="size-3.5" />}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {refresh.pending ? "Refreshing diff…" : "Refresh diff"}
              </TooltipPopup>
            </Tooltip>
          )}
          {collapse === null ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={collapse.allCollapsed ? "Expand all files" : "Collapse all files"}
                    onClick={collapse.onToggle}
                  />
                }
              >
                {collapse.allCollapsed ? (
                  <ChevronsUpDownIcon className="size-3.5" />
                ) : (
                  <ChevronsDownUpIcon className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {collapse.allCollapsed ? "Expand all files" : "Collapse all files"}
              </TooltipPopup>
            </Tooltip>
          )}
          <ToggleGroup
            aria-label="Diff layout"
            className="shrink-0"
            variant="segmented"
            value={[view.mode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") view.onMode(next);
            }}
          >
            <Toggle aria-label="Unified diff view" value="stacked">
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
                  aria-label={
                    view.wrap ? "Disable diff line wrapping" : "Enable diff line wrapping"
                  }
                  variant="ghost"
                  size="sm"
                  pressed={view.wrap}
                  onPressedChange={(pressed) => view.onWrap(Boolean(pressed))}
                />
              }
            >
              <TextWrapIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {view.wrap ? "Disable line wrapping" : "Enable line wrapping"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={
                    view.ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                  }
                  variant="ghost"
                  size="sm"
                  pressed={view.ignoreWhitespace}
                  onPressedChange={(pressed) => view.onIgnoreWhitespace(Boolean(pressed))}
                />
              }
            >
              <PilcrowIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {view.ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
            </TooltipPopup>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/** The branch and what it is compared with: `branch → <picker>`, the picker the base's own. */
export function CodeCompare({
  head,
  base,
  children,
}: {
  readonly head: string;
  readonly base: string;
  /** The base's picker. */
  readonly children: ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
      aria-label={`Comparing ${head} against ${base}`}
    >
      <Tooltip>
        <TooltipTrigger render={<span className="flex min-w-0 items-center gap-2" />}>
          <span className="min-w-0 max-w-48 truncate">{head}</span>
          <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
        </TooltipTrigger>
        <TooltipPopup side="top">{`${head} → ${base}`}</TooltipPopup>
      </Tooltip>
      {children}
    </div>
  );
}

/** A state of "What changed" with no files: a dashed slot saying what is (not) there. */
export function CodeChangesEmpty({
  title,
  line,
  action,
  alert = false,
}: {
  readonly title: string;
  readonly line?: string | null | undefined;
  readonly action?: ReactNode;
  readonly alert?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-start gap-0.5 rounded-xl border border-dashed border-border px-4 py-3.5 text-body"
      role={alert ? "alert" : undefined}
    >
      <p className="text-foreground">{title}</p>
      {line === undefined || line === null ? null : (
        <p className={alert ? "text-error/80" : "text-muted-foreground"}>{line}</p>
      )}
      {action}
    </div>
  );
}

export function CodePage({
  top,
  toolbar,
  notices,
  commits,
  state,
  files,
  options,
  viewKey,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  onToggleFile,
  onOpenFile,
  changesAsked,
  onChangesShown,
  className,
}: {
  /** Where the work is: the project and each repository's change. */
  readonly top: ReactNode;
  readonly toolbar: ReactNode;
  /** What the diff could not be: cut at the preview limit, a read again that failed. */
  readonly notices: ReactNode;
  /** The change's commits ("Commits · N"), where it has some. */
  readonly commits: ReactNode;
  /** What the section says where it has no files to show; `null` with files. */
  readonly state: ReactNode;
  readonly files: ReadonlyArray<CodeFile>;
  readonly options: ComponentProps<typeof AnnotatableCodeView>["options"];
  /** The code view's identity: a new one mounts afresh (another diff, every file folded). */
  readonly viewKey: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly onToggleFile: (fileKey: string) => void;
  /** A file's name opens the file itself. */
  readonly onOpenFile?: ((filePath: string) => void) | undefined;
  /** The page was asked to open at "What changed" (the D key): it scrolls there, once. */
  readonly changesAsked: boolean;
  readonly onChangesShown: () => void;
  readonly className?: string | undefined;
}) {
  const [changes, setChanges] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!changesAsked || changes === null) return;
    // A frame later: the header has its height, and the scroller its room.
    const frame = requestAnimationFrame(() => {
      changes.scrollIntoView({ block: "start" });
      onChangesShown();
    });
    return () => cancelAnimationFrame(frame);
  }, [changes, changesAsked, onChangesShown]);
  const filesByPath = new Map(files.map((file) => [file.filePath, file]));
  const marked = new Set(files.filter((file) => file.notCommitted).map((file) => file.fileKey));

  return (
    <div
      className={cn("min-h-0 min-w-0 flex-1", className)}
      data-zerops-surface="code-page"
      onClickCapture={(event) => {
        const composedPath = event.nativeEvent.composedPath?.() ?? [];
        for (const node of composedPath) {
          if (!(node instanceof HTMLElement)) continue;
          // Header controls keep their own actions. In particular, the chevron must not also
          // trigger the row handler or the two toggles cancel each other.
          if (node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement) return;
        }
        const title = composedPath.find(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.hasAttribute("data-title"),
        );
        const filePath = title?.textContent?.trim();
        // The file's name opens the file; the rest of its row folds or opens its lines.
        if (filePath && onOpenFile !== undefined) {
          onOpenFile(filePath);
          return;
        }
        const header = composedPath.find(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
        );
        const headerFilePath =
          filePath ?? header?.querySelector("[data-title]")?.textContent?.trim();
        if (!headerFilePath) return;
        const file = filesByPath.get(headerFilePath);
        if (file) onToggleFile(file.fileKey);
      }}
    >
      <AnnotatableCodeView
        key={viewKey}
        codeViewKey={viewKey}
        className="h-full min-h-0 overflow-auto"
        files={files}
        sectionId={sectionId}
        sectionTitle={sectionTitle}
        composerDraftTarget={composerDraftTarget}
        renderCodeViewHeader={() => (
          <div className="pb-2.5">
            {/* The Zerops page's own column: the project's card stands where it does there. */}
            <MatePanelColumn>
              {top}
              <section
                className="flex min-w-0 scroll-mt-0 flex-col gap-2.5"
                data-code-section="changes"
                ref={setChanges}
              >
                <SectionLabel>What changed</SectionLabel>
                {toolbar}
                {notices}
                {commits}
                {state}
              </section>
            </MatePanelColumn>
          </div>
        )}
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
                      onToggleFile(fileKey);
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
              <TooltipPopup side="top">{collapsed ? "Expand diff" : "Collapse diff"}</TooltipPopup>
            </Tooltip>
          );
        }}
        renderHeaderMetadata={(fileKey) =>
          marked.has(fileKey) ? (
            <span className="font-sans text-2xs text-muted-foreground">not committed</span>
          ) : null
        }
        options={options}
      />
    </div>
  );
}
