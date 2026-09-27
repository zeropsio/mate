/**
 * The crew's board (PRD §4.4, §6.3) as the panel draws it: its columns, the
 * lead's plan at the top of *Waiting on you*, and one card per task.
 *
 * Pure: every word comes from the crew phrases (`crewTaskWord` through the
 * view, `CREW_BOARD_COLUMNS`) or from the one status resolver through the
 * owner's thread (R5); this module only arranges them.
 */
import {
  CREW_BOARD_COLUMNS,
  crewAttentionSentence,
  crewCheckWord,
  crewDiffStatWord,
  crewQueuedReason,
  crewTaskSourceWord,
  type CrewBoardColumnId,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type {
  CrewmateView,
  CrewTaskView,
  CrewView,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { statusPulses } from "@t3tools/client-runtime/zerops/statusPresentation";
import type {
  CrewCheck,
  CrewCommand,
  CrewReview,
  CrewSnapshot,
  CrewTask,
  CrewTint,
  ThreadId,
} from "@t3tools/contracts";
import type { MateMarkState, ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  mateMarkStateForThreadStatus,
  type ThreadStatusToneId,
} from "@t3tools/shared/threadStatus";

/** A crewmate as a card names it: its face in its tint, wearing its thread's state. */
export interface CrewBoardFace {
  readonly handle: string;
  /** Its display name; `@handle` for an owner no longer on the crew. */
  readonly name: string;
  /** `null` for an owner no longer on the crew, which has no face to draw. */
  readonly tint: CrewTint | null;
  readonly face: MateMarkState;
}

/** A status word in the `StatusDot` tone it wears. */
export interface CrewBoardStatus {
  readonly word: string;
  readonly tone: ServiceStatusToneId;
  readonly pulse: boolean;
}

export interface CrewBoardCard {
  readonly taskId: string;
  readonly number: number;
  readonly title: string;
  readonly owner: CrewBoardFace;
  /** `null` for a working task whose owner's thread has no word (idle): a dot never stands alone. */
  readonly status: CrewBoardStatus | null;
  /** The question, the check, the change or the landing commit, where the task came from, and its note. */
  readonly detail: string;
}

export interface CrewBoardColumn {
  readonly id: CrewBoardColumnId;
  readonly title: string;
  /** Its cards, the plan counted as one. */
  readonly count: number;
  readonly cards: ReadonlyArray<CrewBoardCard>;
}

export interface CrewPlanRow {
  readonly taskId: string;
  readonly number: number;
  readonly title: string;
  readonly owner: CrewBoardFace;
  /** `after #13` while a dependency has not landed. */
  readonly after: string | null;
}

/** The lead's proposed tasks as one card at the top of *Waiting on you* (PRD §4.6, §5.4). */
export interface CrewPlanCard {
  readonly title: string;
  /** The plan's *Waiting on you* sentence; `null` while no such row stands. */
  readonly sentence: string | null;
  readonly rows: ReadonlyArray<CrewPlanRow>;
}

export interface CrewBoardHeader {
  readonly briefTitle: string;
  /** The crew state word (`crewStateWord`), steady: a run lasts hours. */
  readonly state: CrewBoardStatus;
}

export interface CrewBoardModel {
  readonly header: CrewBoardHeader;
  /** A run is running or paused: a plan's Start accepts it at once, else it opens the run dialog first. */
  readonly runOn: boolean;
  readonly columns: ReadonlyArray<CrewBoardColumn>;
  /** `null` while nothing is proposed — always so in a crew without a lead. */
  readonly plan: CrewPlanCard | null;
}

/** The thread's tone as a dot: whatever waits on you is one amber, the word says why. */
const THREAD_DOT_TONE: Readonly<Record<ThreadStatusToneId, ServiceStatusToneId>> = {
  attention: "attention",
  input: "attention",
  plan: "attention",
  active: "busy",
  danger: "failed",
  success: "ok",
  neutral: "off",
};

/** A task's dot by its state; a working task's is its owner's thread's instead. */
const TASK_DOT_TONE: Readonly<Record<Exclude<CrewTask["state"], "working">, ServiceStatusToneId>> =
  {
    proposed: "attention",
    queued: "off",
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

export function crewBoardFace(handle: string, owner: CrewmateView | null): CrewBoardFace {
  if (owner === null) return { handle, name: `@${handle}`, tint: null, face: "idle" };
  return {
    handle,
    name: owner.crewmate.displayName,
    tint: owner.crewmate.tint,
    face: owner.status === null ? "idle" : mateMarkStateForThreadStatus(owner.status.kind),
  };
}

export function crewTaskStatus(row: CrewTaskView): CrewBoardStatus | null {
  const thread = row.owner?.status ?? null;
  if (row.word === null) return null;
  if (row.task.state === "working") {
    // The view gives a working task a word only from its owner's thread.
    return thread === null
      ? null
      : { word: row.word, tone: THREAD_DOT_TONE[thread.toneId], pulse: statusPulses(thread.kind) };
  }
  const tone = TASK_DOT_TONE[row.task.state];
  return { word: row.word, tone, pulse: tone === "busy" };
}

function detailLine(task: CrewTask): string {
  if (task.state === "landed" && task.landedCommit !== null) return task.landedCommit;
  const parts: Array<string> = [];
  if (task.check?.state === "failed") parts.push(crewCheckWord(task.check));
  if (task.state === "blocked" && task.question !== null) parts.push(task.question);
  else if (task.diffStat !== null) parts.push(crewDiffStatWord(task.diffStat));
  parts.push(crewTaskSourceWord(task.source));
  if (task.note !== null) parts.push(task.note);
  return parts.join(" · ");
}

function boardCard(row: CrewTaskView): CrewBoardCard {
  return {
    taskId: row.task.id,
    number: row.task.number,
    title: row.task.title,
    owner: crewBoardFace(row.task.owner, row.owner),
    status: crewTaskStatus(row),
    detail: detailLine(row.task),
  };
}

function planCard(
  snapshot: CrewSnapshot,
  proposed: ReadonlyArray<CrewTaskView>,
): CrewPlanCard | null {
  if (proposed.length === 0) return null;
  const attention = snapshot.attention.find((row) => row.kind === "plan");
  return {
    title: `Plan · ${proposed.length} ${proposed.length === 1 ? "task" : "tasks"}`,
    sentence: attention === undefined ? null : crewAttentionSentence(attention, snapshot),
    rows: proposed.map(({ task, owner }) => ({
      taskId: task.id,
      number: task.number,
      title: task.title,
      owner: crewBoardFace(task.owner, owner),
      // A plan row names only its dependency: its owner's current task is no reason yet.
      after: crewQueuedReason(task, { tasks: snapshot.board.tasks, ownerOpenTaskId: null }),
    })),
  };
}

/** A run on is busy, a paused one waits on you; without one, the crew is busy while anyone works. */
function crewStateTone(snapshot: CrewSnapshot, view: CrewView): ServiceStatusToneId {
  switch (snapshot.run?.state) {
    case "running":
    case "finishing":
      return "busy";
    case "paused":
      return "attention";
    default:
      return view.workingCount > 0 ? "busy" : "off";
  }
}

export function crewBoardModel(snapshot: CrewSnapshot, view: CrewView): CrewBoardModel {
  const proposed = view.tasks.filter((row) => row.task.state === "proposed");
  const hasReviewer = view.crewmates.some((row) => row.crewmate.kind !== "writer");
  const columns = CREW_BOARD_COLUMNS.flatMap(({ id, title }): ReadonlyArray<CrewBoardColumn> => {
    const cards = view.tasks
      .filter((row) => row.column === id && row.task.state !== "proposed")
      .map(boardCard);
    // In review exists with someone to review; a task that sits there anyway is never hidden.
    if (id === "in-review" && !hasReviewer && cards.length === 0) return [];
    const plan = id === "waiting-on-you" && proposed.length > 0 ? 1 : 0;
    return [{ id, title, count: cards.length + plan, cards }];
  });
  return {
    runOn: snapshot.run?.state === "running" || snapshot.run?.state === "paused",
    header: {
      briefTitle: snapshot.crew?.briefTitle ?? "",
      state: { word: view.stateWord, tone: crewStateTone(snapshot, view), pulse: false },
    },
    columns,
    plan: planCard(snapshot, proposed),
  };
}

const CHECK_DOT_TONE: Readonly<Record<CrewCheck["state"], ServiceStatusToneId>> = {
  running: "busy",
  passed: "ok",
  failed: "failed",
};

/** A press on a task's sheet, with the command it sends. */
export interface CrewTaskAction {
  readonly label: string;
  readonly tone: "primary" | "secondary" | "outline";
  readonly command: CrewCommand;
}

/** A task's sheet (PRD §4.4): what it asks, how far it got, and the presses that move it. */
export interface CrewTaskSheet {
  readonly taskId: string;
  readonly heading: string;
  readonly title: string;
  readonly owner: CrewBoardFace;
  readonly status: CrewBoardStatus | null;
  readonly source: string;
  readonly brief: string;
  /** `null` when none was given. */
  readonly doneWhen: string | null;
  /** The card's note: for a fan-out task, who else got the message and which part is this one (PRD §5.3). */
  readonly note: string | null;
  readonly attempts: string;
  readonly report: string | null;
  readonly check: {
    readonly word: string;
    readonly tone: ServiceStatusToneId;
    readonly output: string;
  } | null;
  readonly review: string | null;
  readonly changes: string | null;
  readonly landedCommit: string | null;
  /** The owner's current conversation; `null` before its first turn or for an owner gone from the crew. */
  readonly ownerThreadId: ThreadId | null;
  /** Its title, brief and done-when can still change. */
  readonly editable: boolean;
  readonly actions: ReadonlyArray<CrewTaskAction>;
}

/** `Lead: Accepted — note`; your own review is "You". */
function reviewLine(review: CrewReview, view: CrewView): string {
  const reviewer =
    review.by === null
      ? "You"
      : (view.crewmates.find((row) => row.crewmate.handle === review.by)?.crewmate.displayName ??
        `@${review.by}`);
  const verdict = review.verdict === "accept" ? "Accepted" : "Rejected";
  return review.note === ""
    ? `${reviewer}: ${verdict}`
    : `${reviewer}: ${verdict} — ${review.note}`;
}

/**
 * The presses a task's state allows (PRD §5.2): *Land* once it is ready, *Land
 * now* on a change its crewmate never reported, a turn as you to resolve a
 * conflict or fix a failed check, and *Discard* until it has landed.
 */
function taskActions(row: CrewTaskView): ReadonlyArray<CrewTaskAction> {
  const { task, owner } = row;
  if (task.state === "landed" || task.state === "discarded") return [];
  const taskId = task.id;
  const name = crewBoardFace(task.owner, owner).name;
  const conflicted =
    owner !== null &&
    owner.crewmate.openTaskId === taskId &&
    owner.crewmate.lane?.state === "conflicts";
  const actions: Array<CrewTaskAction> = [];
  if (task.state === "ready") {
    actions.push({ label: "Land", tone: "primary", command: { _tag: "land", taskId } });
  } else if (task.state === "working" && task.diffStat !== null && !conflicted) {
    actions.push({ label: "Land now", tone: "secondary", command: { _tag: "landNow", taskId } });
  }
  if (conflicted) {
    actions.push({
      label: `Ask ${name} to resolve`,
      tone: "secondary",
      command: { _tag: "askResolve", taskId },
    });
  }
  if (task.check?.state === "failed") {
    actions.push({
      label: `Ask ${name} to fix`,
      tone: "secondary",
      command: { _tag: "askFix", taskId },
    });
  }
  actions.push({ label: "Discard", tone: "outline", command: { _tag: "discard", taskId } });
  return actions;
}

/** `Not started`, `Attempt 2`; a queued task's with what it waits for (`· waits for #13`). */
function attemptsLine(task: CrewTask, owner: CrewmateView | null, tasks: ReadonlyArray<CrewTask>) {
  const attempts = task.attempts === 0 ? "Not started" : `Attempt ${task.attempts}`;
  if (task.state !== "queued") return attempts;
  const reason = crewQueuedReason(task, {
    tasks,
    ownerOpenTaskId: owner?.crewmate.openTaskId ?? null,
  });
  return reason === null ? attempts : `${attempts} · ${reason}`;
}

export function crewTaskSheet(
  snapshot: CrewSnapshot,
  view: CrewView,
  taskId: string,
): CrewTaskSheet | null {
  const row = view.tasks.find((candidate) => candidate.task.id === taskId);
  if (row === undefined) return null;
  const { task, owner } = row;
  return {
    taskId: task.id,
    heading: `#${task.number} ${task.title}`,
    title: task.title,
    owner: crewBoardFace(task.owner, owner),
    status: crewTaskStatus(row),
    source: crewTaskSourceWord(task.source),
    brief: task.brief,
    doneWhen: task.doneWhen === "" ? null : task.doneWhen,
    note: task.note,
    attempts: attemptsLine(task, owner, snapshot.board.tasks),
    report: task.report,
    check:
      task.check === null
        ? null
        : {
            word: crewCheckWord(task.check),
            tone: CHECK_DOT_TONE[task.check.state],
            output: task.check.output,
          },
    review: task.review === null ? null : reviewLine(task.review, view),
    changes: task.diffStat === null ? null : crewDiffStatWord(task.diffStat),
    landedCommit: task.landedCommit,
    ownerThreadId: owner?.crewmate.currentThreadId ?? null,
    editable: task.state !== "landed",
    actions: taskActions(row),
  };
}

/** Who a new task can go to: every crewmate but the lead, which plans rather than takes tasks. */
export function crewTaskOwners(view: CrewView): ReadonlyArray<CrewBoardFace> {
  return view.crewmates
    .filter((row) => row.crewmate.kind !== "lead")
    .map((row) => crewBoardFace(row.crewmate.handle, row));
}

/** What a new task can wait for: every task on the board that has not landed yet. */
export function crewDependencyOptions(
  view: CrewView,
): ReadonlyArray<{ readonly taskId: string; readonly label: string }> {
  return view.tasks
    .filter((row) => row.task.state !== "landed")
    .map(({ task }) => ({ taskId: task.id, label: `#${task.number} ${task.title}` }));
}

export interface CrewNewTaskDraft {
  readonly owner: string | null;
  readonly title: string;
  readonly brief: string;
  readonly doneWhen: string;
  readonly dependsOn: ReadonlyArray<string>;
}

/** *+ New task*'s command; `null` until it has an owner and a title. */
export function crewNewTaskCommand(draft: CrewNewTaskDraft): CrewCommand | null {
  const title = draft.title.trim();
  if (draft.owner === null || title === "") return null;
  return {
    _tag: "taskCreate",
    owner: draft.owner,
    title,
    brief: draft.brief.trim(),
    doneWhen: draft.doneWhen.trim(),
    dependsOn: draft.dependsOn,
  };
}

export interface CrewTaskEditDraft {
  readonly title: string;
  readonly brief: string;
  readonly doneWhen: string;
}

/** A sheet's edit as `taskEdit` with only the fields that changed; `null` when none did or the title is blank. */
export function crewTaskEditCommand(task: CrewTask, draft: CrewTaskEditDraft): CrewCommand | null {
  const title = draft.title.trim();
  const brief = draft.brief.trim();
  const doneWhen = draft.doneWhen.trim();
  if (title === "") return null;
  const changed = {
    ...(title === task.title ? {} : { title }),
    ...(brief === task.brief ? {} : { brief }),
    ...(doneWhen === task.doneWhen ? {} : { doneWhen }),
  };
  return Object.keys(changed).length === 0
    ? null
    : { _tag: "taskEdit", taskId: task.id, ...changed };
}

/** The plan card's Start (`planAccept`) or a discard of its rows; `null` for no rows. */
export function crewPlanCommand(
  tag: "planAccept" | "planDiscard",
  taskIds: ReadonlyArray<string>,
): CrewCommand | null {
  const [first, ...rest] = taskIds;
  return first === undefined ? null : { _tag: tag, taskIds: [first, ...rest] };
}
