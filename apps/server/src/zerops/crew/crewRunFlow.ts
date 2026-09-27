/**
 * crewRunFlow — what a running run does on its own once a crewmate is free
 * (PRD §2.4 *Run on*, §5.4; CONCEPT §5 *Endings*), besides starting its
 * queued tasks (`crewTasks.pump`):
 *
 * - a task back as rework goes to its crewmate again — resolve the
 *   conflicts, fix the check — as the run's starter;
 * - a ready task lands when the run's landing is *Land when the check
 *   passes*; with *I land everything* it waits for the person's **Land**;
 * - a turn that ended without a report gets one nudge per attempt, and a
 *   turn the run's own pause stopped carries on when the run goes on.
 *
 * Without a running run none of this happens: every crew turn then traces to
 * a press of the person's (PRD §2.4). A dispatch admission refuses pauses the
 * run with admission's words.
 *
 * @module crewRunFlow
 */
import * as Effect from "effect/Effect";

import { nudgeCard, resumeCard } from "./crewCards.ts";
import {
  asRefusal,
  currentStint,
  dispatchPrincipal,
  isWorking,
  memberOf,
  runningRun,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { land, reworkCard } from "./crewLanding.ts";
import { pauseRun, runOptionsOf } from "./crewRuns.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";
import { readTaskWait } from "./crewTaskData.ts";
import { continueTask, openTaskOf, pump } from "./crewTasks.ts";

/** One turn of the run into an open task; a refusal from admission pauses the run. */
const runTurn = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  task: CrewAssignmentRow,
  text: string,
) =>
  continueTask(core, applied, member, task, dispatchPrincipal(applied, task), text).pipe(
    Effect.asVoid,
    Effect.catchTag("CrewCommandError", (error) =>
      error.reason === "not-allowed" ? pauseRun(core, "refused", error.detail) : Effect.fail(error),
    ),
  );

/** What the run does with a free crewmate's open task. */
const carryOn = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  task: CrewAssignmentRow,
) =>
  Effect.gen(function* () {
    const { memory } = core;
    switch (task.state) {
      case "rework": {
        const on = readTaskWait(task.waiting)?.on;
        if (on === "conflict" || on === "check-failed") {
          yield* runTurn(core, applied, member, task, reworkCard(member, task, on));
        }
        return;
      }
      case "ready": {
        const run = runningRun(applied);
        if (run === undefined || runOptionsOf(run)?.landing !== "check") return;
        // A landing held (your chat is working, the service redeploys) waits for the next free moment.
        yield* land(core, dispatchPrincipal(applied, task), task.assignment).pipe(
          Effect.catchTag("CrewCommandError", () => Effect.void),
        );
        return;
      }
      case "working": {
        const stint = currentStint(applied, member.row.handle);
        if (stint === undefined) return;
        if (memory.runInterrupted.delete(stint.threadId)) {
          yield* runTurn(core, applied, member, task, resumeCard(task));
          return;
        }
        const attempt = `${task.assignment}:${task.attempt}`;
        if (memory.endings.get(stint.threadId) !== "completed" || memory.nudged.has(attempt)) {
          return;
        }
        memory.nudged.add(attempt);
        yield* runTurn(core, applied, member, task, nudgeCard(task));
        return;
      }
      default:
        return;
    }
  });

/**
 * A crewmate is free, or something it waits on moved: its open task goes on
 * in a running run, or its next queued task starts.
 */
export const advance = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    const member = memberOf(applied, handle);
    if (member === undefined || isWorking(core, applied, handle)) return;
    const open = openTaskOf(yield* asRefusal(core.store.assignments(CREW_ID)), handle);
    if (open === undefined) return yield* pump(core, handle);
    if (runningRun(applied) !== undefined) yield* carryOn(core, applied, member, open);
    yield* core.changed;
  });

/** Advances every crewmate; a failure is the section's last error, never a stop. */
export const advanceAll = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    for (const handle of applied.members.keys()) {
      yield* advance(core, handle).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = error.message;
          }),
        ),
      );
    }
  });
