/**
 * One step of the Mate's work, one line — the same in the live panel's
 * stream, under its face while it runs, and in an opened log: its mark on the
 * text edge the Mate's words stand on, the step in words, the command it ran
 * after them in mono, and how long it took. Opened in the log, the whole
 * command and what it printed.
 *
 * One type size for every row of the card (13 px words, 12 px code and
 * figures) and one mark per kind: muted once done, the busy blue stepping
 * while it runs, the failed ✕ in red.
 */
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  BrainIcon,
  ChevronRightIcon,
  EyeIcon,
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { KindGlyph } from "../zerops/ZeropsOperationCard";
import { formatWorkDuration, operationLineWords } from "./conversation.logic";
import { ElapsedSince } from "./ConversationRows";
import type { StepKind, WorkStep } from "./workSteps.logic";

const KIND_MARK: Record<StepKind, LucideIcon> = {
  command: TerminalIcon,
  look: EyeIcon,
  read: FileTextIcon,
  edit: FilePenLineIcon,
  search: SearchIcon,
  web: GlobeIcon,
  tool: WrenchIcon,
};

/** Kinds whose time says something: a read or an edit is over before it can be read. */
const TIMED: ReadonlySet<StepKind> = new Set(["command", "web", "tool"]);

/** A step's line: where it stands, the mark column on the text edge. */
export const STEP_LINE_CLASS = "flex min-h-6 w-full min-w-0 items-center gap-2 ps-3.5 text-line";

function Mark({
  icon: Icon,
  state,
}: {
  readonly icon: LucideIcon | null;
  readonly state: WorkStep["state"];
}) {
  if (state === "failed") {
    return <XIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-failed" />;
  }
  if (Icon === null) return null;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        state === "running"
          ? "animate-status-pulse text-status-busy motion-reduce:animate-none"
          : "text-muted-foreground/70",
      )}
    />
  );
}

function stepTime(step: WorkStep): ReactNode {
  if (step.state === "running") return <ElapsedSince since={step.startedAt} />;
  if (!TIMED.has(step.kind) || step.endedAt === null) return null;
  const ms = Date.parse(step.endedAt) - Date.parse(step.startedAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}

/** What a step's line cannot show of it: a script's length, how many edits it folds. */
function stepSuffix(step: WorkStep): string | null {
  if (step.kind === "command" && step.codeLines > 1) return `${step.codeLines} lines`;
  if (step.kind === "edit" && step.entries.length > 1) return `${step.entries.length} edits`;
  return null;
}

/** The words, the code after them, the time at the line's end. */
function LineBody({
  mark,
  words,
  code,
  suffix = null,
  state,
  time,
  chevron,
}: {
  readonly mark: ReactNode;
  readonly words: string | null;
  readonly code: string | null;
  /** What the line cannot show of it: a script's lines, a run of edits' count. */
  readonly suffix?: string | null;
  readonly state: WorkStep["state"];
  readonly time: ReactNode;
  /** An opened log's line: its chevron, shown on hover or open. */
  readonly chevron?: boolean | "open" | undefined;
}) {
  const ink =
    state === "failed"
      ? "text-status-failed-text"
      : state === "running"
        ? "text-foreground"
        : "text-foreground/80";
  return (
    <>
      {mark}
      {words !== null ? <span className={cn("min-w-0 truncate", ink)}>{words}</span> : null}
      {code !== null ? (
        <code
          className={cn(
            "min-w-0 flex-1 basis-0 truncate font-mono text-xs",
            words === null ? ink : "text-muted-foreground/80",
          )}
        >
          {code}
        </code>
      ) : (
        <span className="flex-1" />
      )}
      {suffix !== null ? (
        <span className="shrink-0 text-muted-foreground/80 text-xs tabular-nums">{suffix}</span>
      ) : null}
      {time !== null ? (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{time}</span>
      ) : null}
      {chevron !== undefined ? (
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition duration-150",
            chevron === "open" ? "rotate-90 opacity-70" : "opacity-0 group-hover/step:opacity-70",
          )}
        />
      ) : null}
    </>
  );
}

/** A step as a line: in the stream, under the face while it runs, in a log. */
export function WorkStepLine({
  step,
  className,
}: {
  readonly step: WorkStep;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(STEP_LINE_CLASS, className)}
      data-step={step.kind}
      data-step-state={step.state}
    >
      <LineBody
        code={step.code}
        suffix={stepSuffix(step)}
        mark={<Mark icon={KIND_MARK[step.kind]} state={step.state} />}
        state={step.state}
        time={stepTime(step)}
        words={step.words}
      />
    </div>
  );
}

/** What a platform operation did, as a step: its mark, its word and subject, its time. */
function operationState(operation: ZeropsOperation): WorkStep["state"] {
  return operation.phase === "running"
    ? "running"
    : operation.phase === "failed"
      ? "failed"
      : "done";
}

function operationTime(operation: ZeropsOperation): ReactNode {
  if (operation.phase === "running") return <ElapsedSince since={operation.anchorAt} />;
  if (operation.settledAt === undefined) return null;
  const ms = Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  return Number.isFinite(ms) && ms >= 1000 ? formatWorkDuration(ms) : null;
}

export function OperationStepLine({
  operation,
  words,
  className,
  chevron,
}: {
  readonly operation: ZeropsOperation;
  /** Its words, when the caller says them otherwise than "Deployed appdev". */
  readonly words?: string;
  readonly className?: string;
  readonly chevron?: boolean | "open" | undefined;
}) {
  const state = operationState(operation);
  return (
    <div
      className={cn(STEP_LINE_CLASS, className)}
      data-step="operation"
      data-step-operation={operation.kind}
      data-step-state={state}
    >
      <LineBody
        chevron={chevron}
        code={null}
        mark={
          state === "failed" ? (
            <Mark icon={null} state="failed" />
          ) : (
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center",
                state === "running" && "animate-status-pulse motion-reduce:animate-none",
              )}
            >
              <KindGlyph kind={operation.kind} />
            </span>
          )
        }
        state={state}
        time={operationTime(operation)}
        words={words ?? operationLineWords(operation)}
      />
    </div>
  );
}

/** A line of an opened log that opens what it stands for. */
export function LogStepButton({
  step,
  expanded,
  onToggle,
}: {
  readonly step: WorkStep;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      className={cn(
        STEP_LINE_CLASS,
        "group/step cursor-pointer rounded-md text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      )}
      data-scroll-anchor-ignore
      data-step={step.kind}
      data-step-state={step.state}
      onClick={onToggle}
      type="button"
    >
      <LineBody
        chevron={expanded ? "open" : true}
        code={step.code}
        suffix={stepSuffix(step)}
        mark={<Mark icon={KIND_MARK[step.kind]} state={step.state} />}
        state={step.state}
        time={stepTime(step)}
        words={step.words}
      />
    </button>
  );
}

/** A stretch of thinking in an opened log: one line that opens its paragraphs. */
export function ThoughtLine({
  durationMs,
  live,
  since,
  expanded,
  onToggle,
}: {
  readonly durationMs: number | null;
  readonly live: boolean;
  readonly since: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      className={cn(
        STEP_LINE_CLASS,
        "group/step cursor-pointer rounded-md text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      )}
      data-log-thought-line
      data-scroll-anchor-ignore
      onClick={onToggle}
      type="button"
    >
      <LineBody
        chevron={expanded ? "open" : true}
        code={null}
        mark={<Mark icon={BrainIcon} state={live ? "running" : "done"} />}
        state="done"
        time={live ? <ElapsedSince since={since} /> : null}
        words={
          live
            ? "Thinking"
            : durationMs === null || durationMs < 1000
              ? "Thought"
              : `Thought for ${formatWorkDuration(durationMs)}`
        }
      />
    </button>
  );
}

const DETAIL_BLOCK =
  "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/85 select-text";

/** The runtime's `Name: {json}` detail of a call: its arguments, never output to show. */
const CALL_ARGUMENTS = /^[A-Za-z][\w-]*:\s*[{[]/;

/**
 * What an opened step holds: the whole command and what it printed, the
 * files it touched, the pictures it looked at, what a tool was asked.
 */
export function StepDetail({ step }: { readonly step: WorkStep }) {
  const blocks: Array<{ readonly key: string; readonly label: string; readonly text: string }> = [];
  step.entries.forEach((entry, index) => {
    const command = (entry.rawCommand ?? entry.command)?.trim();
    if (command) blocks.push({ key: `${index}:command`, label: "Command", text: command });
    const files = [
      ...new Set([
        ...(entry.changedFiles ?? []),
        ...(step.kind === "look"
          ? []
          : entry.callInput?.filePath
            ? [entry.callInput.filePath]
            : []),
      ]),
    ];
    if (files.length > 0)
      blocks.push({ key: `${index}:files`, label: "Files", text: files.join("\n") });
    const asked = [
      entry.callInput?.pattern ? `pattern  ${entry.callInput.pattern}` : null,
      entry.callInput?.glob ? `glob     ${entry.callInput.glob}` : null,
      entry.callInput?.path ? `in       ${entry.callInput.path}` : null,
      entry.callInput?.url ? `address  ${entry.callInput.url}` : null,
      entry.callInput?.query ? `query    ${entry.callInput.query}` : null,
    ].filter((line): line is string => line !== null);
    if (asked.length > 0)
      blocks.push({ key: `${index}:asked`, label: "Asked", text: asked.join("\n") });
    const detail = entry.detail?.trim();
    if (
      detail &&
      detail !== command &&
      !CALL_ARGUMENTS.test(detail) &&
      !(step.kind === "look" && step.images.includes(detail))
    ) {
      blocks.push({ key: `${index}:output`, label: "Printed", text: detail });
    }
  });
  if (step.images.length > 0) {
    blocks.push({ key: "images", label: "Pictures", text: step.images.join("\n") });
  }
  if (blocks.length === 0) return null;
  return (
    <div className="grid gap-1.5 ps-9 pe-1 pt-0.5 pb-2" data-step-detail>
      {blocks.map((block) => (
        <pre key={block.key} aria-label={block.label} className={DETAIL_BLOCK}>
          {block.text}
        </pre>
      ))}
    </div>
  );
}
