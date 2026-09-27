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
 *   turn the run's own pause stopped carries on when the run goes on;
 * - with *The crew may show work on dev*, a crewmate's request to show its
 *   copy is allowed as soon as its turn ends.
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
  leadOf,
  memberOf,
  runningRun,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { grantClaim } from "./crewClaims.ts";
import { land, reworkCard } from "./crewLanding.ts";
import { wakeLead } from "./crewLead.ts";
import { pauseRun, runOptionsOf } from "./crewRuns.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";
import { readTaskReview, readTaskWait } from "./crewTaskData.ts";
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
        if (on === "conflict" || on === "check-failed" || on === "review") {
          yield* runTurn(core, applied, member, task, reworkCard(member, task, on));
        }
        return;
      }
      case "ready": {
        const run = runningRun(applied);
        const landing = run === undefined ? undefined : runOptionsOf(run)?.landing;
        const accepted = readTaskReview(task.review)?.verdict === "accept";
        if (landing !== "check" && !(landing === "lead" && accepted)) return;
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

/** A run's dev grant: a free crewmate's standing request to show its copy on dev is allowed. */
const allowShowOnDev = (core: CrewCore, applied: AppliedCrew, member: CrewMember) =>
  Effect.gen(function* () {
    const run = runningRun(applied);
    const host = member.row.host;
    const claim = host === null ? undefined : core.memory.claims.get(host);
    if (
      run === undefined ||
      host === null ||
      runOptionsOf(run)?.devGrant !== true ||
      claim?.state !== "requested" ||
      claim.handle !== member.row.handle
    ) {
      return false;
    }
    return yield* grantClaim(core, { kind: "crew", startedBy: run.startedBy }, host).pipe(
      Effect.as(true),
      Effect.catchTag("CrewCommandError", () => Effect.succeed(false)),
    );
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
    if (member === undefined) return;
    if (member.row.kind === "lead") return yield* wakeLead(core, applied, member);
    if (!isWorking(core, applied, handle)) {
      const open = openTaskOf(yield* asRefusal(core.store.assignments(CREW_ID)), handle);
      // An allowed Show on dev sends the claim turn now; the task goes on when it ends.
      if (!(yield* allowShowOnDev(core, applied, member))) {
        if (open === undefined) yield* pump(core, handle);
        else if (runningRun(applied) !== undefined) yield* carryOn(core, applied, member, open);
      }
    }
    // What this crewmate did may wait on the lead now: a review, a question.
    const lead = leadOf(applied);
    if (lead !== undefined) yield* wakeLead(core, (yield* core.applied) ?? applied, lead);
    yield* core.changed;
  });

/**
 * Starts again every queued task admission refused, once a sign-in or a
 * signer changed: the cause may have cleared. One refused again keeps its
 * *Can't start* row with the new words.
 */
export const retryRefused = (core: CrewCore) =>
  Effect.gen(function* () {
    if (core.memory.cantStart.size === 0) return;
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const handles = new Set(
      tasks
        .filter((task) => task.state === "queued" && core.memory.cantStart.has(task.assignment))
        .map((task) => task.member),
    );
    for (const handle of handles) yield* advance(core, handle);
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
