/**
 * The Mate at work: the one component that shows what is happening now, at
 * the live stretch's tail, right under its line. Its face and its latest words
 * in full; a pill for each thing running — a deploy stepping through its
 * pipeline in the Zerops GUI's words, the helpers, the task list, a service in
 * trouble — each opening its detail in place; and the browser while it checks.
 * Nothing that runs pops out anywhere else: settling folds all of it into the
 * line, the words the person answered and the outcome.
 *
 * It is the conversation's bottom, so it may change shape; it only ever grows
 * while live, so a finished pill or a shorter note never pulls the
 * conversation down.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { PipelineSpokenState } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  BotIcon,
  CheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListTodoIcon,
  RocketIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { MateFace } from "../zerops/primitives";
import { ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { formatWorkDuration, type IncidentModel } from "./conversation.logic";
import { Pill, Segments } from "./ConversationPills";
import type { DockModel } from "./conversationDock.logic";
import type { WorkingFailure } from "./MessagesTimeline.logic";
import { ElapsedSince, type ConversationSpeaker } from "./ConversationRows";

const TONE_DOT: Record<ServiceStatusToneId, string> = {
  ok: "bg-status-ok",
  busy: "bg-status-busy",
  attention: "bg-status-attention",
  failed: "bg-status-failed",
  off: "bg-status-off",
};

const STEP_SEGMENT: Record<string, string> = {
  done: "bg-status-ok",
  running: "bg-status-busy",
  failed: "bg-status-failed",
  queued: "bg-muted-foreground/25",
};

const PIPELINE_SEGMENT: Record<PipelineSpokenState, string> = {
  finished: "bg-status-ok",
  running: "bg-status-busy",
  activating: "bg-status-busy",
  failed: "bg-status-failed",
  waiting: "bg-muted-foreground/25",
  cancelled: "bg-muted-foreground/25",
};

const INCIDENT_DOT: Record<IncidentModel["tone"], string> = {
  attention: "bg-status-attention",
  ok: "bg-status-ok",
  failed: "bg-status-failed",
};

/**
 * A deploy's pill: the service, a segment per step, the step running now in
 * the Zerops GUI's own sentence, and how long. Open, the full pipeline with
 * its build log.
 */
function OperationPill({
  operation,
  environmentId,
  open,
  onToggle,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const regions = useOperationCard(operation, environmentId);
  const pipeline = regions.observed?.pipeline;
  const steps = regions.observed?.steps ?? operation.steps;
  const running = operation.phase === "running";
  const pipelineStep =
    pipeline === undefined
      ? undefined
      : (pipeline.steps.find((step) => step.id === pipeline.currentStepId) ??
        pipeline.steps.at(-1));
  const fallbackStep =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "failed") ??
    steps.findLast((step) => step.state === "done");
  const words = !running
    ? operation.statusWord
    : pipeline?.calculating
      ? "Calculating steps"
      : pipelineStep !== undefined
        ? pipelineStep.sentence
        : fallbackStep !== undefined
          ? fallbackStep.label
          : "Starting";
  const settledMs =
    operation.settledAt === undefined
      ? null
      : Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  const segments =
    pipeline !== undefined && pipeline.steps.length > 1
      ? pipeline.steps.map((step) => ({ key: step.id, className: PIPELINE_SEGMENT[step.state] }))
      : steps.length > 1
        ? steps.map((step) => ({
            key: step.id,
            className: STEP_SEGMENT[step.state] ?? STEP_SEGMENT.queued!,
          }))
        : null;
  return (
    <Pill
      label={`${operation.statusWord} ${operation.subject}. ${open ? "Hide" : "Show"} the pipeline`}
      onToggle={onToggle}
      open={open}
    >
      {operation.phase === "failed" ? (
        <XIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-failed" />
      ) : operation.phase === "done" ? (
        <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok" />
      ) : (
        <RocketIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-busy" />
      )}
      <span className="shrink-0 font-medium text-foreground">{operation.subject}</span>
      {running && segments !== null ? <Segments segments={segments} /> : null}
      <span
        className={cn(
          "min-w-0 truncate",
          operation.phase === "failed" ? "text-status-failed-text" : "text-muted-foreground",
        )}
      >
        {words}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {running ? (
          <ElapsedSince since={operation.anchorAt} />
        ) : settledMs !== null && Number.isFinite(settledMs) ? (
          formatWorkDuration(settledMs)
        ) : null}
      </span>
    </Pill>
  );
}

function OperationDetail({
  operation,
  environmentId,
  threadRef,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const regions = useOperationCard(operation, environmentId);
  return <ZeropsOperationCard operation={operation} threadRef={threadRef} {...regions} />;
}

/** A step's key: its words, and how many times the same words came before it. */
function keyedSteps<T extends { readonly step: string }>(steps: ReadonlyArray<T>) {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = seen.get(step.step) ?? 0;
    seen.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

/**
 * The reserved height of the Mate at work: it follows the content up and
 * never back down while live, so a pill finishing or a shorter note leaves
 * room at the very bottom instead of pulling the conversation down.
 */
function useGrowOnlyHeight() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    let tallest = 0;
    const measure = () => {
      const height = content.getBoundingClientRect().height;
      if (height > tallest) {
        tallest = height;
        setMinHeight(height);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return { contentRef, minHeight };
}

export function ConversationWorking({
  speaker,
  noteKey,
  speech,
  incidents,
  failures,
  dock,
  browser,
  environmentId,
  threadRef,
  onOpenAgents,
}: {
  readonly speaker: ConversationSpeaker;
  /** Which note the bubble holds: a new one replays the rise. */
  readonly noteKey: string | null;
  /** The Mate's latest words, rendered; null before it has said anything. */
  readonly speech: ReactNode;
  readonly incidents: ReadonlyArray<IncidentModel>;
  /** What failed on the way, marked where it happened: red, or "came back". */
  readonly failures: ReadonlyArray<WorkingFailure>;
  readonly dock: DockModel | null;
  /** The browser block while the stretch checks pages. */
  readonly browser: ReactNode;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
}) {
  const { contentRef, minHeight } = useGrowOnlyHeight();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));
  const operations = dock?.operations ?? [];
  const helpers = dock?.helpers ?? null;
  const tasks = dock?.tasks ?? null;
  const openOperation = operations.find((operation) => operation.key === open);
  const hasPills =
    operations.length > 0 ||
    helpers !== null ||
    tasks !== null ||
    incidents.length > 0 ||
    failures.length > 0;

  return (
    <div data-conversation-working style={minHeight === undefined ? undefined : { minHeight }}>
      <div ref={contentRef} className="grid gap-2 pb-1">
        {speech !== null && noteKey !== null ? (
          <div className="relative flex min-w-0" data-mate-speech="live">
            <span aria-hidden="true" className="absolute -start-5 top-1 flex w-5 justify-center">
              <MateFace size="sm" state="working" tint={speaker.tint} />
            </span>
            <div
              key={noteKey}
              aria-live="polite"
              className="min-w-0 max-w-full animate-speech-in rounded-2xl rounded-ss-sm bg-muted px-3.5 py-2 text-foreground motion-reduce:animate-none"
            >
              {speech}
            </div>
          </div>
        ) : null}
        {hasPills ? (
          <div className="flex min-w-0 flex-wrap gap-1.5" data-working-pills>
            {operations.map((operation) => (
              <OperationPill
                key={operation.key}
                environmentId={environmentId}
                onToggle={() => toggle(operation.key)}
                open={open === operation.key}
                operation={operation}
              />
            ))}
            {incidents.map((incident) => (
              <Pill
                key={incident.key}
                label={incident.phases.join(", ")}
                tone={
                  incident.tone === "failed"
                    ? "failed"
                    : incident.tone === "attention"
                      ? "attention"
                      : "plain"
                }
              >
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", INCIDENT_DOT[incident.tone])}
                />
                <span className="shrink-0 font-medium text-foreground">{incident.hostname}</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {incident.phases.at(-1)}
                </span>
              </Pill>
            ))}
            {failures.map((failure) => (
              <Pill
                key={failure.key}
                label={`${failure.subject ? `${failure.subject}: ` : ""}${failure.words}${failure.recovered ? ", came back" : ""}`}
                tone={failure.recovered ? "attention" : "failed"}
              >
                {failure.recovered ? (
                  <RotateCcwIcon aria-hidden="true" className="size-3 shrink-0" />
                ) : (
                  <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                {failure.subject ? (
                  <span className="shrink-0 font-medium">{failure.subject}</span>
                ) : null}
                <span className="min-w-0 truncate">
                  {failure.words}
                  {failure.recovered ? " · came back" : ""}
                </span>
              </Pill>
            ))}
            {helpers !== null ? (
              <Pill
                label={`Helpers. ${open === "helpers" ? "Hide" : "Show"} each one`}
                onToggle={() => toggle("helpers")}
                open={open === "helpers"}
              >
                <BotIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-medium text-foreground">
                  {helpers.rows.length === 1 ? "1 helper" : `${helpers.rows.length} helpers`}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {[
                    helpers.working > 0 ? `${helpers.working} working` : null,
                    helpers.done > 0 ? `${helpers.done} done` : null,
                    helpers.failed > 0 ? `${helpers.failed} failed` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Pill>
            ) : null}
            {tasks !== null ? (
              <Pill
                label={`Tasks. ${open === "tasks" ? "Hide" : "Show"} the list`}
                onToggle={() => toggle("tasks")}
                open={open === "tasks"}
              >
                <ListTodoIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="shrink-0 font-medium text-foreground tabular-nums">
                  {tasks.done} of {tasks.steps.length}
                </span>
                {tasks.current ? (
                  <span className="min-w-0 truncate text-muted-foreground">{tasks.current}</span>
                ) : null}
              </Pill>
            ) : null}
          </div>
        ) : null}
        {openOperation !== undefined ? (
          <div className="max-h-96 overflow-auto rounded-xl" data-working-detail="operation">
            <OperationDetail
              environmentId={environmentId}
              operation={openOperation}
              threadRef={threadRef}
            />
          </div>
        ) : null}
        {open === "helpers" && helpers !== null ? (
          <ul className="grid gap-px rounded-xl bg-muted/50 p-1.5" data-working-detail="helpers">
            {helpers.rows.map((helper) => (
              <li
                key={helper.id}
                className="flex min-h-6 min-w-0 items-center gap-2 px-1.5 text-line"
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[helper.tone])} />
                <span className="min-w-0 flex-1 truncate text-foreground">{helper.title}</span>
                <span className="shrink-0 text-muted-foreground text-xs">{helper.word}</span>
                <span className="w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                  {helper.endedAt === null ? (
                    <ElapsedSince since={helper.startedAt} />
                  ) : (
                    formatWorkDuration(Date.parse(helper.endedAt) - Date.parse(helper.startedAt))
                  )}
                </span>
              </li>
            ))}
            <li className="px-1.5 pt-0.5">
              <button
                className="cursor-pointer text-info-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                onClick={onOpenAgents}
                type="button"
              >
                Open the helpers panel
              </button>
            </li>
          </ul>
        ) : null}
        {open === "tasks" && tasks !== null ? (
          <ol className="grid gap-px rounded-xl bg-muted/50 p-1.5" data-working-detail="tasks">
            {keyedSteps(tasks.steps).map(({ key, step }) => {
              const Icon =
                step.status === "completed"
                  ? CheckIcon
                  : step.status === "inProgress"
                    ? CircleDotIcon
                    : CircleIcon;
              return (
                <li
                  key={key}
                  className="flex min-h-6 min-w-0 items-start gap-2 px-1.5 py-0.5 text-line"
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      step.status === "completed"
                        ? "text-status-ok"
                        : step.status === "inProgress"
                          ? "text-status-busy"
                          : "text-muted-foreground/50",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0",
                      step.status === "completed" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {step.step}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {browser}
      </div>
    </div>
  );
}
