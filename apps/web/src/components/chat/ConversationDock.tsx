/**
 * The dock above the composer: the running deploy with its pipeline, the
 * helpers the Mate started and their states, the Mate's task list, a pause's
 * countdown — one quiet row each, a click opening one in place. It floats
 * over the timeline's bottom, so nothing in it ever moves a message.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDotIcon,
  CircleIcon,
  ListTodoIcon,
  PauseIcon,
  RocketIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import { formatWorkDuration } from "./conversation.logic";
import type { DockModel } from "./conversationDock.logic";
import { ElapsedSince } from "./ConversationRows";

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

function DockRow({
  icon: Icon,
  iconClassName,
  open,
  onToggle,
  children,
  label,
}: {
  readonly icon: LucideIcon;
  readonly iconClassName?: string;
  readonly open: boolean;
  readonly onToggle: (() => void) | null;
  readonly children: ReactNode;
  readonly label: string;
}) {
  const body = (
    <>
      <Icon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 text-muted-foreground", iconClassName)}
      />
      {children}
      {onToggle ? (
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      ) : null}
    </>
  );
  const className =
    "flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-line";
  return onToggle ? (
    <button
      aria-expanded={open}
      aria-label={label}
      className={cn(
        className,
        "cursor-pointer transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      )}
      onClick={onToggle}
      type="button"
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A running deploy: its current step in one line, the full pipeline one click away. */
function DockOperation({
  operation,
  environmentId,
  threadRef,
  open,
  onToggle,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const regions = useOperationCard(operation, environmentId);
  const steps = regions.observed?.steps ?? operation.steps;
  const current =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "failed") ??
    steps.findLast((step) => step.state === "done");
  return (
    <div data-dock-operation={operation.kind}>
      <DockRow
        icon={RocketIcon}
        label={`${operation.statusWord} ${operation.subject}. ${open ? "Hide" : "Show"} the pipeline`}
        onToggle={onToggle}
        open={open}
      >
        <span className="shrink-0 font-medium text-foreground">{operation.statusWord}</span>
        <span className="shrink-0 rounded-md bg-accent px-1.5 text-foreground text-xs leading-5">
          {operation.subject}
        </span>
        {steps.length > 1 ? (
          <span aria-hidden="true" className="flex w-16 shrink-0 items-center gap-0.5">
            {steps.map((step) => (
              <span
                key={step.id}
                className={cn(
                  "h-1 min-w-0 flex-1 rounded-full",
                  STEP_SEGMENT[step.state] ?? STEP_SEGMENT.queued,
                )}
              />
            ))}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {current
            ? `${current.label}${current.stateLabel ? ` · ${current.stateLabel.toLowerCase()}` : ""}`
            : "Starting"}
        </span>
        <span className="shrink-0 text-muted-foreground text-xs">
          <ElapsedSince since={operation.anchorAt} />
        </span>
      </DockRow>
      {open ? (
        <div className="mx-1 mt-1 mb-1.5 max-h-96 overflow-auto">
          <ZeropsOperationCard operation={operation} threadRef={threadRef} {...regions} />
        </div>
      ) : null}
    </div>
  );
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

export function ConversationDock({
  model,
  environmentId,
  threadRef,
  timestampFormat,
  onOpenAgents,
}: {
  readonly model: DockModel;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly timestampFormat: TimestampFormat;
  readonly onOpenAgents: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const counting = model.pause?.resetsAt != null;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [counting]);

  return (
    <section
      aria-label="What the Mate is doing now"
      className="dropdown-glass mx-auto mb-2 grid w-full max-w-3xl gap-px rounded-2xl p-1 shadow-lg"
      data-conversation-dock
    >
      {model.operations.map((operation) => (
        <DockOperation
          key={operation.key}
          environmentId={environmentId}
          onToggle={() => toggle(operation.key)}
          open={open === operation.key}
          operation={operation}
          threadRef={threadRef}
        />
      ))}
      {model.helpers ? (
        <div data-dock-helpers>
          <DockRow
            icon={BotIcon}
            label={`Helpers. ${open === "helpers" ? "Hide" : "Show"} each one`}
            onToggle={() => toggle("helpers")}
            open={open === "helpers"}
          >
            <span className="shrink-0 font-medium text-foreground">
              {model.helpers.rows.length === 1
                ? "1 helper"
                : `${model.helpers.rows.length} helpers`}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {[
                model.helpers.working > 0 ? `${model.helpers.working} working` : null,
                model.helpers.done > 0 ? `${model.helpers.done} done` : null,
                model.helpers.failed > 0 ? `${model.helpers.failed} failed` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </DockRow>
          {open === "helpers" ? (
            <ul className="mx-1 mb-1 grid gap-px">
              {model.helpers.rows.map((helper) => (
                <li
                  key={helper.id}
                  className="flex min-h-6 min-w-0 items-center gap-2 px-2 text-line"
                >
                  <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[helper.tone])} />
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
              <li className="px-2 pt-0.5">
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
        </div>
      ) : null}
      {model.tasks ? (
        <div data-dock-tasks>
          <DockRow
            icon={ListTodoIcon}
            label={`Tasks. ${open === "tasks" ? "Hide" : "Show"} the list`}
            onToggle={() => toggle("tasks")}
            open={open === "tasks"}
          >
            <span className="shrink-0 font-medium text-foreground tabular-nums">
              {model.tasks.done} of {model.tasks.steps.length} done
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {model.tasks.current ?? ""}
            </span>
          </DockRow>
          {open === "tasks" ? (
            <ol className="mx-1 mb-1 grid gap-px">
              {keyedSteps(model.tasks.steps).map(({ key, step }) => {
                const Icon =
                  step.status === "completed"
                    ? CheckIcon
                    : step.status === "inProgress"
                      ? CircleDotIcon
                      : CircleIcon;
                return (
                  <li
                    key={key}
                    className="flex min-h-6 min-w-0 items-start gap-2 px-2 py-0.5 text-line"
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
        </div>
      ) : null}
      {model.pause ? (
        <DockRow
          icon={PauseIcon}
          iconClassName="text-status-attention"
          label="Paused"
          onToggle={null}
          open={false}
        >
          <span className="shrink-0 font-medium text-status-attention-text">Paused</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {model.pause.resetsAt === null
              ? "Claude usage limit"
              : Date.parse(model.pause.resetsAt) <= nowMs
                ? `Claude usage limit · reset at ${formatDayAwareTimestamp(model.pause.resetsAt, timestampFormat)}`
                : `Claude usage limit · resets at ${formatDayAwareTimestamp(model.pause.resetsAt, timestampFormat)}, in ${formatWorkDuration(Date.parse(model.pause.resetsAt) - nowMs)}`}
          </span>
        </DockRow>
      ) : null}
    </section>
  );
}
