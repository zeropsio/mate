/**
 * How the crew advances after every accepted input: each free crewmate's open task goes on or its next starts, and the run's clock and limits follow.
 *
 * @module crew/engine/decide.advance
 */
import { type Principal } from "@t3tools/contracts";
import { continueCard, fixCard, nudgeCard, resolveCard, reworkCard } from "./cards.ts";
import {
  hostFrozen,
  isFree,
  membersInOrder,
  openTaskOf,
  runningRun,
  tasksOf,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";
import { type Builder, crewAs, dispatchPrincipal, landed } from "./decide.step.ts";
import { rotateSession, startTask, continueTask } from "./decide.turns.ts";
import { land } from "./decide.land.ts";
import { wakeLead, checkLimits, followClock } from "./decide.run.ts";
import { claimTurn } from "./decide.claims.ts";

/**
 * Starts the crewmate's oldest queued task whose dependencies landed, when it is free: a press
 * names its own task, which then starts as the presser; every other starts as the running run's
 * starter, or without a run as its creator. The lead's plan starts only in a running run, and a
 * start admission refused waits for *Try again* or a sign-in.
 */
export const pump = (
  b: Builder,
  handle: string,
  own?: { readonly taskId: string; readonly principal: Principal },
): void => {
  const member = b.state.members[handle];
  if (member === undefined || member.kind === "lead" || !isFree(b.state, handle)) return;
  if (openTaskOf(b.state, handle) !== undefined) return;
  if (hostFrozen(b.state, member.host)) return;
  if (member.lane !== null && member.lane.state !== "ready") return;
  const run = runningRun(b.state);
  const startable = tasksOf(b.state, handle).filter(
    (task) =>
      task.state === "queued" &&
      task.starting === null &&
      task.cantStart === null &&
      (task.source !== "lead" || run !== undefined) &&
      task.dependsOn.every((id) => landed(b.state, id)),
  );
  const next = startable.find((task) => task.id === own?.taskId) ?? startable[0];
  if (next === undefined) return;
  const ownCall = own !== undefined && own.taskId === next.id;
  startTask(b, next, ownCall ? own.principal : dispatchPrincipal(b.state, next), ownCall);
};

/** What a running run does with a free crewmate's open task. */
const carryOn = (b: Builder, member: MemberRecord, task: TaskRecord): void => {
  const run = runningRun(b.state);
  if (member.carryOn !== null && task.state === "working") {
    if (member.carryOn.as === null && run === undefined) return;
    const as = member.carryOn.as ?? dispatchPrincipal(b.state, task);
    b.emit({ _tag: "CrewmateUpdated", handle: member.handle, set: { carryOn: null } });
    continueTask(b, task, as, continueCard(task, member.carryOn.why), "continue");
    return;
  }
  if (run === undefined) return;
  const as = dispatchPrincipal(b.state, task);
  switch (task.state) {
    case "rework": {
      const on = task.wait?.on;
      if (on === "conflict") {
        continueTask(b, task, as, resolveCard(task, task.wait?.paths ?? []), "rework");
      } else if (on === "check-failed") {
        continueTask(
          b,
          task,
          as,
          fixCard(task, member.check ?? "the check", task.check?.output ?? ""),
          "rework",
        );
      } else if (on === "review") {
        continueTask(b, task, as, reworkCard(task, task.wait?.reason ?? ""), "rework");
      }
      return;
    }
    case "ready": {
      const landing = run.options.landing;
      if (landing === "check" || (landing === "lead" && task.review?.verdict === "accept")) {
        land(b, task, as, "run");
      }
      return;
    }
    case "working": {
      if (
        task.midway === null ||
        member.lastEnd?.completed !== true ||
        task.nudgedAttempt === task.counters.attempt
      ) {
        return;
      }
      b.emit({
        _tag: "TaskUpdated",
        taskId: task.id,
        set: { nudgedAttempt: task.counters.attempt },
      });
      continueTask(b, b.task(task.id), as, nudgeCard(task), "nudge");
      return;
    }
    default:
      return;
  }
};

/** A crewmate is free, or something it waits on moved: its open task goes on, or its next starts. */
export const advanceMember = (b: Builder, handle: string): void => {
  const member = b.state.members[handle];
  if (member === undefined || !isFree(b.state, handle)) return;
  // A copy a redeploy may still replace is left alone until it ends.
  if (hostFrozen(b.state, member.host)) return;
  if (member.rotateWhenFree !== null) {
    rotateSession(b, member, member.rotateWhenFree, crewAs(b.state.run?.startedBy ?? ""));
  }
  if (claimTurn(b, b.state.members[handle]!)) return;
  const open = openTaskOf(b.state, handle);
  if (open === undefined) return pump(b, handle);
  if (open.landAs !== null && open.state === "ready") {
    land(b, open, open.landAs, "press-later");
    return;
  }
  carryOn(b, b.state.members[handle]!, open);
};

/** The run's clock follows its crew's work, its limits are checked, and the crew advances. */
export const settle = (b: Builder): void => {
  checkLimits(b);
  for (const member of membersInOrder(b.state)) advanceMember(b, member.handle);
  wakeLead(b);
  followClock(b);
};
