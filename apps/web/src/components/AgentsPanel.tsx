/**
 * The helpers panel: a map of the Mate's helpers and theirs — each with its
 * state, its clock and what it does now — where a helper's row opens its own
 * card (`HelperCard`): its task, its run as the Mate's run card draws one,
 * and its report whole. A workflow keeps its phases.
 *
 * - Spawn order is stable; activity and completion update rows in place.
 * - A row's name and its line wrap, never cut; its clock keeps the panel's
 *   gutter. The model and the tokens stay, quiet, under it.
 * - Live clocks tick by DOM writes, not commits.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  AgentPanelModel,
  AgentPanelWorkflowGroup,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { formatSubagentTokenCount } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  isActiveSubagentStatus,
  isTerminalSubagentStatus,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { Bot, Braces, Check, ChevronDown, ChevronRight, Minus, X } from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { cn } from "~/lib/utils";
import { MateMark } from "~/components/MateMark";
import { HelperCard, HelperClock, helperCostWords } from "~/components/chat/HelperCard";
import { answeredHelperAsk, answerHelperAsk, useHelperFocus } from "~/components/chat/helperFocus";
import { helperMap, helperNowWords, helperReportLine } from "~/components/chat/helpers.logic";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { orchestrationEnvironment } from "~/state/orchestration";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Button } from "~/components/ui/button";

/**
 * In-flight states all present as Working (one steady state, per the
 * monitoring-pill design: detail belongs in the activity sub-line, and a
 * stalled/waiting/queued subagent is still the fleet doing its job, not a
 * user problem). Only settled states differentiate.
 */
const STATUS_VISUALS: Record<RuntimeSubagent["status"], { dotClass: string; label: string }> = {
  pending: { dotClass: "bg-info", label: "Working" },
  running: { dotClass: "bg-info", label: "Working" },
  waiting: { dotClass: "bg-info", label: "Working" },
  // Idle reads as settled (muted, not sky): a resting Codex child looks done
  // unless resumed — live-test: sky idle dots read as stuck in-progress.
  idle: { dotClass: "bg-muted-foreground/50", label: "Idle · resumable" },
  completed: { dotClass: "bg-success", label: "Completed" },
  failed: { dotClass: "bg-destructive", label: "Failed" },
  cancelled: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
  interrupted: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
};

function StatusDot({ status }: { status: RuntimeSubagent["status"] }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_VISUALS[status].dotClass)}
    />
  );
}

function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function elapsedBetween(startedAt: string, endIso: string | null): string {
  const start = Date.parse(startedAt);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "";
  }
  return formatElapsedSeconds((end - start) / 1000);
}

/** Its state at a glance, where its name starts: no word says it again. */
function HelperMark({ status }: { status: RuntimeSubagent["status"] }) {
  if (status === "completed") {
    return <Check aria-hidden className="size-3.5 text-status-ok-text" strokeWidth={2.5} />;
  }
  if (status === "failed") {
    return <X aria-hidden className="size-3.5 text-status-failed-text" strokeWidth={2.5} />;
  }
  if (status === "cancelled" || status === "interrupted") {
    return <Minus aria-hidden className="size-3.5 text-muted-foreground" strokeWidth={2.5} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full",
        status === "waiting"
          ? "bg-status-attention"
          : status === "idle"
            ? "bg-muted-foreground/50"
            : "bg-status-busy",
      )}
    />
  );
}

const STATE_WORDS: Record<RuntimeSubagent["status"], string> = {
  pending: "Starting",
  running: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  completed: "Done",
  failed: "Failed",
  cancelled: "Stopped",
  interrupted: "Stopped",
};

/**
 * Its line under its name: live, what it does now; settled, its report's
 * first line, or why it failed. Waiting says so, as nothing else does.
 */
function helperLine(agent: RuntimeSubagent): string | null {
  if (agent.status === "waiting") return "Waits for you";
  if (isActiveSubagentStatus(agent.status)) {
    return helperNowWords(agent) ?? agent.prompt?.split("\n")[0] ?? null;
  }
  return helperReportLine(agent);
}

/**
 * One helper on the map: its mark, its name, its clock at the right edge;
 * what it does now (or what it came to) under its name; what it ran on and
 * cost, quiet. Pressed, its own card opens under it.
 */
interface MapState {
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly threadRef: ScopedThreadRef | null;
}

const MapCtx = createContext<MapState>({
  openId: null,
  onToggle: () => undefined,
  activities: [],
  threadRef: null,
});

function HelperRow({ agent, depth = 0 }: { agent: RuntimeSubagent; depth?: number }) {
  const { openId, onToggle, activities, threadRef } = use(MapCtx);
  const open = openId === agent.id;
  const line = helperLine(agent);
  const cost = helperCostWords(agent);
  const rowRef = useRef<HTMLLIElement>(null);
  return (
    <li
      ref={rowRef}
      className="helper-row"
      data-helper-row={agent.id}
      data-nested={depth > 0 ? "" : undefined}
      data-open={open ? "" : undefined}
      style={{ "--helper-depth": depth } as CSSProperties}
    >
      <button
        aria-expanded={threadRef === null ? undefined : open}
        className="helper-row-head"
        disabled={threadRef === null}
        onClick={() => onToggle(agent.id)}
        type="button"
      >
        <span className="helper-row-mark">
          <HelperMark status={agent.status} />
        </span>
        <span className="helper-row-name">{agent.title}</span>
        <span className="helper-row-clock">
          <HelperClock helper={agent} />
        </span>
        {line !== null ? (
          <span
            className={cn(
              "helper-row-line",
              agent.status === "failed" && "text-status-failed-text",
              agent.status === "waiting" && "text-status-attention-text",
            )}
          >
            {line}
          </span>
        ) : null}
        {cost !== null ? <span className="helper-row-cost">{cost}</span> : null}
        <span className="sr-only">{STATE_WORDS[agent.status]}</span>
      </button>
      {open && threadRef !== null ? (
        <div className="helper-row-card">
          <HelperCard activities={activities} helper={agent} threadRef={threadRef} />
        </div>
      ) : null}
    </li>
  );
}

function workflowIsLive(group: AgentPanelWorkflowGroup): boolean {
  const status = group.workflow.status;
  return (
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "interrupted"
  );
}

function workflowMembers(group: AgentPanelWorkflowGroup): ReadonlyArray<RuntimeSubagent> {
  return [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
}

/**
 * Phase rail: the run's shape at a glance. One segment per phase in order,
 * separated by chevrons; each segment shows title + one dot per member.
 * The whole arc (done → live → pending) is visible without scrolling the
 * member list.
 */
function PhaseRail({ group }: { group: AgentPanelWorkflowGroup }) {
  if (group.phases.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1.5 pb-1 pt-1.5">
      {group.phases.map((phase, index) => (
        <div key={phase.index} className="flex items-center gap-1">
          {index > 0 ? (
            <ChevronRight aria-hidden className="size-3 text-muted-foreground/40" />
          ) : null}
          <div
            className={cn(
              "flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
              phase.state === "running"
                ? "border-info/40"
                : phase.state === "done"
                  ? "border-success/30"
                  : "border-border/50",
            )}
          >
            <span
              className={cn(
                "font-mono text-3xs",
                phase.state === "running"
                  ? "text-info-foreground"
                  : phase.state === "done"
                    ? "text-success-foreground"
                    : "text-muted-foreground/70",
              )}
            >
              {phase.state === "done" ? "✓ " : ""}
              {phase.title}
            </span>
            <span className="flex items-center gap-0.5">
              {phase.members.length === 0 ? (
                <span className="font-mono text-3xs text-muted-foreground/50">–</span>
              ) : (
                phase.members.map((member) => <StatusDot key={member.id} status={member.status} />)
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only workflow script viewer, fetched through the contained
 * getWorkflowScript RPC (never a raw filesystem read from the client).
 */
function WorkflowScriptView({
  environmentId,
  threadId,
  scriptPath,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  scriptPath: string;
  onClose: () => void;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.workflowScript({ environmentId, input: { threadId, scriptPath } }),
  );
  return (
    <div className="mx-1.5 mb-1 rounded-md border border-border/60 bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1">
        <Braces aria-hidden className="size-3 text-muted-foreground" />
        <span className="truncate font-mono text-3xs text-muted-foreground">
          {scriptPath.split("/").at(-1)}
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onClose}
          aria-label="Close script"
          className="ml-auto"
        >
          <X aria-hidden className="size-3" />
        </Button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {result._tag === "Success" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-foreground/90">
            {result.value.contents}
            {result.value.truncated ? "\n… (truncated)" : ""}
          </pre>
        ) : result._tag === "Failure" ? (
          <p className="text-xs text-destructive-foreground">Could not load the script.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible phase section. A phase opens when it becomes active, then keeps
 * that shape as it settles so completion never yanks rows out from under the
 * user. Manual toggles stick until a later activation begins.
 */
function PhaseSection({
  phase,
  defaultOpen = false,
}: {
  phase: AgentPanelWorkflowGroup["phases"][number];
  defaultOpen?: boolean;
}) {
  const [chosen, setOpen] = useState(defaultOpen || phase.state === "running");
  // It stands open while it holds the helper opened on the map.
  const { openId, onToggle } = use(MapCtx);
  const holds = phase.members.some((member) => member.id === openId);
  const open = chosen || holds;
  const previousState = useRef(phase.state);

  useEffect(() => {
    if (previousState.current !== "running" && phase.state === "running") {
      setOpen(true);
    }
    previousState.current = phase.state;
  }, [phase.state]);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // Folding it folds the helper opened in it too.
          if (open && holds && openId !== null) onToggle(openId);
          setOpen(!open);
        }}
        aria-expanded={open}
        className={cn(
          "mt-2 flex w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-3xs font-medium uppercase tracking-wider hover:bg-accent/40",
          phase.state === "done"
            ? "text-success-foreground"
            : phase.state === "running"
              ? "text-info-foreground"
              : "text-muted-foreground/70",
        )}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0" />
        )}
        {phase.state === "done" ? <Check aria-hidden className="size-3" /> : null}
        <span>{phase.title}</span>
        <span className="font-normal normal-case text-muted-foreground/70">
          {phase.state === "pending" && phase.members.length === 0
            ? "pending"
            : phase.state === "done"
              ? `${phase.settledCount} done`
              : `${phase.activeCount} active · ${phase.settledCount} done`}
        </span>
        {!open && phase.members.length > 0 ? (
          <span className="ml-auto flex items-center gap-0.5">
            {phase.members.map((member) => (
              <StatusDot key={member.id} status={member.status} />
            ))}
          </span>
        ) : null}
      </button>
      {open ? (
        <ul className="helper-map">
          {phase.members.map((member) => (
            <HelperRow key={member.id} agent={member} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Expanded workflow: phase rail + full phase tree. */
function ExpandedWorkflowSection({
  group,
  environmentId,
  threadId,
  onCollapse,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onCollapse: () => void;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const members = workflowMembers(group);
  const settled = members.filter(
    (member) =>
      member.status === "completed" ||
      member.status === "failed" ||
      member.status === "cancelled" ||
      member.status === "interrupted",
  ).length;
  const scriptPath = group.workflow.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  return (
    <section className="rounded-lg border border-border/50 bg-card/30 p-1.5">
      <div className="flex items-center gap-2 px-1.5 pt-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        <StatusDot status={group.workflow.status} />
        <span className="min-w-0 truncate">
          {group.workflow.workflowName ?? group.workflow.title}
        </span>
        {canShowScript ? (
          <button
            type="button"
            onClick={() => setScriptOpen((value) => !value)}
            className={cn(
              "rounded-sm border border-border/60 px-1 font-mono normal-case hover:text-foreground",
              scriptOpen && "text-foreground",
            )}
            aria-expanded={scriptOpen}
          >
            {"{}"} script
          </button>
        ) : null}
        <span className="ml-auto font-mono normal-case text-muted-foreground/80">
          {settled}/{members.length} settled
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onCollapse}
          aria-label="Collapse workflow"
        >
          <ChevronDown aria-hidden className="size-3" />
        </Button>
      </div>
      <PhaseRail group={group} />
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {group.phases.map((phase) => (
        <PhaseSection key={phase.index} phase={phase} defaultOpen={!workflowIsLive(group)} />
      ))}
      {group.unphasedMembers.length > 0 ||
      (group.phases.length === 0 && group.unphasedMembers.length === 0) ? (
        <ul className="helper-map">
          {group.unphasedMembers.map((member) => (
            <HelperRow key={member.id} agent={member} />
          ))}
          {group.phases.length === 0 && group.unphasedMembers.length === 0 ? (
            <HelperRow agent={group.workflow} />
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Collapsed workflow: one summary line. The parent owns expansion so a live
 * workflow keeps its shape when it settles.
 */
function CollapsedWorkflowSection({
  group,
  onExpand,
}: {
  group: AgentPanelWorkflowGroup;
  onExpand: () => void;
}) {
  const members = workflowMembers(group);
  const failed = members.filter((member) => member.status === "failed").length;
  // Coordinator usage may already aggregate members (panel-footer rule):
  // count it only when there are no member rows to sum.
  const totalTokens = members.reduce(
    (sum, member) => sum + (member.usage?.totalTokens ?? 0),
    members.length === 0 ? (group.workflow.usage?.totalTokens ?? 0) : 0,
  );
  const elapsed =
    group.workflow.startedAt && group.workflow.completedAt
      ? elapsedBetween(group.workflow.startedAt, group.workflow.completedAt)
      : null;
  return (
    <section>
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/40"
        aria-expanded={false}
      >
        <StatusDot status={failed > 0 ? "failed" : group.workflow.status} />
        <span className="truncate text-sm">
          {group.workflow.workflowName ?? group.workflow.title}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-2xs text-muted-foreground/80">
          {failed > 0 ? <span className="text-destructive-foreground">{failed} failed</span> : null}
          <span>{members.length} agents</span>
          <span className="tabular-nums">· {formatSubagentTokenCount(totalTokens)} tok</span>
          {elapsed ? <span className="tabular-nums">· {elapsed}</span> : null}
          <ChevronRight aria-hidden className="size-3" />
        </span>
      </button>
    </section>
  );
}

/** A workflow's open state is presentation state, not a status derivative. */
function WorkflowSection({
  group,
  environmentId,
  threadId,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
}) {
  const [chosen, setOpen] = useState(() => workflowIsLive(group));
  // It stands open while it holds the helper opened on the map.
  const { openId, onToggle } = use(MapCtx);
  const holds =
    openId !== null &&
    (group.workflow.id === openId || workflowMembers(group).some((m) => m.id === openId));
  const open = chosen || holds;
  return open ? (
    <ExpandedWorkflowSection
      group={group}
      environmentId={environmentId}
      threadId={threadId}
      onCollapse={() => {
        if (holds && openId !== null) onToggle(openId);
        setOpen(false);
      }}
    />
  ) : (
    <CollapsedWorkflowSection group={group} onExpand={() => setOpen(true)} />
  );
}

/**
 * The Mate at the top of its map: its face and name, and how many of its
 * helpers work now and how many are done.
 */
function MateRoot({
  environmentId,
  model,
}: {
  environmentId: EnvironmentId | null;
  model: AgentPanelModel;
}) {
  const mate = useKnownMate(environmentId ?? ("" as EnvironmentId));
  const counts = [
    model.liveCount > 0 ? `${model.liveCount} working` : null,
    model.idleCount > 0 ? `${model.idleCount} idle` : null,
    model.settledCount > 0 ? `${model.settledCount} done` : null,
  ].filter((part): part is string => part !== null);
  return (
    <div className="helper-map-root">
      <MateMark className="size-4 shrink-0" tint={mate?.tint} />
      <span className="font-medium text-foreground">{mate?.name ?? "The Mate"}</span>
      <span className="text-muted-foreground tabular-nums">{counts.join(" · ")}</span>
    </div>
  );
}

/**
 * Helpers an earlier run finished, folded once newer ones work: the map
 * opens on what runs now, and keeps the rest a press away.
 */
function splitEarlier(roots: ReadonlyArray<RuntimeSubagent>): {
  earlier: ReadonlyArray<RuntimeSubagent>;
  now: ReadonlyArray<RuntimeSubagent>;
} {
  const live = roots.filter((agent) => !isTerminalSubagentStatus(agent.status));
  if (live.length === 0) return { earlier: [], now: roots };
  const since = Math.min(...live.map((agent) => Date.parse(agent.startedAt ?? agent.firstSeenAt)));
  const earlier = roots.filter(
    (agent) =>
      isTerminalSubagentStatus(agent.status) &&
      agent.completedAt !== null &&
      Date.parse(agent.completedAt) < since,
  );
  return earlier.length < 2
    ? { earlier: [], now: roots }
    : { earlier, now: roots.filter((agent) => !earlier.includes(agent)) };
}

function HelperTree({ agents }: { agents: ReadonlyArray<RuntimeSubagent> }) {
  const rows = useMemo(() => helperMap(agents), [agents]);
  const roots = useMemo(
    () => rows.filter((row) => row.depth === 0).map((row) => row.helper),
    [rows],
  );
  // Which earlier helpers fold is decided as the map first shows helpers, and stands while it
  // is open: folding them as one started and unfolding them as none worked moved every row on
  // the surface (Milo's stress run 5, CLS 0.205). What comes later goes under them; one woken
  // again shows where it stood.
  const [folded, setFolded] = useState<ReadonlySet<string> | null>(null);
  if (folded === null && roots.length > 0)
    setFolded(new Set(splitEarlier(roots).earlier.map((agent) => agent.id)));
  const earlier = roots.filter(
    (agent) => folded?.has(agent.id) === true && isTerminalSubagentStatus(agent.status),
  );
  const [chosen, setShowEarlier] = useState(false);
  // The earlier ones stand unfolded while one of theirs is opened on the map.
  const { openId, onToggle } = use(MapCtx);
  const openRow = rows.findIndex((row) => row.helper.id === openId);
  const openRoot =
    openRow === -1 ? undefined : rows.findLast((row, index) => index <= openRow && row.depth === 0);
  const heldEarlier = openRoot !== undefined && earlier.includes(openRoot.helper);
  const showEarlier = chosen || heldEarlier;
  // A row under an earlier root folds with it.
  const hidden = new Set<string>();
  if (!showEarlier) {
    let hiding = false;
    for (const row of rows) {
      if (row.depth === 0) hiding = earlier.includes(row.helper);
      if (hiding) hidden.add(row.helper.id);
    }
  }
  return (
    <>
      {earlier.length > 0 ? (
        <button
          aria-expanded={showEarlier}
          className="helper-map-earlier"
          onClick={() => {
            // Folding them folds the helper opened among them too.
            if (showEarlier && heldEarlier && openId !== null) onToggle(openId);
            setShowEarlier(!showEarlier);
          }}
          type="button"
        >
          {showEarlier ? (
            <ChevronDown aria-hidden className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5" />
          )}
          {`${earlier.length} earlier, done`}
        </button>
      ) : null}
      <ul className="helper-map">
        {rows.map((row) =>
          hidden.has(row.helper.id) ? null : (
            <HelperRow key={row.helper.id} agent={row.helper} depth={row.depth} />
          ),
        )}
      </ul>
    </>
  );
}

const NO_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

export function AgentsPanel({
  model,
  activities = NO_ACTIVITIES,
  environmentId = null,
  threadId = null,
}: {
  model: AgentPanelModel;
  /** The thread's activities: each helper's steps are read off them. */
  activities?: ReadonlyArray<OrchestrationThreadActivity>;
  environmentId?: EnvironmentId | null;
  threadId?: ThreadId | null;
}) {
  const threadRef = useMemo<ScopedThreadRef | null>(
    () => (environmentId !== null && threadId !== null ? { environmentId, threadId } : null),
    [environmentId, threadId],
  );
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  // What the person opened here, and when: a helper asked for from the run
  // card since then opens instead — once: an ask a panel already opened on
  // is the person's past, never what the next opening shows.
  const [opened, setOpened] = useState<{ id: string | null; at: number }>(() => ({
    id: null,
    at: answeredHelperAsk(),
  }));
  const focus = useHelperFocus(threadKey);
  const asked = focus !== null && focus.at > opened.at ? focus : null;
  const openId = asked !== null ? asked.helperId : opened.id;
  const scrollRef = useRef<HTMLDivElement>(null);
  // A helper asked for from the run card comes into view.
  useEffect(() => {
    if (asked === null) return;
    answerHelperAsk(asked.at);
    const frame = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-helper-row="${CSS.escape(asked.helperId)}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [asked]);
  const map = useMemo<MapState>(
    () => ({
      openId,
      onToggle: (id) => setOpened({ id: openId === id ? null : id, at: focus?.at ?? 0 }),
      activities,
      threadRef,
    }),
    [openId, focus?.at, activities, threadRef],
  );

  if (!model.hasAgents) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Bot aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No helpers yet</p>
        <p className="max-w-56 text-xs text-muted-foreground">
          When the Mate starts helpers, each shows here with what it does now, and opens onto its
          own work.
        </p>
      </div>
    );
  }

  return (
    <MapCtx value={map}>
      <div className="flex h-full min-h-0 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div ref={scrollRef} className="helper-panel">
            <MateRoot environmentId={environmentId} model={model} />
            {model.workflows.map((group) => (
              <WorkflowSection
                key={group.workflow.id}
                group={group}
                environmentId={environmentId}
                threadId={threadId}
              />
            ))}
            {model.directAgents.length > 0 ? <HelperTree agents={model.directAgents} /> : null}
          </div>
        </ScrollArea>
      </div>
    </MapCtx>
  );
}
