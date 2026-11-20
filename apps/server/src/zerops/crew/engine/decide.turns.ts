/**
 * What goes into a crewmate's one conversation: a delivery, a turn, a new session, a task's first turn and its carry-on, and a turn-end save.
 *
 * @module crew/engine/decide.turns
 */
import {
  type ChatAttachment,
  type CrewSessionReason,
  type EffectId,
  type Principal,
  type RunId,
} from "@t3tools/contracts";
import { stintReasonWords } from "../crewCards.ts";
import { CHECKED_STATES } from "../crewMachines.ts";
import { rotationDecision, type RotationMoment, type RotationReason } from "../rotationDecision.ts";
import { carriedCard, taskCard, type SentCard } from "./cards.ts";
import { type DeliverCommand, taskAssignment } from "./command.ts";
import {
  openTaskOf,
  tasksInOrder,
  turnOf,
  type DeliveryPurpose,
  type DeliveryRecord,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";
import {
  ROTATED_TOO_OFTEN,
  type Builder,
  userOf,
  stepOrRefuse,
  park,
  taskRefsOf,
} from "./decide.step.ts";

/** Why a turn a run's pause stopped goes on when the run does. */
export const RUN_PAUSED = "The run was paused, which stopped your last turn; it goes on now.";

/** Why a task left `working` with no turn running goes on when a run starts. */
export const STOPPED_MIDWAY =
  "Your task stopped mid-way, with no turn of yours running; the run carries it on now.";
/** Why a turn a restart cut off goes on. */
/** A died turn's carry-on, in V1's words: its agent continues in the copy it left. */
export const RESTART_CUT = "Continue where you stopped. Your edits remain in your copy.";
/** Why a task goes on in a new session after its context overflowed. */
/** Why an overflow's new session carries its task on, as its card says (V1's stint words). */
export const NEW_SESSION = stintReasonWords(
  "context-overflow",
  { brief: 1, job: 1 },
  { brief: 1, job: 1 },
);

/** A rotation's reason as the crewmate's session boundary records it. */
export const SESSION_REASON: Readonly<Record<RotationReason | "budget", CrewSessionReason>> = {
  "transcript-missing": "context",
  "resume-failed": "context",
  "context-overflow": "context",
  compactions: "context",
  "second-rework": "task",
  "fresh-task": "task",
  "principal-changed": "task",
  "prompt-changed": "job",
  "login-changed": "login",
  "start-fresh": "cleared",
  budget: "budget",
};

/** A crewmate's turn-end or *Land now* save, with what its copy's guards need to know. */
export const checkpoint = (
  b: Builder,
  member: MemberRecord,
  task: TaskRecord,
  purpose: "turn-end" | "land-now",
  extra: Record<string, unknown> = {},
): void => {
  b.effect(
    {
      kind: "crew.checkpoint",
      handle: member.handle,
      taskId: task.id,
      attempt: task.counters.attempt,
      purpose,
      assignment: taskAssignment(task),
      turn: purpose === "land-now" ? 0 : turnOf(task),
      checked: CHECKED_STATES.has(task.state),
      refTasks: tasksInOrder(b.state)
        .filter((each) => each.started)
        .map(taskRefsOf),
    },
    member.handle,
    { handle: member.handle, taskId: task.id, attempt: task.counters.attempt },
    extra,
  );
};

export const deliver = (
  b: Builder,
  member: MemberRecord,
  command: DeliverCommand,
  record: Pick<DeliveryRecord, "purpose" | "taskId" | "principal" | "text"> &
    Partial<Pick<DeliveryRecord, "card">>,
): EffectId => {
  const effectId = b.effect(
    {
      kind: "crew.deliver",
      conversationId: member.conversationId,
      handle: member.handle,
      command,
      principal: record.principal,
    },
    member.handle,
    { handle: member.handle, taskId: record.taskId },
  );
  b.emit({
    _tag: "DeliveryRecorded",
    effectId,
    delivery: {
      handle: member.handle,
      conversationId: member.conversationId,
      runId: null,
      card: null,
      ...record,
    },
  });
  return effectId;
};

/** A turn into the crewmate's conversation: a card, or the person's own words. */
export const sendTurn = (
  b: Builder,
  member: MemberRecord,
  sent: { readonly text: string; readonly card: SentCard["card"] | null },
  principal: Principal,
  purpose: DeliveryPurpose,
  taskId: string | null,
  attachments: ReadonlyArray<ChatAttachment> = [],
  steer?: RunId,
): void => {
  const fresh = b.state.members[member.handle] ?? member;
  if (fresh.session.running === null || fresh.session.principal === null) {
    const applied = b.state.applied;
    b.emit({
      _tag: "CrewmateUpdated",
      handle: member.handle,
      set: {
        session: {
          ...fresh.session,
          running: fresh.session.running ?? {
            brief: applied?.briefVersion ?? 1,
            job: fresh.jobVersion,
          },
          principal: fresh.session.principal ?? userOf(principal),
        },
      },
    });
  }
  deliver(
    b,
    fresh,
    {
      _tag: "Send",
      text: sent.text,
      card: sent.card,
      principal,
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(steer === undefined ? {} : { steer }),
    },
    { purpose, taskId, principal, text: sent.text, card: sent.card },
  );
};

/** A new session in the crewmate's one conversation, between turns. */
export const rotateSession = (
  b: Builder,
  member: MemberRecord,
  rotation: RotationReason | "budget",
  principal: Principal,
): void => {
  const fresh = rotation !== "budget";
  b.emit({
    _tag: "SessionRotated",
    handle: member.handle,
    reason: SESSION_REASON[rotation],
    rotation,
    fresh,
  });
  deliver(
    b,
    member,
    {
      _tag: "RotateSession",
      reason: SESSION_REASON[rotation],
      fresh,
      seed: null,
      packet: { handle: member.handle, taskId: openTaskOf(b.state, member.handle)?.id ?? null },
    },
    { purpose: "rotate", taskId: null, principal, text: null },
  );
};

/**
 * The rotation a turn's start finds due (`rotationDecision`): a new session first, counted toward
 * the attempt when the engine's own trigger asked for it; `false` when the task stopped instead.
 */
/**
 * Rotates the crewmate's session when its moment calls for it: `false` when the task parked
 * instead, else why a fresh session opened (its seam words), or `null` when none did.
 */
const rotateIfDue = (
  b: Builder,
  member: MemberRecord,
  moment: RotationMoment,
  task: TaskRecord | undefined,
  principal: Principal,
): false | { readonly fresh: string | null } => {
  const applied = b.state.applied;
  if (applied === null) return { fresh: null };
  const current = { brief: applied.briefVersion, job: member.jobVersion };
  const user = userOf(principal);
  const decision = rotationDecision({
    moment,
    transcriptMissing: false,
    resumeFailed: false,
    compactions: member.session.compactions,
    rotateAfter: member.rotateAfter,
    // A session serves whoever's work comes to it: no principal rotation (V1's rule).
    stintPrincipal: user,
    principal: user,
    running: member.session.running ?? current,
    current,
    ...(member.apply === null ? {} : { apply: member.apply }),
    stintLogin: member.session.login,
    login: member.login,
    freshTask: moment === "task-start" && task?.fresh === true,
    startFresh: false,
    rotationsThisAttempt: task?.counters.rotations ?? 0,
  });
  if (decision.kind === "park") {
    if (task !== undefined) park(b, task, ROTATED_TOO_OFTEN);
    return false;
  }
  if (decision.kind !== "rotate") return { fresh: null };
  if (decision.counted && task !== undefined) {
    b.emit({
      _tag: "TaskUpdated",
      taskId: task.id,
      set: { counters: { ...task.counters, rotations: task.counters.rotations + 1 } },
    });
  }
  rotateSession(b, member, decision.reason, principal);
  return { fresh: stintReasonWords(decision.reason, member.session.running ?? current, current) };
};

/** A task's first turn: its copy reset (a writer's), then its card, admitted as `principal`. */
export const startTask = (
  b: Builder,
  task: TaskRecord,
  principal: Principal,
  ownCall: boolean,
  attachments: ReadonlyArray<ChatAttachment> = [],
): void => {
  const member = b.member(task.owner);
  if (rotateIfDue(b, member, "task-start", task, principal) === false) return;
  b.emit({
    _tag: "TaskUpdated",
    taskId: task.id,
    set: {
      starting: { principal, ownCall, ...(attachments.length === 0 ? {} : { attachments }) },
    },
  });
  if (member.kind === "writer") {
    b.effect(
      {
        kind: "crew.lane.reset",
        handle: member.handle,
        taskId: task.id,
        attempt: task.counters.attempt,
      },
      member.handle,
      { handle: member.handle, taskId: task.id, attempt: task.counters.attempt },
    );
    return;
  }
  sendTurn(b, member, taskCard(b.task(task.id), null), principal, "task", task.id, attachments);
};

/**
 * A further turn of an open task as `principal`: a message, an answer, *Ask to fix*, a run's own
 * rework, nudge or carry-on. The task steps as a message does (a rework's turn opens its next
 * attempt), then the turn goes, after a new session when one is due.
 */
export const continueTask = (
  b: Builder,
  task: TaskRecord,
  principal: Principal,
  sent: { readonly text: string; readonly card: SentCard["card"] | null },
  purpose: DeliveryPurpose,
  attachments: ReadonlyArray<ChatAttachment> = [],
): void => {
  const member = b.member(task.owner);
  const rotated = rotateIfDue(b, member, "turn-start", task, principal);
  if (rotated === false) return;
  const reworked = task.state === "rework";
  const moved = stepOrRefuse(
    b,
    b.task(task.id),
    { type: "message" },
    {
      midway: null,
      ...(reworked
        ? { wait: null, review: task.review?.verdict === "accept" ? null : task.review }
        : {}),
    },
  );
  // A rework past its cap stopped the task instead: nothing goes to its crewmate.
  if (moved.state !== "working") return;
  // A new session starts from its task's card, which says why the session is new.
  const carried =
    rotated.fresh !== null && sent.card === null
      ? carriedCard(moved, rotated.fresh, sent.text)
      : sent;
  sendTurn(b, b.member(task.owner), carried, principal, purpose, moved.id, attachments);
};
