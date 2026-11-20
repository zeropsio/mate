/**
 * A task's way from a passed check to your tree: the merge-in, the review verdict, a landing and the presses that ask for one.
 *
 * @module crew/engine/decide.land
 */
import { type Principal } from "@t3tools/contracts";
import { type DeliverCommand, taskAssignment } from "./command.ts";
import { type TaskPatch } from "./events.ts";
import {
  copyBusy,
  copyWriting,
  hostFrozen,
  isWorking,
  laneShown,
  leadReviews,
  type CrewState,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";
import {
  ON_DEV,
  INDEX_LOCK,
  busyWords,
  wrongState,
  type Builder,
  step,
  stepOrRefuse,
  requireFreeCopy,
} from "./decide.step.ts";
import { checkpoint, deliver } from "./decide.turns.ts";

/** How long a task stands with nobody acting on it before it waits on the person. */
export const UNATTENDED_MS = 5 * 60_000;

/** Why a ready task cannot land now, in the words a press is refused with. */
const landHold = (state: CrewState, task: TaskRecord): string | undefined => {
  const member = state.members[task.owner];
  if (state.mate.runId !== null) return "a chat of this Mate is working; land between its turns";
  if (member !== undefined && hostFrozen(state, member.host))
    return `${member.host} is redeploying`;
  if (laneShown(state, task.owner)) return ON_DEV;
  if (copyBusy(state, task.owner)) return busyWords(task.owner);
  return undefined;
};

/**
 * Lands a ready task as `principal`. A press is refused in the hold's words; a landing the run or
 * an earlier press asked for waits for the hold to clear and says why once: in the crew log and
 * as the section's last error.
 */
export const land = (
  b: Builder,
  task: TaskRecord,
  principal: Principal,
  by: "press" | "run" | "press-later",
): void => {
  if (by !== "press" && b.state.heldLandings[task.id] === INDEX_LOCK) return;
  const hold = landHold(b.state, task);
  if (hold !== undefined) {
    if (by === "press") throw wrongState(hold);
    if (b.state.heldLandings[task.id] !== hold) {
      b.emit({ _tag: "LandingHeld", taskId: task.id, words: hold });
      b.emit({ _tag: "ErrorNoted", text: `#${task.number} waits to land: ${hold}` });
    }
    return;
  }
  const member = b.member(task.owner);
  const landing = step(
    b,
    task,
    {
      type: "land",
      facts: { personTurnRunning: false, hostFrozen: false, laneShown: false, lockTaken: true },
    },
    { landAs: principal },
  );
  if (landing === undefined) {
    if (by === "press") throw wrongState(`#${task.number} is ${task.state}`);
    return;
  }
  if (b.state.heldLandings[task.id] !== undefined) {
    b.emit({ _tag: "LandingHeld", taskId: task.id, words: null });
  }
  if (member.kind !== "writer") {
    const done = step(
      b,
      landing,
      { type: "fast-forward" },
      {
        landedCommit: null,
        landedAt: b.now,
        wait: null,
        landAs: null,
      },
    );
    if (done !== undefined)
      seam(b, member, { seam: "closed", taskId: done.id, number: done.number });
    return;
  }
  b.effect(
    {
      kind: "crew.land",
      handle: member.handle,
      taskId: task.id,
      attempt: task.counters.attempt,
      title: task.title,
      checkedTip: task.check?.tip ?? null,
      assignment: taskAssignment(task),
    },
    member.handle,
    { handle: member.handle, taskId: task.id, attempt: task.counters.attempt },
  );
};

export const seam = (
  b: Builder,
  member: MemberRecord,
  value: Extract<DeliverCommand, { _tag: "Seam" }>["seam"],
  words?: string,
): void => {
  deliver(
    b,
    member,
    { _tag: "Seam", seam: value, ...(words === undefined ? {} : { words }) },
    { purpose: "seam", taskId: null, principal: { kind: "engine" }, text: null },
  );
};

/** Merges your tree's head into the copy, once nothing else runs the copy's check. */
export const mergeIn = (b: Builder, task: TaskRecord): void => {
  const member = b.member(task.owner);
  if (member.kind !== "writer") {
    const clean = step(b, task, { type: "merge-clean" });
    if (clean !== undefined) checkPassed(b, clean);
    return;
  }
  const pending = Object.values(b.state.effects).some(
    (effect) =>
      effect.handle === member.handle &&
      (effect.kind === "crew.mergeIn" || effect.kind === "crew.check"),
  );
  if (pending) return;
  b.effect(
    {
      kind: "crew.mergeIn",
      handle: member.handle,
      taskId: task.id,
      attempt: task.counters.attempt,
    },
    member.handle,
    { handle: member.handle, taskId: task.id, attempt: task.counters.attempt },
  );
};

/** A passed check: the lead's review first in a run it lands after, else ready. */
export const checkPassed = (b: Builder, task: TaskRecord, set: TaskPatch = {}): void => {
  const reviewed = leadReviews(b.state) && task.review?.verdict !== "accept";
  const done = step(b, task, { type: "check-passed", reviewed }, set);
  if (done?.state === "review") unattended(b, done);
};

export const unattended = (b: Builder, task: TaskRecord): void => {
  b.arm("unattended", task.id, b.now + UNATTENDED_MS, { kind: "engine" });
};

/** A verdict on a task in review: the lead's, a reader's (`by`), or the person's (`null`). */
export const reviewTask = (
  b: Builder,
  task: TaskRecord,
  verdict: "accept" | "reject",
  note: string,
  by: string | null,
): TaskRecord => {
  const review = { verdict, note, by };
  b.cancel("unattended", task.id, "reviewed");
  return verdict === "accept"
    ? stepOrRefuse(b, task, { type: "review-accepted" }, { review })
    : stepOrRefuse(
        b,
        task,
        { type: "review-rejected" },
        {
          review,
          wait: { on: "review", reason: note, paths: [] },
        },
      );
};

/** *Land*: from review, your accept first; from waiting on your tree, a merge again first. */
export const landPress = (b: Builder, task: TaskRecord, as: Principal): void => {
  if (b.state.heldLandings[task.id] === INDEX_LOCK) {
    b.emit({ _tag: "LandingHeld", taskId: task.id, words: null });
  }
  if (task.state === "review") {
    const accepted = reviewTask(b, task, "accept", "", null);
    return land(b, accepted, as, "press");
  }
  if (task.state === "waiting-on-you") {
    requireFreeCopy(b, task.owner);
    const merging = stepOrRefuse(b, task, { type: "tree-clean" }, { wait: null, landAs: as });
    mergeIn(b, merging);
    return;
  }
  if (task.state !== "ready") throw wrongState(`#${task.number} is ${task.state}`);
  land(b, task, as, "press");
};

/** *Land* on a task whose crewmate never reported, or one back as rework, as its copy stands. */
export const landNow = (b: Builder, task: TaskRecord, as: Principal): void => {
  if (task.state !== "working" && task.state !== "rework") {
    throw wrongState(`#${task.number} is ${task.state}`);
  }
  const member = b.member(task.owner);
  if (isWorking(b.state, member.handle)) throw wrongState(`@${member.handle}'s turn is running`);
  if (laneShown(b.state, member.handle)) throw wrongState(ON_DEV);
  // A check still running on the copy is no reason to wait: the landing integrates after it.
  if (copyWriting(b.state, member.handle)) throw wrongState(busyWords(member.handle));
  if (member.kind !== "writer") {
    const merging = stepOrRefuse(b, task, { type: "land-now" }, { wait: null, landAs: as });
    mergeIn(b, merging);
    return;
  }
  b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { landAs: as } });
  checkpoint(b, member, b.task(task.id), "land-now");
};
