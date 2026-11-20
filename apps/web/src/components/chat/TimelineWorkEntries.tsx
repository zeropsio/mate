import { AssetImage, ImageUnavailable } from "~/assets/AssetImage";
import { memo, use, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  workEntryDisplayIndicatesToolFailure,
  workEntrySignalsSevereFailure,
  workLogEntryIsToolLike,
} from "../../session-logic";
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  MessageCircleIcon,
  SearchIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { AssetDownloadLink } from "~/assets/AssetDownloadLink";
import { useAssetUrlStates } from "../../assets/assetUrls";
import {
  normalizeCompactToolLabel,
  capitalizePhrase,
  toolGroupAction,
  workEntryIsVisibleInGroup,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { TimelineRowCtx } from "./timelineContext";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";

type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];

/**
 * Hover-revealed wall-clock time with a full-date tooltip — the same metadata
 * presentation as message rows, for work entries and turn folds. The parent
 * carries `group/timeline-row`; hover or focus on an existing control reveals
 * the time without adding a tab stop. Hidden timestamps stay outside the row
 * layout. Visibility changes immediately so leaving flow cannot overlap text
 * during a fade-out. Place it before any trailing disclosure control so
 * revealing the time does not move the chevron.
 */
function TimelineRowTimestamp({
  createdAt,
  timestampFormat,
  className,
}: {
  createdAt: string;
  timestampFormat: TimestampFormat;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "pointer-events-none absolute me-1 shrink-0 whitespace-nowrap rounded-md text-muted-foreground text-xs tabular-nums opacity-0 group-hover/timeline-row:pointer-events-auto group-hover/timeline-row:static group-hover/timeline-row:opacity-100 group-focus-within/timeline-row:pointer-events-auto group-focus-within/timeline-row:static group-focus-within/timeline-row:opacity-100",
              className,
            )}
          />
        }
      >
        {formatDayAwareTimestamp(createdAt, timestampFormat)}
      </TooltipTrigger>
      <TooltipPopup>{formatChatTimestampTooltip(createdAt, timestampFormat)}</TooltipPopup>
    </Tooltip>
  );
}

/** Renders one or more already-derived work log rows. Overflow expansion is modeled as LegendList data. */
export const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
  isExpandedToolGroupEntry,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
  isExpandedToolGroupEntry: boolean;
}) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const nonEmptyEntries = useMemo(
    () =>
      groupedEntries.filter((entry) => workEntryIsVisibleInGroup(entry, isExpandedToolGroupEntry)),
    [groupedEntries, isExpandedToolGroupEntry],
  );
  const onlyToolEntries = nonEmptyEntries.every((entry) => workLogEntryIsToolLike(entry));
  // Named for assistive technology only: a visible "Work Log" heading over
  // every run of entries was the system describing itself to the person.
  const groupLabel = onlyToolEntries
    ? nonEmptyEntries.length === 1
      ? "1 tool call"
      : `${nonEmptyEntries.length} tool calls`
    : "What the Mate did";
  const GroupContainer = isExpandedToolGroupEntry ? "div" : "section";

  if (nonEmptyEntries.length === 0) return null;

  return (
    <GroupContainer
      className={cn("-mx-1 px-1", isExpandedToolGroupEntry ? "py-0" : "space-y-0.5 py-0.5")}
      aria-label={isExpandedToolGroupEntry ? undefined : groupLabel}
    >
      <div className="space-y-px">
        {nonEmptyEntries.map((workEntry) => (
          <PlainWorkEntryRow
            key={workEntry.id}
            workEntry={workEntry}
            workspaceRoot={workspaceRoot}
            isExpandedToolGroupEntry={isExpandedToolGroupEntry}
          />
        ))}
      </div>
    </GroupContainer>
  );
});

type WorkEntryIconName =
  | "bot"
  | "brain"
  | "check"
  | "circle-alert"
  | "eye"
  | "globe"
  | "hammer"
  | "message-circle"
  | "search"
  | "square-pen"
  | "terminal"
  | "wrench"
  | "x"
  | "zap";

function WorkEntryIconSvg({ name, className }: { name: WorkEntryIconName; className: string }) {
  switch (name) {
    case "bot":
      return <BotIcon className={className} aria-hidden />;
    case "brain":
      return <BrainIcon className={className} aria-hidden />;
    case "check":
      return <CheckIcon className={className} aria-hidden />;
    case "circle-alert":
      return <CircleAlertIcon className={className} aria-hidden />;
    case "eye":
      return <EyeIcon className={className} aria-hidden />;
    case "globe":
      return <GlobeIcon className={className} aria-hidden />;
    case "hammer":
      return <HammerIcon className={className} aria-hidden />;
    case "message-circle":
      return <MessageCircleIcon className={className} aria-hidden />;
    case "search":
      return <SearchIcon className={className} aria-hidden />;
    case "square-pen":
      return <SquarePenIcon className={className} aria-hidden />;
    case "terminal":
      return <TerminalIcon className={className} aria-hidden />;
    case "wrench":
      return <WrenchIcon className={className} aria-hidden />;
    case "x":
      return <XIcon className={className} aria-hidden />;
    case "zap":
      return <ZapIcon className={className} aria-hidden />;
  }
}

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  iconName: WorkEntryIconName;
  className: string;
} {
  if (tone === "error") {
    return {
      iconName: "circle-alert",
      className: "text-foreground",
    };
  }
  if (tone === "thinking") {
    return {
      iconName: "bot",
      className: "text-icon-muted",
    };
  }
  if (tone === "info") {
    return {
      iconName: "check",
      className: "text-icon-muted",
    };
  }
  return {
    iconName: "zap",
    className: "text-foreground",
  };
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles" | "itemType">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  // A tool call's result is not its name. `detail` carries the raw payload an
  // MCP tool answered with, which belongs in the body the row opens — as the
  // label it is a truncated line of machine text, and the body then dedupes
  // against it and leaves the row with nothing to open.
  if (workEntry.detail && workEntry.itemType !== "mcp_tool_call") return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

/**
 * The expanded body never repeats the row's visible label. A failed row keeps
 * its label in the body so the full, untruncated error stays reachable.
 */
function buildToolCallExpandedBody(
  workEntry: TimelineWorkEntry,
  workspaceRoot: string | undefined,
  visibleLabel: string,
  failed: boolean,
): string | null {
  const blocks: string[] = [];
  const seen = new Set<string>(failed ? [] : [visibleLabel.trim()]);
  const addBlock = (value: string | null | undefined) => {
    const text = value?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    blocks.push(text);
  };
  if (workEntry.itemType === "mcp_tool_call" && workEntry.toolData !== undefined) {
    addBlock(`MCP call\n${JSON.stringify(workEntry.toolData, null, 2)}`);
  }
  const raw = workEntryRawCommand(workEntry);
  addBlock(raw?.trim() ? raw : workEntry.command);
  addBlock(workEntry.detail);
  const changedFiles = workEntry.changedFiles ?? [];
  if (changedFiles.length > 0) {
    addBlock(
      changedFiles
        .map((filePath) => formatWorkspaceRelativePath(filePath, workspaceRoot))
        .join("\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

const toolCallExpandedBodyClassName =
  "max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-(length:--font-size-code,var(--text-2xs)) leading-relaxed select-text";

const TOOL_ACTION_ICON: Record<
  Exclude<ReturnType<typeof toolGroupAction>, "other">,
  WorkEntryIconName
> = {
  read: "eye",
  edit: "square-pen",
  command: "terminal",
  search: "globe",
  "code-search": "search",
};

function workEntryIconName(workEntry: TimelineWorkEntry): WorkEntryIconName {
  if (
    workEntry.sourceActivityKind === "user-input.requested" ||
    workEntry.sourceActivityKind === "user-input.resolved"
  ) {
    return "message-circle";
  }
  const action = toolGroupAction(workEntry);
  if (action !== "other") return TOOL_ACTION_ICON[action];

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return "wrench";
    case "dynamic_tool_call":
      return "hammer";
    case "collab_agent_tool_call":
      return "bot";
  }

  // Subagent lifecycle rows (grouped by taskId) get agent identity chrome.
  if (workEntry.taskId) {
    return "bot";
  }

  return workToneIcon(workEntry.tone).iconName;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

const stopRowToggle = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * Click handler for expanded row labels, which turn text selection back on.
 * Only a click that ends a real selection is withheld from the row toggle, so
 * an ordinary click on the label still bubbles and collapses the row it opened.
 */
const stopRowToggleWhileSelectingText = (e: MouseEvent<HTMLElement>) => {
  const selection = e.currentTarget.ownerDocument.getSelection();
  if (selection && !selection.isCollapsed) {
    e.stopPropagation();
  }
};

const PlainWorkEntryRow = memo(function PlainWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  isExpandedToolGroupEntry: boolean;
}) {
  const { workEntry, workspaceRoot, isExpandedToolGroupEntry } = props;
  const { timestampFormat } = use(TimelineRowCtx);
  const [expanded, setExpanded] = useState(false);
  const iconConfig = workToneIcon(workEntry.tone);
  const showWarningIndicator = workEntry.sourceActivityKind === "runtime.warning";
  const showFailedIndicator = workEntryDisplayIndicatesToolFailure(workEntry);
  const entryIconName =
    showWarningIndicator || showFailedIndicator ? "x" : workEntryIconName(workEntry);
  const previewText = workEntryPreview(workEntry, workspaceRoot) ?? toolWorkEntryHeading(workEntry);
  // An expanded command row is labelled "Command" and shows the command in its
  // body, so the body dedupes against that label rather than the preview.
  const expandedLabel = workEntry.command?.trim() ? "Command" : previewText;
  const displayText = expanded ? expandedLabel : previewText;
  const expandedBody = buildToolCallExpandedBody(
    workEntry,
    workspaceRoot,
    expandedLabel,
    showFailedIndicator,
  );
  // A command that is the visible label still expands: the expanded row wraps
  // the label in full instead of repeating it in the body.
  const canExpand =
    expandedBody !== null ||
    Boolean(workEntryRawCommand(workEntry)?.trim() || workEntry.command?.trim());
  const showDestructiveRowStyle =
    showFailedIndicator &&
    (workEntrySignalsSevereFailure(workEntry) || !workLogEntryIsToolLike(workEntry));
  // Ordinary tool failures stay muted; only runtime errors and warnings get
  // color. The red treatment is reserved for severe failures.
  const iconWrapperClass = cn(
    "flex w-5 shrink-0 items-center",
    showWarningIndicator
      ? "text-warning"
      : showDestructiveRowStyle
        ? "text-destructive"
        : workEntry.tone === "tool" || showFailedIndicator
          ? "text-icon-muted"
          : iconConfig.className,
  );
  const headingClass = showWarningIndicator
    ? "font-medium text-warning"
    : showDestructiveRowStyle
      ? "font-medium text-destructive"
      : workLogEntryIsToolLike(workEntry)
        ? "text-muted-foreground"
        : "text-foreground/80";
  const showEntryIcon = !isExpandedToolGroupEntry || showWarningIndicator || showFailedIndicator;
  const accessibleDisplayText = showFailedIndicator
    ? `${previewText}, tool call failed`
    : previewText;
  const rowToggleProps = canExpand
    ? {
        role: "button" as const,
        tabIndex: 0 as const,
        "aria-label": accessibleDisplayText,
        "aria-expanded": expanded,
        onClick: () => setExpanded((v) => !v),
        // Only the row itself: Enter or Space on an action inside the expanded row is that action's.
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        },
      }
    : {};

  return (
    <div
      className={cn(
        "group/timeline-row relative flex flex-col rounded-md transition-colors",
        isExpandedToolGroupEntry ? "py-0" : "py-px",
        expanded && "mb-1",
        canExpand &&
          "cursor-pointer hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
      )}
      {...rowToggleProps}
    >
      {/* Its icon in the page's 20 px mark column, its words on the edge the
          answer's list items and the other event lines start on. */}
      <div className="flex select-none items-center transition-[opacity,translate] duration-200">
        <span
          className={cn(iconWrapperClass, !showEntryIcon && "invisible")}
          role={showFailedIndicator ? "img" : undefined}
          aria-label={showFailedIndicator ? "Tool call failed" : undefined}
          aria-hidden={!showEntryIcon}
        >
          <WorkEntryIconSvg
            name={entryIconName}
            className="block size-3.5 shrink-0 stroke-[1.8] opacity-70"
          />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="flex min-w-0 w-full items-baseline gap-1.5 text-line">
              <span
                className={cn(
                  "min-w-0 flex-1",
                  expanded ? "whitespace-pre-wrap break-words select-text" : "truncate",
                  headingClass,
                )}
                onClick={expanded ? stopRowToggleWhileSelectingText : undefined}
              >
                {displayText}
              </span>
            </p>
          </div>
          <TimelineRowTimestamp createdAt={workEntry.createdAt} timestampFormat={timestampFormat} />
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              !canExpand && "invisible",
            )}
            aria-hidden
          >
            <ChevronRightIcon
              className={cn(
                "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </span>
        </div>
      </div>
      {expanded && canExpand && expandedBody ? (
        <div
          className="mt-1 ms-5 cursor-default border-s border-border/45 ps-3 pt-0.5"
          onClick={stopRowToggle}
          onPointerDown={stopRowToggle}
        >
          <pre className={toolCallExpandedBodyClassName}>{expandedBody}</pre>
        </div>
      ) : null}
      {workEntry.questionAnswer ? (
        <QuestionAnswerHistory answer={workEntry.questionAnswer} />
      ) : null}
    </div>
  );
});

/** A submitted question answer: each answered question, its text answer, and the files attached. */
function QuestionAnswerHistory({
  answer,
}: {
  answer: import("@t3tools/contracts").UserInputAttachmentAnswerPayload;
}) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const attachments = useMemo(() => Object.values(answer.attachmentsByQuestionId).flat(), [answer]);
  const resources = useMemo(
    () =>
      attachments.map((attachment) => ({
        _tag: "attachment" as const,
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
        ...(attachment.type === "image" && "asset" in attachment && attachment.asset
          ? { occurrenceId: attachment.asset.id }
          : {}),
      })),
    [attachments],
  );
  const states = useAssetUrlStates(activeThreadEnvironmentId, resources);
  return (
    <div className="ms-7 mt-2 space-y-2" onClick={stopRowToggle}>
      {[
        ...new Set([
          ...Object.keys(answer.answers),
          ...Object.keys(answer.attachmentsByQuestionId),
        ]),
      ].map((questionId) => (
        <div key={questionId} className="space-y-1">
          {answer.questionTextById?.[questionId] ? (
            <p className="text-sm text-muted-foreground">{answer.questionTextById[questionId]}</p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm">
            {[answer.answers[questionId]]
              .flat()
              .filter((value): value is string => typeof value === "string")
              .join(", ")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(answer.attachmentsByQuestionId[questionId] ?? []).map((attachment) => {
              const state = states[attachments.indexOf(attachment)];
              const url = state?._tag === "Success" ? state.url : undefined;
              return (
                <AssetDownloadLink
                  key={attachment.id}
                  source={url ?? ""}
                  download={attachment.type === "file" ? attachment.name : undefined}
                  className="text-sm underline"
                  target={attachment.type === "image" ? "_blank" : undefined}
                  rel="noopener noreferrer"
                >
                  {attachment.type === "image" && state?._tag === "Failure" ? (
                    <ImageUnavailable reason={state.reason} />
                  ) : attachment.type === "image" && url ? (
                    <AssetImage
                      loading="lazy"
                      decoding="async"
                      src={url}
                      alt={attachment.name}
                      className="h-20 w-32 rounded object-contain"
                    />
                  ) : (
                    attachment.name
                  )}
                </AssetDownloadLink>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
