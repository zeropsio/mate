/**
 * What runs alongside the Mate while it works, under its record: a status
 * bar for each thing that runs — a deploy stepping through its pipeline in the
 * Zerops GUI's words, a service in trouble, the task list, the helpers, the
 * background tasks. A bar says what runs now; the chat says when it started
 * and how it ended. The browser is no drawer here: a check is its row of the
 * chat, from its start (Nova, 2026-09-28: the drawer held a stale picture
 * under the chat for the rest of the run). Each bar opens its detail in place, under it: a deploy's
 * pipeline and build log, the list, each helper, each task (the owner,
 * 2026-09-27: "so much better expandable inline").
 *
 * It is the card's bottom, so it may change shape; while live it only grows,
 * so a bar that leaves never pulls the conversation down. Settling turns it
 * into the run's result. Work that outlives the turn keeps the same bars at
 * the conversation's bottom, with the Mate's face and a way to stop it,
 * until the work ends.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { PipelineSpokenState } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { Button } from "../ui/button";
import { MateFace } from "../zerops/primitives";
import { formatWorkDuration, isGitPushOnly, type IncidentModel } from "./conversation.logic";
import { StatusBar, type BarTone } from "./ConversationPills";
import type { DockBackgroundTask, DockModel } from "./conversationDock.logic";
import { ElapsedSince, type ConversationSpeaker } from "./ConversationRows";
import { OperationDetail, PlanSteps } from "./RunChat";

// ---------------------------------------------------------------------------
// Arriving live
// ---------------------------------------------------------------------------

/** Whether the panel has been drawn once: set after its first commit. */
const PanelShownContext = createContext<{ readonly current: boolean }>({ current: true });

/**
 * Whether something drawn now arrived while the person watched: what a
 * conversation opens onto is simply there, and only what arrives after the
 * panel was first drawn eases in (the owner, 2026-09-26: "retriggering
 * animation of existing items").
 */
function useArrivedLive(): boolean {
  const shown = use(PanelShownContext);
  const [arrived] = useState(() => shown.current);
  return arrived;
}

// ---------------------------------------------------------------------------
// The status bars
// ---------------------------------------------------------------------------

const PIPELINE_BAR: Record<PipelineSpokenState, BarTone> = {
  finished: "done",
  running: "running",
  activating: "running",
  failed: "failed",
  waiting: "waiting",
  cancelled: "waiting",
};

const STEP_BAR: Record<string, BarTone> = {
  done: "done",
  running: "running",
  failed: "failed",
  queued: "waiting",
};

const HELPER_BAR: Record<ServiceStatusToneId, BarTone> = {
  ok: "done",
  busy: "running",
  attention: "attention",
  failed: "failed",
  off: "waiting",
};

const INCIDENT_BAR: Record<IncidentModel["tone"], BarTone> = {
  attention: "attention",
  ok: "done",
  failed: "failed",
};

const TONE_DOT: Record<ServiceStatusToneId, string> = {
  ok: "bg-status-ok",
  busy: "bg-status-busy",
  attention: "bg-status-attention",
  failed: "bg-status-failed",
  off: "bg-status-off",
};

/**
 * One status bar, in the card's grid (K1): its name one column in, the bar,
 * where it is now in words, and a figure on the card's right edge — a time, a
 * count. No mark at rest: its name says what it is ("no unnecessary icons,
 * make the use obvious from the component"). Given `onToggle`, it opens its
 * detail under it, and a chevron after its figure says so, as a call's does.
 */
function Instrument({
  subject,
  bar,
  words,
  figure = null,
  failed = false,
  label,
  open = false,
  onToggle = null,
}: {
  readonly subject: string;
  readonly bar: ReadonlyArray<{ readonly key: string; readonly tone: BarTone }>;
  readonly words: ReactNode;
  readonly figure?: ReactNode;
  readonly failed?: boolean;
  readonly label: string;
  readonly open?: boolean;
  readonly onToggle?: (() => void) | null;
}) {
  const body = (
    <>
      <span aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-3">
        <span className="w-24 shrink-0 truncate text-start font-medium text-foreground">
          {subject}
        </span>
        <StatusBar className="w-14 shrink-0 @md/panel:w-28" segments={bar} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-start",
            failed ? "text-status-failed-text" : "text-muted-foreground",
          )}
        >
          {words}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
        {figure}
        {onToggle === null ? null : (
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground/55 transition-[color,rotate] duration-150 group-hover/bar:text-foreground group-aria-expanded/bar:rotate-180"
          />
        )}
      </span>
    </>
  );
  if (onToggle === null) {
    return (
      <div aria-label={label} className="run-bar" role="group">
        {body}
      </div>
    );
  }
  return (
    <button
      aria-expanded={open}
      aria-label={label}
      className="run-bar group/bar"
      data-scroll-anchor-ignore
      onClick={onToggle}
      type="button"
    >
      {body}
    </button>
  );
}

/** What a bar holds, opened under it: it eases into its room, once. */
function InstrumentDetail({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid animate-room-open motion-reduce:animate-none" data-working-detail>
      <div className="min-h-0 overflow-hidden">
        <div className="ps-9 pe-3.5 pt-1 pb-3">{children}</div>
      </div>
    </div>
  );
}

/**
 * Where a deploy stands: the step running now in the Zerops GUI's own
 * sentence, a segment per step of its pipeline in its state's tone.
 */
function useDeployReading(operation: ZeropsOperation, environmentId: EnvironmentId | null) {
  const regions = useOperationCard(operation, environmentId);
  const pipeline = regions.observed?.pipeline;
  const steps = regions.observed?.steps ?? operation.steps;
  const running = operation.phase === "running";
  const failed = operation.phase === "failed";
  const pipelineStep =
    pipeline === undefined
      ? undefined
      : (pipeline.steps.find((step) => step.id === pipeline.currentStepId) ??
        pipeline.steps.at(-1));
  const fallbackStep =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "failed") ??
    steps.findLast((step) => step.state === "done");
  // A service of a batch has one step, named by the service: its state is
  // the words, never its name a second time. A git push is its status word
  // throughout ("Pushing", "Pushed"): it has no build to watch.
  const pushOnly = isGitPushOnly(operation);
  const words =
    !running || pushOnly
      ? operation.statusWord
      : pipeline?.calculating
        ? "Calculating steps"
        : pipelineStep !== undefined
          ? pipelineStep.sentence
          : fallbackStep !== undefined && fallbackStep.label !== operation.subject
            ? fallbackStep.label
            : operation.statusWord;
  const live =
    pipeline !== undefined && pipeline.steps.length > 0
      ? pipeline.steps.map((step) => ({ key: step.id, tone: PIPELINE_BAR[step.state] }))
      : steps.length > 0
        ? steps.map((step) => ({ key: step.id, tone: STEP_BAR[step.state] ?? "waiting" }))
        : [{ key: "whole", tone: "running" as const }];
  // Settled, the bar says how it ended even when the feed has not caught up:
  // a deploy that finished is whole, one that failed stops where it failed.
  const bar = live.map((segment) => ({
    key: segment.key,
    tone: running
      ? segment.tone
      : failed
        ? segment.tone === "running"
          ? ("failed" as const)
          : segment.tone
        : ("done" as const),
  }));
  return { regions, words, bar, running, failed };
}

/** A deploy's status bar: its service, its pipeline, the step running now, how long. */
function DeployInstrument({
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
  const { words, bar, running, failed } = useDeployReading(operation, environmentId);
  const settledMs =
    operation.settledAt === undefined
      ? null
      : Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  return (
    <Instrument
      bar={bar}
      failed={failed}
      figure={
        running ? (
          <ElapsedSince since={operation.anchorAt} />
        ) : settledMs !== null && Number.isFinite(settledMs) ? (
          formatWorkDuration(settledMs)
        ) : null
      }
      label={`${operation.subject}: ${words}. ${open ? "Hide" : "Show"} the pipeline`}
      onToggle={onToggle}
      open={open}
      subject={operation.subject}
      words={words}
    />
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

/** A status bar arriving: it opens its room, once, when it arrived live. */
function Arriving({ children }: { readonly children: ReactNode }) {
  const arrived = useArrivedLive();
  return (
    <li className={cn("grid", arrived && "animate-room-in motion-reduce:animate-none")}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * The reserved height of what runs alongside: it follows the content up and
 * never back down while live, so a finished bar leaves room at the very
 * bottom instead of pulling the conversation down.
 */
function useGrowOnlyHeight() {
  const contentRef = useRef<HTMLDivElement>(null);
  const tallestRef = useRef(0);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    const measure = () => {
      const height = content.getBoundingClientRect().height;
      if (height > tallestRef.current) {
        tallestRef.current = height;
        setMinHeight(height);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  // The person closed what they opened: the room follows them down, once.
  const release = () => {
    tallestRef.current = 0;
    setMinHeight(undefined);
  };
  return { contentRef, minHeight, release };
}

const TASK_BAR: Record<DockBackgroundTask["state"], BarTone> = {
  running: "running",
  done: "done",
  failed: "failed",
  stopped: "waiting",
};

const TASK_STATE: Record<
  DockBackgroundTask["state"],
  { readonly tone: ServiceStatusToneId; readonly word: string }
> = {
  running: { tone: "busy", word: "Running" },
  done: { tone: "ok", word: "Done" },
  failed: { tone: "failed", word: "Failed" },
  stopped: { tone: "off", word: "Stopped" },
};

function spanOf(startedAt: string, endedAt: string | null): ReactNode {
  return endedAt === null ? (
    <ElapsedSince since={startedAt} />
  ) : (
    formatWorkDuration(Date.parse(endedAt) - Date.parse(startedAt))
  );
}

/** A list under a bar: a row per helper or task, its state and its time. */
function DetailRow({
  tone,
  title,
  word,
  time,
}: {
  readonly tone: ServiceStatusToneId;
  readonly title: string;
  readonly word: string;
  readonly time: ReactNode;
}) {
  return (
    <li className="run-bar">
      <span className="flex justify-center">
        <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-foreground">{title}</span>
        <span className="shrink-0 text-muted-foreground">{word}</span>
      </span>
      <span className="text-muted-foreground tabular-nums">{time}</span>
    </li>
  );
}

/**
 * A status bar for each thing that runs — the deploys, a service in trouble,
 * the task list, the helpers, the background tasks — each opening what it
 * holds under it. `onToggle` hears the person open or close one: the room the
 * bars keep may shrink for that, and nothing else.
 */
function Instruments({
  dock,
  incidents,
  environmentId,
  threadRef,
  onOpenAgents,
  onToggle = null,
}: {
  readonly dock: DockModel | null;
  readonly incidents: ReadonlyArray<IncidentModel>;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
  readonly onToggle?: (() => void) | null;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const operations = dock?.operations ?? [];
  const helpers = dock?.helpers ?? null;
  const tasks = dock?.tasks ?? null;
  const background = dock?.background ?? null;
  if (
    operations.length === 0 &&
    incidents.length === 0 &&
    tasks === null &&
    helpers === null &&
    background === null
  ) {
    return null;
  }
  const runningTask = background?.tasks.findLast((task) => task.state === "running");
  const toggle = (key: string) => {
    onToggle?.();
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const helperWords =
    helpers === null
      ? ""
      : [
          helpers.working > 0 ? `${helpers.working} working` : null,
          helpers.done > 0 ? `${helpers.done} done` : null,
          helpers.failed > 0 ? `${helpers.failed} failed` : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <ul className="run-band grid" data-working-instruments>
      {operations.map((operation) => (
        <Arriving key={operation.key}>
          <DeployInstrument
            environmentId={environmentId}
            onToggle={() => toggle(operation.key)}
            open={open.has(operation.key)}
            operation={operation}
          />
          {open.has(operation.key) ? (
            <InstrumentDetail>
              <OperationDetail
                environmentId={environmentId}
                operation={operation}
                threadRef={threadRef}
              />
            </InstrumentDetail>
          ) : null}
        </Arriving>
      ))}
      {incidents.map((incident) => (
        <Arriving key={incident.key}>
          <Instrument
            bar={[{ key: "whole", tone: INCIDENT_BAR[incident.tone] }]}
            failed={incident.tone === "failed"}
            label={`${incident.hostname}: ${incident.phases.join(", ")}`}
            subject={incident.hostname}
            words={incident.phases.join(" · ")}
          />
        </Arriving>
      ))}
      {tasks !== null ? (
        <Arriving>
          <Instrument
            bar={keyedSteps(tasks.steps).map(({ key, step }) => ({
              key,
              tone:
                step.status === "completed"
                  ? "done"
                  : step.status === "inProgress"
                    ? "running"
                    : "waiting",
            }))}
            figure={`${tasks.done}/${tasks.steps.length}`}
            label={`Tasks: ${tasks.done} of ${tasks.steps.length} done. ${open.has("tasks") ? "Hide" : "Show"} the list`}
            onToggle={() => toggle("tasks")}
            open={open.has("tasks")}
            subject="Tasks"
            words={tasks.current ?? "All done"}
          />
          {open.has("tasks") ? (
            <InstrumentDetail>
              <PlanSteps steps={tasks.steps} />
            </InstrumentDetail>
          ) : null}
        </Arriving>
      ) : null}
      {helpers !== null ? (
        <Arriving>
          <Instrument
            bar={helpers.rows.map((helper) => ({
              key: helper.id,
              tone: HELPER_BAR[helper.tone],
            }))}
            label={`Helpers: ${helperWords}. ${open.has("helpers") ? "Hide" : "Show"} each one`}
            onToggle={() => toggle("helpers")}
            open={open.has("helpers")}
            subject={helpers.rows.length === 1 ? "1 helper" : `${helpers.rows.length} helpers`}
            words={helperWords}
          />
          {open.has("helpers") ? (
            <InstrumentDetail>
              <ul className="grid gap-px">
                {helpers.rows.map((helper) => (
                  <DetailRow
                    key={helper.id}
                    time={spanOf(helper.startedAt, helper.endedAt)}
                    title={helper.title}
                    tone={helper.tone}
                    word={helper.word}
                  />
                ))}
              </ul>
              <button
                className="mt-2 ms-9 cursor-pointer text-info-foreground text-line hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                onClick={onOpenAgents}
                type="button"
              >
                Open the helpers panel
              </button>
            </InstrumentDetail>
          ) : null}
        </Arriving>
      ) : null}
      {background !== null ? (
        <Arriving>
          <Instrument
            bar={background.tasks.map((task) => ({ key: task.id, tone: TASK_BAR[task.state] }))}
            failed={background.running === 0 && background.failed > 0}
            figure={
              background.tasks.length > 1
                ? `${background.done}/${background.tasks.length}`
                : runningTask !== undefined
                  ? spanOf(runningTask.startedAt, null)
                  : null
            }
            label={`Background tasks: ${background.running} running, ${background.done} done, ${background.failed} failed. ${open.has("background") ? "Hide" : "Show"} each one`}
            onToggle={() => toggle("background")}
            open={open.has("background")}
            subject="Background"
            words={
              runningTask?.title ??
              (background.failed > 0
                ? background.failed === 1
                  ? "1 failed"
                  : `${background.failed} failed`
                : "All done")
            }
          />
          {open.has("background") ? (
            <InstrumentDetail>
              <ul className="grid gap-px">
                {background.tasks.map((task) => (
                  <DetailRow
                    key={task.id}
                    time={spanOf(task.startedAt, task.endedAt)}
                    title={task.title}
                    tone={TASK_STATE[task.state].tone}
                    word={TASK_STATE[task.state].word}
                  />
                ))}
              </ul>
            </InstrumentDetail>
          ) : null}
        </Arriving>
      ) : null}
    </ul>
  );
}

/**
 * What runs alongside the Mate while it works, under its record, and the
 * browser while it checks pages. Nothing at all when nothing runs.
 */
export function ConversationWorking({
  incidents,
  dock,
  environmentId,
  threadRef,
  onOpenAgents,
}: {
  readonly incidents: ReadonlyArray<IncidentModel>;
  readonly dock: DockModel | null;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
}) {
  const { contentRef, minHeight, release } = useGrowOnlyHeight();
  // Drawn once: from here on, what arrives arrives live.
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);

  return (
    <PanelShownContext value={shownRef}>
      <div
        className="@container/panel"
        data-conversation-working
        style={minHeight === undefined ? undefined : { minHeight }}
      >
        <div ref={contentRef}>
          <Instruments
            dock={dock}
            environmentId={environmentId}
            incidents={incidents}
            onOpenAgents={onOpenAgents}
            onToggle={release}
            threadRef={threadRef}
          />
        </div>
      </div>
    </PanelShownContext>
  );
}

/**
 * The Mate at work once its turn is over and work runs on — a helper still at
 * it, a background task, a watch loop: its face, what still runs and a way to
 * stop it, at the conversation's bottom. When the work ends it leaves, and
 * what the work did lands in the conversation as its own quiet line.
 */
export function ConversationAfterWork({
  speaker,
  state,
  dock,
  stopping,
  onStop,
  environmentId,
  threadRef,
  onOpenAgents,
}: {
  readonly speaker: ConversationSpeaker;
  readonly state: "working" | "monitoring";
  readonly dock: DockModel | null;
  readonly stopping: boolean;
  readonly onStop: () => void;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
}) {
  // The server says "monitoring" for any shell; only a watch loop watches.
  const running = dock?.background?.tasks.filter((task) => task.state === "running") ?? [];
  const watching =
    (dock?.helpers ?? null) === null &&
    (running.length > 0 ? running.every((task) => task.watch) : state === "monitoring");
  return (
    <section
      aria-label={`${speaker.name} at work in the background`}
      className="run-tray run-tray-whole @container/panel animate-panel-in text-card-foreground motion-reduce:animate-none"
      data-conversation-after-work={state}
    >
      <div className="run-now">
        <MateFace size="md" state="working" tint={speaker.tint} />
        <span className="run-now-words run-now-head">
          <span className="run-now-verb">
            {watching ? "Watching in the background" : "Still working in the background"}
          </span>
        </span>
        <Button disabled={stopping} onClick={onStop} size="xs" variant="ghost">
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
      <Instruments
        dock={dock}
        environmentId={environmentId}
        incidents={EMPTY_INCIDENTS}
        onOpenAgents={onOpenAgents}
        threadRef={threadRef}
      />
    </section>
  );
}

const EMPTY_INCIDENTS: ReadonlyArray<IncidentModel> = [];
