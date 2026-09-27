/**
 * The Crew section's reading of the crew view (PRD §4.3): each crewmate row's
 * state and lead line, what each *Waiting on you* row lets you press, what a
 * dev service serves, and the sidebar's crew faces.
 *
 * Every word comes from `crew/phrases.ts` (crew and task words) or the one
 * status resolver's phrase producer (a thread's word, R5); this file only
 * picks which.
 */
import {
  CREW_ATTENTION_VERBS,
  CREW_IDLE_WORD,
  crewAskToFixWord,
  crewAskToResolveWord,
  crewCommitEditAsk,
  crewServedWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type {
  CrewAttention,
  CrewCommand,
  CrewHost,
  CrewLogin,
  CrewRun,
  CrewSnapshot,
  CrewTaskState,
  Crewmate,
  ThreadId,
} from "@t3tools/contracts";
import type { MateMarkState, MateTintId, ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  mateMarkStateForThreadStatus,
  type ThreadStatusToneId,
} from "@t3tools/shared/threadStatus";

const THREAD_DOT_TONE: Record<ThreadStatusToneId, ServiceStatusToneId> = {
  attention: "attention",
  input: "attention",
  active: "busy",
  danger: "failed",
  plan: "attention",
  success: "ok",
  neutral: "off",
};

const TASK_DOT_TONE: Record<CrewTaskState, ServiceStatusToneId> = {
  proposed: "attention",
  queued: "off",
  working: "busy",
  rework: "busy",
  blocked: "attention",
  merging: "busy",
  checking: "busy",
  review: "busy",
  ready: "ok",
  landing: "busy",
  "waiting-on-you": "attention",
  landed: "ok",
  parked: "failed",
  discarded: "off",
};

/** The login every crewmate runs on unless its *Runs on* names another. */
const DEFAULT_LOGIN_ID = "claudeAgent";

export interface CrewRowState {
  readonly word: string;
  readonly tone: ServiceStatusToneId;
  readonly pulse: boolean;
}

/**
 * A crewmate row's state: its open task's word while one is open (a working
 * task's word is its thread's), otherwise its thread's; a crewmate doing
 * neither is idle, in the crew header's word.
 */
export function crewRowState(row: CrewmateView, tasks: CrewView["tasks"]): CrewRowState {
  const task = row.openTask;
  const thread =
    row.status === null || row.statusWord === null
      ? null
      : { word: row.statusWord, tone: THREAD_DOT_TONE[row.status.toneId], pulse: row.working };
  if (task !== null && task.state !== "working") {
    const word = tasks.find((candidate) => candidate.task.id === task.id)?.word ?? null;
    if (word !== null) return { word, tone: TASK_DOT_TONE[task.state], pulse: false };
  }
  return thread ?? { word: CREW_IDLE_WORD, tone: "off", pulse: false };
}

/** The row's muted line: the open task as `#N title`, or the job's first line. */
export function crewRowLead(row: CrewmateView): {
  readonly kind: "task" | "job";
  readonly text: string;
} {
  return row.openTask === null
    ? { kind: "job", text: row.crewmate.jobFirstLine }
    : { kind: "task", text: `#${row.openTask.number} ${row.openTask.title}` };
}

/** A login other than the default one is named beside the crewmate. */
export function crewLoginMark(login: CrewLogin): string | null {
  return login.id === DEFAULT_LOGIN_ID ? null : login.label;
}

/** The header's dot beside `crewStateWord`. */
export function crewStateTone(input: {
  readonly run: CrewRun | null;
  readonly workingCount: number;
}): ServiceStatusToneId {
  if (input.run?.state === "running" || input.run?.state === "finishing") return "busy";
  if (input.run?.state === "paused") return "attention";
  return input.workingCount === 0 ? "off" : "busy";
}

export type CrewAttentionAction =
  | { readonly kind: "answer"; readonly label: string }
  | { readonly kind: "ask"; readonly label: string; readonly ask: string }
  | { readonly kind: "board"; readonly label: string }
  | { readonly kind: "command"; readonly label: string; readonly command: CrewCommand };

function displayName(crewmates: ReadonlyArray<Crewmate>, handle: string | null): string {
  if (handle === null) return "the crew";
  return crewmates.find((mate) => mate.handle === handle)?.displayName ?? `@${handle}`;
}

/**
 * What a *Waiting on you* row lets you press, in order — never a press that
 * could do nothing: *Review plan* only where a board opens, *Answer* only for
 * a crewmate's question.
 */
export function crewAttentionActions(
  row: CrewAttention,
  crew: Pick<CrewSnapshot, "crewmates">,
  can: { readonly board: boolean },
): ReadonlyArray<CrewAttentionAction> {
  const name = displayName(crew.crewmates, row.handle);
  switch (row.kind) {
    case "question":
      return row.handle === null ? [] : [{ kind: "answer", label: CREW_ATTENTION_VERBS.answer }];
    case "landing-wait":
      return [
        {
          kind: "ask",
          label: CREW_ATTENTION_VERBS.commitEdit,
          ask: crewCommitEditAsk(row.paths),
        },
      ];
    case "ready-to-land":
      return row.taskId === null
        ? []
        : [
            {
              kind: "command",
              label: CREW_ATTENTION_VERBS.land,
              command: { _tag: "land", taskId: row.taskId },
            },
          ];
    case "plan":
      return can.board ? [{ kind: "board", label: CREW_ATTENTION_VERBS.reviewPlan }] : [];
    case "show-on-dev":
      return row.host === null
        ? []
        : [
            {
              kind: "command",
              label: CREW_ATTENTION_VERBS.allow,
              command: { _tag: "claimGrant", host: row.host },
            },
            {
              kind: "command",
              label: CREW_ATTENTION_VERBS.notNow,
              command: { _tag: "claimDeny", host: row.host },
            },
          ];
    case "conflict":
      return row.taskId === null
        ? []
        : [
            {
              kind: "command",
              label: crewAskToResolveWord(name),
              command: { _tag: "askResolve", taskId: row.taskId },
            },
          ];
    case "check-failed":
      return row.taskId === null
        ? []
        : [
            {
              kind: "command",
              label: crewAskToFixWord(name),
              command: { _tag: "askFix", taskId: row.taskId },
            },
          ];
    case "parked":
    case "cant-start":
      return [];
  }
}

/** What a dev service serves, and whether *Back to my tree* applies; nothing while unknown. */
export function crewServedLine(
  host: CrewHost,
  crewmates: ReadonlyArray<Crewmate>,
): { readonly text: string; readonly release: boolean } | null {
  const text = crewServedWord(host, crewmates);
  return text === null ? null : { text, release: host.served.by === "crewmate" };
}

export interface CrewFace {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  /** Its thread's face; idle before its first turn. */
  readonly state: MateMarkState;
  readonly threadId: ThreadId | null;
}

/** The sidebar Mate row's crew faces (PRD §4.2): at most `max`, the lead first, and how many more. */
export function crewFaceStack(
  crewmates: ReadonlyArray<CrewmateView>,
  max = 3,
): { readonly faces: ReadonlyArray<CrewFace>; readonly more: number } {
  return {
    faces: crewmates.slice(0, max).map((row) => ({
      handle: row.crewmate.handle,
      displayName: row.crewmate.displayName,
      tint: row.crewmate.tint,
      state: row.status === null ? "idle" : mateMarkStateForThreadStatus(row.status.kind),
      threadId: row.crewmate.currentThreadId,
    })),
    more: Math.max(0, crewmates.length - max),
  };
}
