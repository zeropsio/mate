/**
 * The Crew section's reading of the crew view (PRD §4.3): each crewmate row's
 * state, lead line, copy summary and pending chip; what each *Waiting on you*
 * row lets you press; the footer's lines; and the drafts the section hands Fen.
 *
 * Task and crew state words come from `crew/phrases.ts` through the view, a
 * thread's word from the one status resolver (R5). The few words this file
 * writes itself — the copy summary, the pending chip, the drafts — have no
 * home in the phrase producer yet.
 */
import { crewStateWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type {
  CrewmateView,
  CrewPendingVersions,
  CrewView,
} from "@t3tools/client-runtime/zerops/projections/crew";
import type {
  CrewAttention,
  CrewCommand,
  CrewHost,
  CrewLaneSummary,
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
  return (
    thread ?? { word: crewStateWord({ run: null, workingCount: 0 }), tone: "off", pulse: false }
  );
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

/** The copy of the code in a few words; `null` when there is nothing to say. */
export function crewLaneSummary(lane: CrewLaneSummary | null): string | null {
  if (lane === null) return null;
  switch (lane.state) {
    case "creating":
      return "Creating its copy of the code";
    case "setting-up":
      return lane.detail === null ? "Setting up its copy" : `Running ${lane.detail}`;
    case "conflicts":
      return "Conflicts";
    case "frozen":
      return "Its service is redeploying";
    case "missing":
      return "Its copy is missing";
    case "failed":
      return lane.detail === null ? "Its copy failed" : `Its copy failed: ${lane.detail}`;
    case "ready":
      return lane.ahead === 0 ? null : `${lane.ahead} ahead`;
  }
}

/** "v5 at next turn": the job's version when it changed, else the brief's. */
export function crewPendingChip(pending: CrewPendingVersions | null): string | null {
  if (pending === null) return null;
  if (pending.job !== null) return `v${pending.job} at next turn`;
  return pending.brief === null ? null : `Brief v${pending.brief} at next turn`;
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

/** `a.ts`, `a.ts and b.ts`, `a.ts, b.ts and c.ts`. */
function pathList(paths: ReadonlyArray<string>): string {
  if (paths.length <= 1) return paths[0] ?? "";
  return `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;
}

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
      return row.handle === null ? [] : [{ kind: "answer", label: "Answer" }];
    case "landing-wait":
      return [
        {
          kind: "ask",
          label: "Commit my edit",
          ask:
            row.paths.length > 1
              ? `Commit my edits to ${pathList(row.paths)} locally, without pushing: a crew landing waits on them.`
              : `Commit my edit to ${pathList(row.paths)} locally, without pushing: a crew landing waits on it.`,
        },
      ];
    case "ready-to-land":
      return row.taskId === null
        ? []
        : [{ kind: "command", label: "Land", command: { _tag: "land", taskId: row.taskId } }];
    case "plan":
      return can.board ? [{ kind: "board", label: "Review plan" }] : [];
    case "show-on-dev":
      return row.host === null
        ? []
        : [
            { kind: "command", label: "Allow", command: { _tag: "claimGrant", host: row.host } },
            { kind: "command", label: "Not now", command: { _tag: "claimDeny", host: row.host } },
          ];
    case "conflict":
      return row.taskId === null
        ? []
        : [
            {
              kind: "command",
              label: `Ask ${name} to resolve`,
              command: { _tag: "askResolve", taskId: row.taskId },
            },
          ];
    case "check-failed":
      return row.taskId === null
        ? []
        : [
            {
              kind: "command",
              label: `Ask ${name} to fix`,
              command: { _tag: "askFix", taskId: row.taskId },
            },
          ];
    case "parked":
    case "cant-start":
      return [];
  }
}

/** "appdev serves: your tree", or a crewmate's copy with *Back to my tree*; nothing while unknown. */
export function crewServedLine(
  host: CrewHost,
  crewmates: ReadonlyArray<Crewmate>,
): { readonly text: string; readonly release: boolean } | null {
  switch (host.served.by) {
    case "tree":
      return { text: `${host.host} serves: your tree`, release: false };
    case "crewmate":
      return {
        text: `${host.host} serves: ${displayName(crewmates, host.served.handle)}'s copy`,
        release: true,
      };
    case "unknown":
      return null;
  }
}

/**
 * *Deliver*'s draft (CONCEPT §3.2): the landed tasks not yet delivered, and
 * the paths dirty in your tree that no landing produced, which ship too.
 */
export function crewDeliverAsk(
  crew: Pick<CrewSnapshot, "board" | "hosts">,
  dirtyPaths: ReadonlyArray<string>,
): string {
  const hosts = crew.hosts.map((host) => host.host).join(" and ");
  const titles = crew.board.tasks
    .filter((task) => task.state === "landed" && !task.delivered)
    .map((task) => `#${task.number} ${task.title}`)
    .join(", ");
  const ship = `Ship the crew's landed work${hosts === "" ? "" : ` on ${hosts}`}: ${titles}.`;
  return dirtyPaths.length === 0
    ? ship
    : `${ship} My own edits in ${pathList(dirtyPaths)} ship too.`;
}

/** *Add crew ports*' draft (PRD §5.7), for the ports the engine reserved. */
export function crewPortsAsk(host: string, ports: ReadonlyArray<number>): string {
  const first = ports[0];
  const last = ports.at(-1);
  if (ports.length === 1 && first !== undefined) {
    return `Add crew port ${first} (httpSupport) to ${host}'s dev setup in zerops.yaml, self-deploy ${host}, then make sure the new port is routed on the subdomain.`;
  }
  return `Add crew ports ${first}–${last} (httpSupport) to ${host}'s dev setup in zerops.yaml, self-deploy ${host}, then make sure each new port is routed on the subdomain.`;
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
