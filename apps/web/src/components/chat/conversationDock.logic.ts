/**
 * The dock above the composer: what changes size while the Mate works, kept
 * out of the conversation so a helper starting or a deploy stepping on never
 * moves a message — the operations running now, the helpers and their
 * states, the Mate's task list, and a pause's countdown.
 *
 * Pure: the ChatView reads the thread and hands the pieces here.
 */
import type {
  AgentPanelModel,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { ActivePlanState, TimelineEntry } from "../../session-logic";
import { readUsageLimitNotice } from "./conversation.logic";

/** Operations that run long enough to watch: a pipeline or a multi-step setup. */
export const DOCKED_KINDS: ReadonlySet<ZeropsOperation["kind"]> = new Set([
  "deploy",
  "import",
  "bootstrap",
  "mount",
]);

export interface DockHelper {
  readonly id: string;
  /** The helper's task in the words it was given. */
  readonly title: string;
  readonly tone: ServiceStatusToneId;
  readonly word: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface DockModel {
  readonly operations: ReadonlyArray<ZeropsOperation>;
  readonly helpers: {
    readonly rows: ReadonlyArray<DockHelper>;
    readonly working: number;
    readonly done: number;
    readonly failed: number;
  } | null;
  readonly tasks: {
    readonly steps: ActivePlanState["steps"];
    readonly done: number;
    readonly current: string | null;
  } | null;
  readonly pause: { readonly resetsAt: string | null } | null;
}

const HELPER_STATE: Record<
  RuntimeSubagent["status"],
  { readonly tone: ServiceStatusToneId; readonly word: string }
> = {
  pending: { tone: "busy", word: "Starting" },
  running: { tone: "busy", word: "Working" },
  waiting: { tone: "attention", word: "Waiting for you" },
  idle: { tone: "off", word: "Idle" },
  completed: { tone: "ok", word: "Done" },
  failed: { tone: "failed", word: "Failed" },
  cancelled: { tone: "off", word: "Stopped" },
  interrupted: { tone: "attention", word: "Cut off" },
};

function helperTitle(agent: RuntimeSubagent): string {
  const title = agent.title.trim();
  if (title.length > 0) return title.charAt(0).toUpperCase() + title.slice(1);
  return agent.role ? `A ${agent.role.replace(/[-_]/g, " ")} helper` : "A helper";
}

/**
 * The helpers of the turn running now, flattened: the direct ones and each
 * workflow's members — those it started, and any from before still working.
 * A helper an earlier turn finished is that turn's history, not this one's.
 */
export function dockHelpers(
  model: AgentPanelModel,
  turnStartedAt: string | null = null,
): ReadonlyArray<DockHelper> {
  const since = turnStartedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(turnStartedAt);
  const agents = [
    ...model.directAgents,
    ...model.workflows.flatMap((group) => group.phases.flatMap((phase) => phase.members)),
  ].filter(
    (agent) =>
      agent.completedAt === null || Date.parse(agent.startedAt ?? agent.firstSeenAt) >= since,
  );
  return agents.map((agent) => {
    const state = HELPER_STATE[agent.status];
    return {
      id: agent.id,
      title: helperTitle(agent),
      tone: state.tone,
      word: state.word,
      startedAt: agent.startedAt ?? agent.firstSeenAt,
      endedAt: agent.completedAt,
    };
  });
}

export function deriveDock(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly isWorking: boolean;
  readonly runningTurnId: string | null;
  /** When the running turn started: helpers an earlier turn finished are not its own. */
  readonly turnStartedAt?: string | null;
  readonly agentPanelModel: AgentPanelModel;
  readonly plan: ActivePlanState | null;
  /** The thread is held by a usage limit: when it resets, if known. */
  readonly pause: { readonly resetsAt: string | null } | null;
}): DockModel | null {
  // The running turn's pipelines, finished ones included: a deploy that
  // landed mid-turn keeps its row, final word and all, until the turn's
  // outcome takes over.
  const operations =
    input.isWorking && input.runningTurnId !== null
      ? input.timelineEntries.flatMap((entry) =>
          entry.kind === "operation" &&
          DOCKED_KINDS.has(entry.operation.kind) &&
          entry.operation.turnId === input.runningTurnId
            ? [entry.operation]
            : [],
        )
      : [];

  const rows = input.isWorking
    ? dockHelpers(input.agentPanelModel, input.turnStartedAt ?? null)
    : [];
  const helpers =
    rows.length === 0
      ? null
      : {
          rows,
          working: rows.filter((row) => row.tone === "busy" || row.tone === "attention").length,
          done: rows.filter((row) => row.tone === "ok").length,
          failed: rows.filter((row) => row.tone === "failed").length,
        };

  const plan = input.plan;
  const tasks =
    input.isWorking &&
    plan !== null &&
    plan.steps.length > 1 &&
    (input.runningTurnId === null || plan.turnId === input.runningTurnId)
      ? {
          steps: plan.steps,
          done: plan.steps.filter((step) => step.status === "completed").length,
          current:
            plan.steps.find((step) => step.status === "inProgress")?.step ??
            plan.steps.find((step) => step.status === "pending")?.step ??
            null,
        }
      : null;

  const pause = input.isWorking ? null : input.pause;
  return operations.length === 0 && helpers === null && tasks === null && pause === null
    ? null
    : { operations, helpers, tasks, pause };
}

/**
 * Whether the thread is held by a usage limit right now: its latest word is
 * the limit's notice and nothing has worked since. Read backwards from the
 * end, so it costs a few entries, not the thread.
 */
export function latestUsagePause(
  timelineEntries: ReadonlyArray<TimelineEntry>,
): { readonly resetsAt: string | null } | null {
  for (let index = timelineEntries.length - 1; index >= 0; index -= 1) {
    const entry = timelineEntries[index]!;
    if (entry.kind === "change-landed" || entry.kind === "turn-plan") continue;
    if (entry.kind !== "message") return null;
    if (entry.message.role === "user" || entry.message.role === "reasoning") continue;
    const notice = readUsageLimitNotice(entry.message.text, entry.message.createdAt);
    return notice === null ? null : { resetsAt: notice.resetsAt };
  }
  return null;
}
