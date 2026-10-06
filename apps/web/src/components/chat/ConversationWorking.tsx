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
 * It is the card's bottom, so it may change shape: a bar that arrives opens
 * its room, and one that leaves gives it back, easing shut as a run's work
 * folds into its line. Settling turns it into the run's result. Work that outlives the turn keeps the same bars at
 * the conversation's bottom, with the Mate's face and a way to stop it,
 * until the work ends.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ChevronDownIcon, TerminalIcon } from "lucide-react";

import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import { cn } from "~/lib/utils";
import { useOperationCard } from "../../zerops/activity/useOperationCard";
import { useStandupReading } from "../../zerops/activity/useStandupReading";
import { Button } from "../ui/button";
import { MateFace } from "../zerops/primitives";
import {
  formatWorkDuration,
  incidentsStanding,
  isGitPushOnly,
  type IncidentModel,
} from "./conversation.logic";
import { useZeropsTopology } from "../../zerops/useZeropsFeeds";
import {
  detailLines,
  importLines,
  lineSegments,
  observedLinesOf,
  operationSubject,
  PIPELINE_BAR,
  settledOperationWords,
} from "./operationBar.logic";
import { opensOnto, standsOpen } from "./opens.logic";
import { StatusBar, type BarTone } from "./StatusBar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { DockModel } from "./conversationDock.logic";
import { ElapsedSince, type ConversationSpeaker } from "./ConversationRows";
import { DetailRow, spanOf, ToneDot } from "./DetailRow";
import { showHelper } from "./helperFocus";
import { standupBar } from "./standupBar.logic";
import { OperationDetail, PlanSteps, useHoldReading } from "./RunChat";
import { drawerEase, stepHeight, type CarriedRow } from "./stepHeight";
import { useEasedRoom } from "./runRoom";
import { backgroundBand, helpersBand, TASK_TONE, type BandLine } from "./workingBands.logic";

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

const STEP_BAR: Record<string, BarTone> = {
  done: "done",
  running: "running",
  failed: "failed",
  queued: "waiting",
};

const INCIDENT_BAR: Record<IncidentModel["tone"], BarTone> = {
  attention: "attention",
  ok: "done",
  failed: "failed",
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
      {/* Narrow, the name takes its own line over the bar and the words, so
          the words stay readable; either way a name past its room gives way,
          whole on hover, and nothing runs over the figure. */}
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 @md/panel:flex-nowrap">
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-0 basis-full truncate text-start font-medium text-foreground @md/panel:min-w-24 @md/panel:max-w-1/2 @md/panel:shrink-0 @md/panel:basis-auto" />
            }
          >
            {subject}
          </TooltipTrigger>
          <TooltipPopup side="top">{subject}</TooltipPopup>
        </Tooltip>
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
      onClick={onToggle}
      type="button"
    >
      {body}
    </button>
  );
}

/**
 * The helpers' or the background tasks' band, as one line (pass 43, R12-9):
 * its mark says how it stands, then what it names it by — a count where there
 * are several, the background's glyph — the title of the one in focus, the
 * others in words, and its time. One line in every state, so nothing shifts
 * as work starts and ends; a new title eases in, only once the person watched
 * the old one.
 */
function Band({
  line,
  glyph = null,
  open = false,
  onToggle = null,
}: {
  readonly line: BandLine;
  readonly glyph?: ReactNode;
  readonly open?: boolean;
  readonly onToggle?: (() => void) | null;
}) {
  const changed = useChangedSinceShown(line.title);
  const body = (
    <>
      <span className="flex justify-center">
        <ToneDot tone={line.tone} />
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {glyph}
        {line.count === null ? null : (
          <span className="shrink-0 font-medium text-foreground">{line.count}</span>
        )}
        <span
          key={line.title}
          className={cn(
            "min-w-0 truncate",
            line.count === null ? "text-foreground" : "text-muted-foreground",
            changed && "animate-words-in motion-reduce:animate-none",
          )}
        >
          {line.title}
        </span>
        {line.others === null ? null : (
          <span className="min-w-0 max-w-1/2 shrink-0 truncate text-muted-foreground">
            · {line.others}
          </span>
        )}
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
        {spanOf(line.startedAt, line.endedAt)}
        {onToggle === null ? null : (
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground/55 transition-[color,rotate] duration-150 ease-out group-hover/bar:text-foreground group-aria-expanded/bar:rotate-180 motion-reduce:transition-none"
          />
        )}
      </span>
    </>
  );
  if (onToggle === null) {
    return (
      <div aria-label={line.label} className="run-bar" role="group">
        {body}
      </div>
    );
  }
  return (
    <button
      aria-expanded={open}
      aria-label={`${line.label}. ${open ? "Hide" : "Show"} each one`}
      className="run-bar group/bar"
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

/**
 * A bar whose control stopped opening — its rows dropped to none — is shut,
 * not left open behind it: when it opens again it starts closed, never
 * springing open by itself.
 */
function useShutWhenItStopsOpening(open: boolean, opens: boolean, onShut: () => void) {
  useLayoutEffect(() => {
    if (open && !opens) onShut();
  });
}

/** A deploy's status bar: its service, its pipeline, the step running now, how long. */
function DeployInstrument({
  operation,
  environmentId,
  open,
  onToggle,
  onShut,
  detail,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Its control stopped opening: it is shut. */
  readonly onShut: () => void;
  /** What it opens to, under it. */
  readonly detail: ReactNode;
}) {
  const reading = useDeployReading(operation, environmentId);
  const { running } = reading;
  // An import is its services: a segment each, and settled, how many failed.
  const lines = operation.kind === "import" ? importLines(operation) : null;
  const bar = lines === null ? reading.bar : lineSegments(lines);
  const words = (lines === null ? null : settledOperationWords(operation, lines)) ?? reading.words;
  const failed = lines === null ? reading.failed : lines.some((line) => line.state === "failed");
  const subject = operationSubject(operation);
  const opens = opensOnto({
    control: "operation",
    lines: detailLines(operation, null, observedLinesOf(reading.regions.observed)),
    reasonCut: false,
  });
  const settledMs =
    operation.settledAt === undefined
      ? null
      : Date.parse(operation.settledAt) - Date.parse(operation.anchorAt);
  // Open only while it opens onto something: rows that dropped to none close it.
  const shown = standsOpen(open, opens);
  useShutWhenItStopsOpening(open, opens, onShut);
  return (
    <>
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
        label={`${subject}: ${words}.${opens ? ` ${shown ? "Hide" : "Show"} ${lines === null ? "the pipeline" : "each service"}` : ""}`}
        onToggle={opens ? onToggle : null}
        open={shown}
        subject={subject}
        words={words}
      />
      {shown ? <InstrumentDetail>{detail}</InstrumentDetail> : null}
    </>
  );
}

/** A step's key: its words, and how many times the same words came before it. */
/**
 * A stand-up call's status bar: the half it stands up, a segment per service
 * of its environment, the build that runs — or how many do — and how many are up.
 * No clock: the run's is the now line's (K3).
 */
function StandupInstrument({
  operation,
  environmentId,
  open,
  onToggle,
  onShut,
  detail,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Its control stopped opening: it is shut. */
  readonly onShut: () => void;
  /** What it opens to, under it. */
  readonly detail: ReactNode;
}) {
  // The band draws it only while its turn runs.
  const reading = useStandupReading(operation, environmentId, true);
  const { words, figure, segments, failed } = standupBar(reading);
  const subject = operationSubject(operation);
  // No service read yet: nothing to open to.
  const opens = opensOnto({
    control: "operation",
    lines: detailLines(operation, reading?.rows.length ?? null),
    reasonCut: false,
  });
  const shown = standsOpen(open, opens);
  useShutWhenItStopsOpening(open, opens, onShut);
  return (
    <>
      <Instrument
        bar={segments}
        failed={failed && reading !== null && reading.building === 0}
        figure={figure}
        label={`${subject}: ${words}${figure === null ? "" : `, ${figure}`}.${opens ? ` ${shown ? "Hide" : "Show"} each service` : ""}`}
        onToggle={opens ? onToggle : null}
        open={shown}
        subject={subject}
        words={words}
      />
      {shown ? <InstrumentDetail>{detail}</InstrumentDetail> : null}
    </>
  );
}

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
    // Under reduced motion it fades in: every arrival does.
    <li className={cn("grid", arrived && "animate-room-in motion-reduce:animate-run-fade")}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/** How long the room of a bar that left takes to close: a run's fold's. */
const ROOM_CLOSE_MS = 360;

/** The panel's room: in a card, its slice of the card; alone, its own. */
function roomOf(panel: HTMLElement): HTMLElement {
  return panel.closest<HTMLElement>(".run-tray-middle") ?? panel;
}

/** The person asked for reduced motion; a page with no media queries asked for nothing. */
function asksForNoMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The room of what runs alongside, in its card: it follows its bars up at
 * once — an arriving bar opens its own (`Arriving`) — and gives back the room
 * of one that leaves, or of one the person closed, easing shut as a run's work
 * folds into its line (the owner, 2026-09-30, of a finished deploy's room
 * kept under a live line: "what's up with the big space … at the bottom").
 * Measured after each draw: the room it stood at is held for the frame it
 * would have jumped, then stepped down to what it holds now (`stepHeight`),
 * carrying the rows of its card the list moves (`carry`); `onRoom` hears the
 * room it holds while it closes, and null once it holds none.
 */
function usePanelRoom({
  carry,
  onRoom,
}: {
  readonly carry?: (() => ReadonlyArray<CarriedRow> | null) | undefined;
  readonly onRoom?: ((room: number | null) => void) | undefined;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The room it stood at: its height once drawn, as it last settled.
  const stoodRef = useRef(0);
  const closingRef = useRef<{ readonly stop: () => void; readonly to: number } | null>(null);
  // What changed in its room since it last settled. A draw that changed
  // nothing there cannot have shrunk it — what does with no draw of its own
  // is the observer's below — so it reads no layout: most of its draws, while
  // a run streams beside it, changed nothing in it.
  const changesRef = useRef<{ readonly observer: MutationObserver; heard: boolean } | null>(null);
  const settle = () => {
    const panel = panelRef.current;
    if (panel === null) return;
    const room = roomOf(panel);
    const closing = closingRef.current;
    const changes = changesRef.current;
    if (changes !== null) {
      const changed = changes.heard || changes.observer.takeRecords().length > 0;
      changes.heard = false;
      if (!changed && closing === null) return;
    }
    const stood = closing === null ? stoodRef.current : room.getBoundingClientRect().height;
    if (closing !== null) room.style.height = "";
    const holds = room.getBoundingClientRect().height;
    if (closing !== null && Math.abs(holds - closing.to) < 0.5) {
      // Drawn again, closing to where it was already going: it goes on.
      room.style.height = `${stood}px`;
      return;
    }
    closing?.stop();
    closingRef.current = null;
    // It grew, or holds the same — or the person asked for no motion — the
    // room follows at once.
    if (holds >= stood - 0.5 || asksForNoMotion()) {
      stoodRef.current = holds;
      if (closing !== null) onRoom?.(null);
      return;
    }
    const carried = carry?.() ?? null;
    const stop = stepHeight({
      element: room,
      from: stood,
      to: holds,
      duration: ROOM_CLOSE_MS,
      ease: drawerEase,
      carried,
      each: (_eased, height) => onRoom?.(height),
      done: () => {
        room.style.height = "";
        closingRef.current = null;
        stoodRef.current = holds;
        onRoom?.(null);
      },
    });
    closingRef.current = { stop, to: holds };
    onRoom?.(stood);
  };
  useLayoutEffect(settle);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const room = roomOf(panel);
    // What grows it without a draw of its own — a bar opening its room over
    // 420 ms — moves where it stands.
    const observer = new ResizeObserver(() => {
      if (closingRef.current === null) stoodRef.current = room.getBoundingClientRect().height;
    });
    observer.observe(room);
    const changes =
      typeof MutationObserver === "undefined"
        ? null
        : {
            observer: new MutationObserver(() => {
              if (changes !== null) changes.heard = true;
            }),
            heard: false,
          };
    changes?.observer.observe(room, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    changesRef.current = changes;
    return () => {
      changes?.observer.disconnect();
      changesRef.current = null;
      observer.disconnect();
      closingRef.current?.stop();
      closingRef.current = null;
      room.style.height = "";
    };
  }, []);
  return { panelRef, settle };
}

/** Whether anything in the dock runs alongside the Mate: a bar of its own under the live line. */
export function dockDraws(dock: DockModel | null): boolean {
  return (
    dock !== null &&
    (dock.operations.length > 0 ||
      dock.tasks !== null ||
      dock.helpers !== null ||
      dock.background !== null)
  );
}

/**
 * A status bar for each thing that runs — the deploys, a service in trouble,
 * the task list, the helpers, the background tasks — each opening what it
 * holds under it. `onDrawn` hears every draw of its own, so the room of a bar
 * the person closed is given back too.
 */
function Instruments({
  dock,
  incidents,
  environmentId,
  threadRef,
  onOpenAgents,
  onDrawn,
}: {
  readonly dock: DockModel | null;
  readonly incidents: ReadonlyArray<IncidentModel>;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
  readonly onDrawn?: (() => void) | undefined;
}) {
  const hold = useHoldReading();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // A bar whose control stopped opening is shut (`useShutWhenItStopsOpening`).
  const shut = (key: string) =>
    setOpen((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  useLayoutEffect(() => onDrawn?.());
  // A service the platform works on this moment says nothing stale of itself.
  const topology = useZeropsTopology(incidents.length === 0 ? null : environmentId);
  const standing = incidentsStanding(
    incidents,
    new Set(
      (topology?.services ?? [])
        .filter((service) => service.transient)
        .map((service) => service.hostname),
    ),
  );
  const operations = dock?.operations ?? [];
  const helpers = dock?.helpers ?? null;
  const tasks = dock?.tasks ?? null;
  const background = dock?.background ?? null;
  if (!dockDraws(dock) && standing.length === 0) return null;
  // One task's row would say the bar's own title and time again.
  const backgroundOpens =
    background !== null && opensOnto({ control: "background-bar", tasks: background.tasks.length });
  const backgroundShown = standsOpen(open.has("background"), backgroundOpens);
  if (open.has("background") && !backgroundOpens) shut("background");
  const toggle = (key: string) => {
    // What the person opened is theirs to read: the conversation stops
    // following its end, so the bar they pressed stays where it is (K12).
    hold(!open.has(key), key);
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <ul className="run-band grid" data-working-instruments>
      {operations.map((operation) => {
        const detail = (
          <OperationDetail
            environmentId={environmentId}
            operation={operation}
            threadRef={threadRef}
            turnRuns
          />
        );
        return (
          <Arriving key={operation.key}>
            {operation.kind === "standup" ? (
              <StandupInstrument
                detail={detail}
                environmentId={environmentId}
                onShut={() => shut(operation.key)}
                onToggle={() => toggle(operation.key)}
                open={open.has(operation.key)}
                operation={operation}
              />
            ) : (
              <DeployInstrument
                detail={detail}
                environmentId={environmentId}
                onShut={() => shut(operation.key)}
                onToggle={() => toggle(operation.key)}
                open={open.has(operation.key)}
                operation={operation}
              />
            )}
          </Arriving>
        );
      })}
      {standing.map((incident) => (
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
          <Band
            line={helpersBand(helpers)}
            onToggle={() => toggle("helpers")}
            open={open.has("helpers")}
          />
          {open.has("helpers") ? (
            <InstrumentDetail>
              <ul className="grid gap-px">
                {helpers.rows.map((helper) => (
                  <DetailRow
                    key={helper.id}
                    onOpen={() => {
                      if (threadRef !== null) showHelper(scopedThreadKey(threadRef), helper.id);
                      onOpenAgents();
                    }}
                    time={spanOf(helper.startedAt, helper.endedAt)}
                    title={helper.title}
                    tone={helper.tone}
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
          <Band
            glyph={
              <TerminalIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            }
            line={backgroundBand(background)}
            onToggle={backgroundOpens ? () => toggle("background") : null}
            open={backgroundShown}
          />
          {backgroundShown ? (
            <InstrumentDetail>
              <ul className="grid gap-px">
                {background.tasks.map((task) => (
                  <DetailRow
                    key={task.id}
                    time={spanOf(task.startedAt, task.endedAt)}
                    title={task.title}
                    tone={TASK_TONE[task.state]}
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
  carry,
  onRoom,
  stop,
}: {
  /**
   * Its run's turns are over and what it started runs on (run 11): the way
   * to stop it, where that work is said — the composer's stop is a turn's.
   */
  readonly stop?: { readonly stopping: boolean; readonly onStop: () => void };
  readonly incidents: ReadonlyArray<IncidentModel>;
  readonly dock: DockModel | null;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly onOpenAgents: () => void;
  /** The rows the list moves as its room closes (`usePanelRoom`); none outside a list. */
  readonly carry?: () => ReadonlyArray<CarriedRow> | null;
  /** The room it holds while it closes, and null once it holds none. */
  readonly onRoom?: (room: number | null) => void;
}) {
  const { panelRef, settle } = usePanelRoom({ carry, onRoom });
  // Drawn once: from here on, what arrives arrives live.
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);

  return (
    <PanelShownContext value={shownRef}>
      <div ref={panelRef} className="@container/panel" data-conversation-working>
        <Instruments
          dock={dock}
          environmentId={environmentId}
          incidents={incidents}
          onDrawn={settle}
          onOpenAgents={onOpenAgents}
          threadRef={threadRef}
        />
        {stop === undefined ? null : (
          <div className="flex justify-end px-3 pb-1.5">
            <Button disabled={stop.stopping} onClick={stop.onStop} size="xs" variant="ghost">
              {stop.stopping ? "Stopping…" : "Stop"}
            </Button>
          </div>
        )}
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
  // As what runs comes and goes, its height eases (`useEasedRoom`).
  const roomRef = useEasedRoom<HTMLElement>(true);
  return (
    <section
      ref={roomRef}
      aria-label={`${speaker.name} at work in the background`}
      className="run-tray run-tray-whole @container/panel animate-panel-in text-card-foreground motion-reduce:animate-none"
      data-conversation-after-work={state}
    >
      <div className="run-now">
        <MateFace shape={speaker.shape} size="md" state="working" tint={speaker.tint} />
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
