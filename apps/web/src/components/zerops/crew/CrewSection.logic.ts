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
  CREW_BRIEF_EMPTY_WORD,
  CREW_CARRY_ON_MESSAGE,
  CREW_LANE_VERBS,
  crewBriefPlainText,
  CREW_IDLE_WORD,
  crewAskToFixWord,
  crewAskToResolveWord,
  crewCommitEditAsk,
  crewServedWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { CREW_BRIEF_TEMPLATE } from "@t3tools/shared/crewTemplates";
import type {
  CrewAttention,
  CrewCommand,
  CrewHost,
  CrewLogin,
  CrewRun,
  CrewSnapshot,
  CrewSummary,
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

const TEMPLATE_BRIEF_OPENING = crewBriefPlainText(CREW_BRIEF_TEMPLATE).split("\n")[0];

/**
 * The Brief row's text: the brief's first lines as plain text, or — while the
 * brief is still the template's placeholder, or empty — a prompt to write it.
 */
export function crewBriefLine(crew: Pick<CrewSummary, "briefExcerpt">): {
  readonly placeholder: boolean;
  readonly text: string;
} {
  const text = crewBriefPlainText(crew.briefExcerpt);
  return text === "" || text.split("\n")[0] === TEMPLATE_BRIEF_OPENING
    ? { placeholder: true, text: CREW_BRIEF_EMPTY_WORD }
    : { placeholder: false, text };
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

/**
 * *Start run* (C, PRD §4.3 item 1): offered while no run is on or finishing,
 * and only to a crew a run can move — one with a lead to plan, or tasks queued.
 */
export function crewOffersStart(view: CrewView, run: CrewRun | null): boolean {
  const idle = run === null || run.state === "finished" || run.state === "stopped";
  return idle && (view.lead !== null || view.tasks.some((row) => row.task.state === "queued"));
}

/**
 * Where a press came from, so its refusal shows beside it
 * (`useCrewCommand`'s `origin`): the run controls, *Deliver*, *Add crew
 * ports*, one *Waiting on you* row, one crewmate row, one dev service's line.
 */
export const CREW_ORIGIN = {
  run: "run",
  deliver: "deliver",
  ports: "ports",
  attention: (id: string) => `attention:${id}`,
  crewmate: (handle: string) => `crewmate:${handle}`,
  host: (host: string) => `host:${host}`,
} as const;

export type CrewAttentionAction =
  | { readonly kind: "answer"; readonly label: string }
  | { readonly kind: "ask"; readonly label: string; readonly ask: string }
  | { readonly kind: "board"; readonly label: string }
  | { readonly kind: "chat"; readonly label: string; readonly threadId: ThreadId }
  | { readonly kind: "command"; readonly label: string; readonly command: CrewCommand };

function displayName(crewmates: ReadonlyArray<Crewmate>, handle: string | null): string {
  if (handle === null) return "the crew";
  return crewmates.find((mate) => mate.handle === handle)?.displayName ?? `@${handle}`;
}

/**
 * What a *Waiting on you* row lets you press, in order — never a press that
 * could do nothing: *Review plan* only where a board opens, *Answer* only for
 * a crewmate's question — in the lead's chat for the lead's own, inline for a
 * task's, or while the lead has no chat yet.
 */
export function crewAttentionActions(
  row: CrewAttention,
  crew: Pick<CrewSnapshot, "crewmates" | "hosts">,
  can: { readonly board: boolean },
): ReadonlyArray<CrewAttentionAction> {
  const name = displayName(crew.crewmates, row.handle);
  switch (row.kind) {
    case "question": {
      if (row.handle === null) return [];
      // The lead's own question (no task) is answered in its chat, where it asked.
      const threadId =
        row.taskId === null
          ? (crew.crewmates.find((mate) => mate.handle === row.handle)?.currentThreadId ?? null)
          : null;
      return threadId === null
        ? [{ kind: "answer", label: CREW_ATTENTION_VERBS.answer }]
        : [{ kind: "chat", label: CREW_ATTENTION_VERBS.answer, threadId }];
    }
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
    case "show-on-dev": {
      if (row.host === null) return [];
      const notNow: CrewAttentionAction = {
        kind: "command",
        label: CREW_ATTENTION_VERBS.notNow,
        command: { _tag: "claimDeny", host: row.host },
      };
      // Already allowed and waiting on the crewmate's turn: Not now cancels it.
      const waiting =
        crew.hosts.find((host) => host.host === row.host)?.claim.grantWaiting === true;
      return waiting
        ? [notNow]
        : [
            {
              kind: "command",
              label: CREW_ATTENTION_VERBS.allow,
              command: { _tag: "claimGrant", host: row.host },
            },
            notNow,
          ];
    }
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
    case "cant-start":
      // The engine starts the queued task again, admission and all.
      return row.taskId === null
        ? []
        : [
            {
              kind: "command",
              label: CREW_ATTENTION_VERBS.tryAgain,
              command: { _tag: "taskRetry", taskId: row.taskId },
            },
          ];
    case "parked":
      return [];
    case "stalled":
      // Its queue waits behind it: carry it on as you, land it as it stands, or drop it.
      return row.taskId === null || row.handle === null
        ? []
        : [
            {
              kind: "command",
              label: CREW_ATTENTION_VERBS.carryOn,
              command: {
                _tag: "message",
                handle: row.handle,
                text: CREW_CARRY_ON_MESSAGE,
                attachments: [],
              },
            },
            {
              kind: "command",
              label: CREW_LANE_VERBS.landNow,
              command: { _tag: "landNow", taskId: row.taskId },
            },
            {
              kind: "command",
              label: CREW_ATTENTION_VERBS.discard,
              command: { _tag: "discard", taskId: row.taskId },
            },
          ];
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
