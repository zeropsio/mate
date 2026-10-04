import { operationHolds, operationStep, updateOperation, withOperation } from "./crewOperations.ts";
/**
 * crewLanding — from a crewmate's report to a landing in your tree (PRD §5.2
 * steps 3–5′, CONCEPT §3.2).
 *
 * `crew_report(done)` moves the task to `merging`; when its turn ends and the
 * WIP is committed, {@link integrate} merges your tree's head into its copy
 * (a conflict leaves the merge open and goes back to the crewmate naming the
 * files) and runs its check on exactly the tree that would land. A passed
 * check makes it `ready`: without a reviewer the person's **Land** is the
 * review (PRD §6.3), and nothing lands without that press (N6).
 *
 * {@link land} runs between the person's turns only — no chat of this Mate
 * may be working — and follows the refusal git gives: files edited in your
 * tree wait on you, a moved head merges again, a lock backs off, a full disk
 * parks. After a landing the copy stands at the landing commit, its app
 * restarts when set, and an *After landing: restart the dev server* crewmate
 * gets one shaped turn that may only do that.
 *
 * @module crewLanding
 */
import type { CrewCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import {
  afterLandCard,
  fixCard,
  closedSeamWords,
  landedSeamWords,
  resolveCard,
  reviewReworkCard,
} from "./crewCards.ts";
import {
  asRefusal,
  currentStint,
  feedWhenUnattended,
  isWorking,
  principalUser,
  memberOf,
  refuse,
  requireApplied,
  requireMember,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { claimShown } from "./crewClaims.ts";
import { CREW_ID } from "./CrewHome.ts";
import { reviewTask } from "./crewLead.ts";
import { dropHandoff } from "./crewMemoryCommands.ts";
import { readDeclaredPorts } from "./crewPorts.ts";
import { leadReviews } from "./crewRuns.ts";
import { appendSeam } from "./crewSeamLines.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";
import { EDITED_AFTER_CHECK, MOVED_AFTER_CHECK } from "./crewMachines.ts";
import { readCheckedTip, readTaskCheck, readTaskReview, readTaskWait } from "./crewTaskData.ts";
import {
  continueTask,
  parkTask,
  pump,
  requireTask,
  sendTurn,
  stepTask,
  stintForTurn,
} from "./crewTasks.ts";

/** A copy shown on dev does not land: dev would keep serving work that is now also your tree's. */
const ON_DEV = "its work is on dev; take dev back to your tree first";

/** Reads a lane's figures again after the engine moved it; a failure leaves the old ones. */
export const refreshLaneStats = (core: CrewCore, member: CrewMember) => {
  const host = member.row.host;
  return member.row.kind !== "writer" || host === null
    ? Effect.void
    : core.reads.laneStats(host, member.row.handle).pipe(
        Effect.tap((stats) =>
          Effect.sync(() => {
            core.memory.laneStats.set(member.row.handle, stats);
            core.memory.integration.set(host, stats.integration);
          }),
        ),
        Effect.andThen(core.changed),
        Effect.ignore,
      );
};

/** Stops and starts the crewmate's app, when it runs, so a stack without hot reload serves the new tree. */
export const restartApp = (core: CrewCore, member: CrewMember) =>
  Effect.gen(function* () {
    const { row } = member;
    if (core.memory.apps.get(row.handle) !== "running") return;
    if (row.host === null || row.runCommand === null || row.crewPort === null) return;
    const lane = { host: row.host, handle: row.handle };
    yield* asRefusal(core.app.stop(lane));
    const status = yield* asRefusal(
      core.app.run({ ...lane, command: row.runCommand, port: row.crewPort, env: member.spec.env }),
    );
    core.memory.apps.set(row.handle, status.state === "running" ? "running" : "stopped");
  });

/**
 * A passed check goes to the lead's review in a run that lands after it —
 * once an attempt: an accept stands through a merge-in again (your tree
 * moved before the landing).
 */
const goesToReview = (applied: AppliedCrew, task: CrewAssignmentRow) =>
  leadReviews(applied) && readTaskReview(task.review)?.verdict !== "accept";

/** What runs under the crewmate's lock: the lock itself, or nothing when the caller holds it. */
export type InCopy = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

const callerHoldsTheLock: InCopy = (effect) => effect;

/**
 * The check on a task its merge left `checking`. The command runs outside the
 * crewmate's lock — a message may send the task back to work meanwhile, and a
 * discard is refused as busy — and its verdict is written under the lock, on
 * the task as it stands then: a verdict on a tree that will not land is dropped.
 */
const runCheck = (
  core: CrewCore,
  member: CrewMember,
  taskId: string,
  inCopy: InCopy,
  operationId: string,
) =>
  Effect.gen(function* () {
    const command = member.spec.check;
    {
      // The tree the check runs on: the one tip a landing of this task may take.
      const checkedTip = Option.getOrUndefined(
        yield* asRefusal(core.store.getLane(CREW_ID, member.row.handle)),
      )?.recordedTip;
      const outcome = yield* operationStep(
        core,
        operationId,
        "checking",
        asRefusal(
          core.checks.run({
            host: member.row.host ?? "",
            lane: member.row.handle,
            kind: "check",
            command: command ?? "",
            crewPort: member.row.crewPort ?? undefined,
            env: member.spec.env,
          }),
        ),
      );
      const verdict = yield* inCopy(
        Effect.gen(function* () {
          // A message during the check returned the task to its crewmate: the
          // check's verdict is on a tree that will not land.
          const checking = yield* requireTask(core, taskId);
          if (checking.state !== "checking") return { done: checking } as const;
          // A failed verdict is the check's outcome, sent back to its crewmate; only a check
          // that could not give one stops the operation.
          if (outcome._tag !== "passed" && outcome._tag !== "failed")
            yield* updateOperation(core, operationId, {
              detail: `The check stopped: ${outcome._tag}`,
            });
          const reviewed = goesToReview(yield* requireApplied(core), checking);
          switch (outcome._tag) {
            case "passed":
              return {
                done: yield* stepTask(
                  core,
                  checking,
                  { type: "check-passed", reviewed },
                  (next) => ({
                    ...next,
                    check: { state: "passed", output: outcome.tail, tip: checkedTip ?? null },
                  }),
                ),
              } as const;
            case "failed":
              return {
                done: yield* stepTask(core, checking, { type: "check-failed" }, (next) => ({
                  ...next,
                  check: { state: "failed", output: outcome.tail },
                  waiting: { on: "check-failed", reason: "the check failed", paths: [] },
                })),
              } as const;
            case "lane-missing":
              core.memory.missingLanes.add(member.row.handle);
              return {
                done: yield* parkTask(core, checking, "its copy of the code is missing"),
              } as const;
            case "timed-out":
            case "killed":
              return {
                done: yield* parkTask(
                  core,
                  checking,
                  outcome._tag === "timed-out" ? "the check timed out" : "the check was killed",
                ),
              } as const;
          }
        }),
      );
      return verdict.done;
    }
  });

/**
 * Merge-in and check for a task in `merging`; a no-op in any other state, so
 * a report and a press may both ask for it. Asked while its
 * integration runs — a message sent the task back to work during the check,
 * and the turn reported again before that check ended — it runs again once
 * that one ends, so the task is never left `merging`.
 *
 * `inCopy` is the crewmate's lock for a caller that holds none: the merge and
 * every state written run under it, the setup, the app restart and the check
 * outside it, the task standing `checking`.
 */
export const integrate = (
  core: CrewCore,
  taskId: string,
  inCopy: InCopy = callerHoldsTheLock,
  setupAgain = false,
): Effect.Effect<CrewAssignmentRow, CrewCommandError> =>
  Effect.gen(function* () {
    const task = yield* requireTask(core, taskId);
    if (task.state !== "merging") return task;
    if (core.memory.integrating.has(taskId)) {
      core.memory.integrateAgain.add(taskId);
      return task;
    }
    core.memory.integrating.add(taskId);
    const ran = yield* Effect.exit(
      integrateMerging(core, taskId, inCopy, setupAgain).pipe(
        // A review nobody takes up waits on the person after a while (`crewSnapshot`).
        Effect.tap((row) => (row.state === "review" ? feedWhenUnattended(core) : Effect.void)),
        Effect.ensuring(Effect.sync(() => core.memory.integrating.delete(taskId))),
      ),
    );
    // A newer report can queue a check; a failed check ends here.
    if (core.memory.integrateAgain.delete(taskId) && !(yield* operationHolds(core, task.member)))
      return yield* integrate(core, taskId, inCopy);
    // A Land now that found it running lands it, once ready; the intent ends with the run.
    const landAs = core.memory.landWhenReady.get(taskId);
    core.memory.landWhenReady.delete(taskId);
    const result = yield* ran;
    if (landAs !== undefined && result.state === "ready") {
      yield* land(core, landAs, taskId, inCopy);
      return yield* requireTask(core, taskId);
    }
    return result;
  });

const integrateMerging = (core: CrewCore, taskId: string, inCopy: InCopy, setupAgain: boolean) =>
  Effect.gen(function* () {
    const recordedTask = yield* requireTask(core, taskId);
    return yield* withOperation(
      core,
      { kind: "check", handle: recordedTask.member, task: recordedTask },
      (operation) =>
        Effect.gen(function* () {
          const applied = yield* requireApplied(core);
          // Under the lock: the task as it stands, the merge in its copy, and the state it leaves.
          const merge = yield* inCopy(
            Effect.gen(function* () {
              const task = yield* requireTask(core, taskId);
              const member = yield* requireMember(applied, task.member);
              if (task.state !== "merging") return { task, member } as const;
              if (member.row.kind !== "writer") {
                const clean = yield* stepTask(core, task, { type: "merge-clean" });
                const done = yield* stepTask(core, clean, {
                  type: "check-passed",
                  reviewed: goesToReview(applied, task),
                });
                return { task: done, member } as const;
              }
              const key = { crew: CREW_ID, handle: member.row.handle };
              const merged = yield* operationStep(
                core,
                operation.id,
                "merging",
                asRefusal(core.integration.mergeIn(key, operation.id)),
              );
              if (!["merged", "current"].includes(merged._tag))
                yield* updateOperation(core, operation.id, {
                  detail: `Preparing the check stopped: ${merged._tag}`,
                });
              switch (merged._tag) {
                case "current":
                case "merged": {
                  const checking = yield* stepTask(core, task, { type: "merge-clean" }, (next) => ({
                    ...next,
                    mergedHead: merged.head,
                    waiting: null,
                    ...(member.spec.check === undefined || member.row.host === null
                      ? {}
                      : { check: { state: "running" as const, output: "" } }),
                  }));
                  return { task: checking, member, merged } as const;
                }
                case "conflict":
                  return {
                    task: yield* stepTask(core, task, { type: "merge-conflict" }, (next) => ({
                      ...next,
                      mergedHead: merged.head,
                      waiting: {
                        on: "conflict",
                        reason: "conflicts with what landed",
                        paths: merged.paths,
                      },
                    })),
                    member,
                  } as const;
                case "unrelated":
                  return {
                    task: yield* stepTask(core, task, { type: "merge-empty-base" }, (next) => ({
                      ...next,
                      waiting: {
                        on: "triage",
                        reason: "your tree's history was rewritten",
                        paths: [],
                      },
                    })),
                    member,
                  } as const;
                case "frozen":
                  core.memory.lastError = `${member.row.host} is redeploying; #${task.number} merges when it is back.`;
                  return { task, member } as const;
                case "lane-missing":
                  core.memory.missingLanes.add(member.row.handle);
                  return {
                    task: yield* parkTask(core, task, "its copy of the code is missing"),
                    member,
                  } as const;
                case "uncommitted":
                  return {
                    task: yield* parkTask(
                      core,
                      task,
                      "its copy has work the engine did not commit",
                    ),
                    member,
                  } as const;
                case "unknown-tip":
                  return {
                    task: yield* parkTask(
                      core,
                      task,
                      "its copy of the code moved outside the engine",
                    ),
                    member,
                  } as const;
              }
            }),
          );
          let result = merge.task;
          if ("merged" in merge && merge.merged !== undefined) {
            const { member, merged } = merge;
            yield* core.changed;
            // Outside the lock, the task standing `checking`: what the merge needs, then the check.
            if (
              (setupAgain || (merged._tag === "merged" && merged.lockfileChanged)) &&
              member.spec.setup !== undefined
            ) {
              const setup = yield* operationStep(
                core,
                operation.id,
                "setting-up",
                asRefusal(
                  core.checks.run({
                    host: member.row.host ?? "",
                    lane: member.row.handle,
                    kind: "setup",
                    command: member.spec.setup,
                    crewPort: member.row.crewPort ?? undefined,
                    env: member.spec.env,
                  }),
                ),
              );
              if (setup._tag !== "passed") {
                yield* updateOperation(core, operation.id, {
                  detail: `Preparing its copy stopped: ${setup._tag}`,
                });
                if (setup._tag === "lane-missing") core.memory.missingLanes.add(member.row.handle);
                const stopped = yield* inCopy(
                  Effect.gen(function* () {
                    const task = yield* requireTask(core, taskId);
                    return yield* parkTask(
                      core,
                      task,
                      setup._tag === "failed"
                        ? "its setup failed"
                        : setup._tag === "killed"
                          ? "its setup was killed"
                          : setup._tag === "timed-out"
                            ? "its setup timed out"
                            : "its copy of the code is missing",
                    );
                  }),
                );
                yield* refreshLaneStats(core, member);
                return stopped;
              }
            }
            if (merged._tag === "merged" && member.row.restartAfterMerge)
              yield* restartApp(core, member);
            result =
              member.spec.check === undefined || member.row.host === null
                ? yield* inCopy(
                    Effect.gen(function* () {
                      const checking = yield* requireTask(core, taskId);
                      if (checking.state !== "checking") return checking;
                      return yield* stepTask(core, checking, {
                        type: "check-passed",
                        reviewed: goesToReview(applied, checking),
                      });
                    }),
                  )
                : yield* runCheck(core, member, taskId, inCopy, operation.id);
          }
          yield* refreshLaneStats(core, merge.member);
          yield* core.changed;
          return result;
        }),
    );
  });

/** Whether any chat of this Mate — a person thread, never a crewmate's — has a turn running. */
export const personTurnRunning = (core: CrewCore) =>
  asRefusal(core.projection.getShellSnapshot()).pipe(
    Effect.map((snapshot) =>
      snapshot.threads.some(
        (thread) =>
          thread.crew === undefined &&
          thread.archivedAt === null &&
          (thread.session?.status === "running" || thread.latestTurn?.state === "running"),
      ),
    ),
  );

const afterLand = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  task: CrewAssignmentRow,
  commit: string,
  principal: TurnPrincipal,
) =>
  Effect.gen(function* () {
    const host = member.row.host;
    if (host === null) return;
    const command = yield* asRefusal(core.reads.devServerCommand(host));
    const yaml = yield* asRefusal(core.reads.zeropsYaml(host));
    const port = yaml === undefined ? null : (readDeclaredPorts(yaml, host)?.main ?? null);
    if (command === undefined || port === null) {
      core.memory.lastError = `No dev server runs on ${host}; #${task.number} landed without restarting it.`;
      return;
    }
    const stint = yield* stintForTurn(core, applied, member, "turn-start", false);
    core.memory.shaped.set(stint.threadId, {
      turn: "after-land",
      devServer: { port, command },
    });
    yield* sendTurn(
      core,
      member,
      stint,
      principal,
      afterLandCard({
        number: task.number,
        title: task.title,
        commit,
        host,
        devServer: { port, command },
      }),
    );
  });

/** A landing that did not happen now, and why, in the crew log. */
export const landingHeld = (core: CrewCore, task: CrewAssignmentRow, detail: string) =>
  Effect.gen(function* () {
    yield* asRefusal(
      core.store.appendLog({
        crew: CREW_ID,
        run: null,
        at: yield* core.now,
        kind: "landing-held",
        payload: { task: task.assignment, detail },
      }),
    );
  });

/**
 * *Land* (PRD §5.2 step 5); from `waiting-on-you` it merges again first, since
 * your tree moved, and from `review` it is your accept first. A landing that
 * does not happen says why in the crew log; its task's state names it too.
 */
export const land = (
  core: CrewCore,
  principal: TurnPrincipal,
  taskId: string,
  /** The crewmate's lock for a caller that holds none (`integrate`). */
  inCopy: InCopy = callerHoldsTheLock,
): Effect.Effect<void, CrewCommandError> =>
  Effect.gen(function* () {
    const before = yield* inCopy(
      Effect.gen(function* () {
        const task = yield* requireTask(core, taskId);
        return task.state === "waiting-on-you"
          ? yield* stepTask(core, task, { type: "tree-clean" })
          : task;
      }),
    );
    // Your tree moved: it merges and checks again first, the check outside the lock.
    if (before.state === "merging") yield* integrate(core, taskId, inCopy);
    const after = yield* inCopy(landReady(core, principal, taskId));
    if (after === undefined) return;
    if (after.next === "land") return yield* land(core, principal, after.assignment, inCopy);
    if ((yield* integrate(core, after.assignment, inCopy)).state === "ready") {
      return yield* land(core, principal, after.assignment, inCopy);
    }
  });

/** What a landing asks for after it, outside the lock: merge and check again, or land again. */
type LandAfter =
  | undefined
  | { readonly next: "integrate-then-land" | "land"; readonly assignment: string };

/** The landing of a task as it stands, under the crewmate's lock. */
const landReady = (
  core: CrewCore,
  principal: TurnPrincipal,
  taskId: string,
): Effect.Effect<LandAfter, CrewCommandError> =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    let task = yield* requireTask(core, taskId);
    const member = yield* requireMember(applied, task.member);
    // *Land it myself* on a task waiting for the lead's review: your accept, then the landing.
    if (task.state === "review") {
      task = yield* reviewTask(core, task, { verdict: "accept", note: "", by: null });
    }
    if (task.state !== "ready")
      return yield* refuse("wrong-state", `#${task.number} is ${task.state}`);
    if (yield* personTurnRunning(core)) {
      return yield* refuse("wrong-state", "a chat of this Mate is working; land between its turns");
    }
    const lane =
      member.row.kind === "writer"
        ? Option.getOrUndefined(yield* asRefusal(core.store.getLane(CREW_ID, member.row.handle)))
        : undefined;
    if (lane?.frozenSince !== undefined && lane.frozenSince !== null) {
      return yield* refuse("wrong-state", `${lane.host} is redeploying`);
    }
    if (claimShown(core, member.row.handle)) {
      return yield* refuse("wrong-state", ON_DEV);
    }
    return yield* withOperation(
      core,
      { kind: "landing", handle: member.row.handle, task, startedBy: principalUser(principal) },
      (operation) =>
        Effect.gen(function* () {
          const landing = yield* stepTask(core, task, {
            type: "land",
            facts: {
              personTurnRunning: false,
              hostFrozen: false,
              laneShown: false,
              lockTaken: true,
            },
          });
          if (member.row.kind !== "writer") {
            yield* stepTask(core, landing, { type: "fast-forward" });
            yield* pump(core, member.row.handle);
            return;
          }
          const outcome = yield* operationStep(
            core,
            operation.id,
            "landing",
            asRefusal(
              core.integration.land({
                crew: CREW_ID,
                handle: member.row.handle,
                assignment: landing.assignment,
                title: landing.title,
                checkedTip: readCheckedTip(task.check),
              }),
            ),
          );
          // A moved tree or a missing object is the landing's outcome: it merges or lands again.
          const again =
            outcome._tag === "head-moved" ||
            (outcome._tag === "refused" && ["redo", "retry"].includes(outcome.refusal.action));
          if (!again && !["landed", "already-landed", "nothing"].includes(outcome._tag))
            yield* updateOperation(core, operation.id, {
              detail: `Adding the work stopped: ${outcome._tag}`,
            });
          switch (outcome._tag) {
            case "landed":
            case "already-landed": {
              yield* stepTask(
                core,
                landing,
                { type: outcome._tag === "landed" ? "fast-forward" : "trailer-found" },
                (next) => ({ ...next, landedCommit: outcome.commit, waiting: null }),
              );
              yield* asRefusal(
                core.store.appendLog({
                  crew: CREW_ID,
                  run: null,
                  at: yield* core.now,
                  kind: "landed",
                  payload: { task: landing.assignment, commit: outcome.commit },
                }),
              );
              const stint = currentStint((yield* core.applied) ?? applied, member.row.handle);
              if (stint !== undefined) {
                yield* appendSeam(
                  core,
                  stint.threadId,
                  landedSeamWords(landing.number, outcome.commit),
                  {
                    seam: "landed",
                    taskId: landing.assignment,
                    number: landing.number,
                    commit: outcome.commit,
                  },
                );
              }
              yield* dropHandoff(core, member.row.handle, landing.assignment);
              if (member.row.restartAfterMerge) yield* restartApp(core, member);
              if (member.spec.afterLandRestart) {
                yield* afterLand(core, applied, member, landing, outcome.commit, principal);
              }
              yield* refreshLaneStats(core, member);
              yield* pump(core, member.row.handle);
              return;
            }
            case "nothing": {
              // Nothing of its own to land: the task closes, and its crewmate's queue moves.
              yield* stepTask(core, landing, { type: "fast-forward" }, (next) => ({
                ...next,
                landedCommit: null,
                waiting: null,
              }));
              yield* asRefusal(
                core.store.appendLog({
                  crew: CREW_ID,
                  run: null,
                  at: yield* core.now,
                  kind: "closed",
                  payload: { task: landing.assignment, reason: "nothing to land" },
                }),
              );
              const stint = currentStint((yield* core.applied) ?? applied, member.row.handle);
              if (stint !== undefined) {
                yield* appendSeam(core, stint.threadId, closedSeamWords(landing.number), {
                  seam: "closed",
                  taskId: landing.assignment,
                  number: landing.number,
                });
              }
              yield* dropHandoff(core, member.row.handle, landing.assignment);
              yield* refreshLaneStats(core, member);
              yield* pump(core, member.row.handle);
              return;
            }
            case "head-moved": {
              yield* landingHeld(core, landing, "your tree moved since its check; it merges again");
              const moved = yield* stepTask(core, landing, { type: "head-moved" });
              return moved.state === "merging"
                ? ({ next: "integrate-then-land", assignment: moved.assignment } as const)
                : undefined;
            }
            case "refused": {
              const { refusal } = outcome;
              switch (refusal.action) {
                case "wait":
                  yield* landingHeld(
                    core,
                    landing,
                    `your tree has ${refusal.kind === "dirty" ? "uncommitted edits" : "untracked files"} in its way: ${refusal.paths.join(", ")}`,
                  );
                  yield* stepTask(
                    core,
                    landing,
                    { type: refusal.kind === "dirty" ? "dirty-tree" : "untracked-in-way" },
                    (next) => ({
                      ...next,
                      waiting: { on: "your-tree", reason: null, paths: refusal.paths },
                    }),
                  );
                  return;
                case "redo": {
                  yield* landingHeld(
                    core,
                    landing,
                    "your tree moved during the landing; it merges again",
                  );
                  const moved = yield* stepTask(core, landing, { type: "not-fast-forward" });
                  return { next: "integrate-then-land", assignment: moved.assignment } as const;
                }
                case "backoff":
                  yield* landingHeld(core, landing, "another git process holds your tree's index");
                  yield* stepTask(core, landing, { type: "index-lock" });
                  return yield* refuse(
                    "wrong-state",
                    "another git process holds your tree's index; try again",
                  );
                case "retry": {
                  yield* landingHeld(
                    core,
                    landing,
                    "an object the landing needs was missing; it lands again",
                  );
                  const key = `${landing.assignment}:${landing.attempt}`;
                  const missing = yield* stepTask(core, landing, {
                    type: "missing-object",
                    retried: core.memory.landRetried.has(key),
                  });
                  core.memory.landRetried.add(key);
                  return missing.state === "ready"
                    ? ({ next: "land", assignment: missing.assignment } as const)
                    : undefined;
                }
                case "park":
                  if (refusal.kind === "no-space") {
                    yield* stepTask(core, landing, { type: "disk-full" });
                  } else {
                    yield* parkTask(core, landing, refusal.detail);
                  }
                  return;
              }
              return;
            }
            case "uncommitted":
              yield* parkTask(core, landing, EDITED_AFTER_CHECK);
              return;
            case "unchecked":
              yield* parkTask(core, landing, MOVED_AFTER_CHECK);
              return;
            case "frozen":
            case "lane-missing":
            case "unknown-tip":
              yield* parkTask(core, landing, `its copy could not land (${outcome._tag})`);
              return;
          }
        }),
    );
  });

/**
 * *Land* on a task whose crewmate never reported (PRD §5.2 step 5′), or on one
 * sent back as rework, as its copy stands: WIP, merge-in, check, land.
 */
export const landNow = (
  core: CrewCore,
  principal: TurnPrincipal,
  taskId: string,
  /** The crewmate's lock for a caller that holds none (`integrate`). */
  inCopy: InCopy = callerHoldsTheLock,
) =>
  Effect.gen(function* () {
    const merging = yield* inCopy(
      Effect.gen(function* () {
        const applied = yield* requireApplied(core);
        const task = yield* requireTask(core, taskId);
        const member = yield* requireMember(applied, task.member);
        if (task.state !== "working" && task.state !== "rework")
          return yield* refuse("wrong-state", `#${task.number} is ${task.state}`);
        if (isWorking(core, applied, member.row.handle)) {
          return yield* refuse("wrong-state", `@${member.row.handle}'s turn is running`);
        }
        if (claimShown(core, member.row.handle)) {
          return yield* refuse("wrong-state", ON_DEV);
        }
        if (member.row.kind === "writer") {
          const committed = yield* asRefusal(
            core.workspace.commitTurn(
              { crew: CREW_ID, handle: member.row.handle },
              { assignment: task.assignment, turn: 0 },
            ),
          );
          if (committed._tag === "rework") return yield* refuse("wrong-state", committed.reason);
          if (committed._tag !== "committed" && committed._tag !== "unchanged") {
            return yield* refuse(
              "wrong-state",
              `its copy could not be committed (${committed._tag})`,
            );
          }
        }
        return yield* stepTask(core, task, { type: "land-now" }, (next) => ({
          ...next,
          waiting: null,
        }));
      }),
    );
    // Landed once ready — by this integration, or by the one already running on it.
    core.memory.landWhenReady.set(merging.assignment, principal);
    yield* integrate(core, merging.assignment, inCopy);
  });

/**
 * The turn a task back as rework goes to its crewmate with: resolve the
 * conflicts, fix the check, or take the review's note.
 */
export const reworkCard = (
  member: CrewMember,
  task: CrewAssignmentRow,
  on: "conflict" | "check-failed" | "review",
): string => {
  switch (on) {
    case "conflict":
      return resolveCard({
        number: task.number,
        title: task.title,
        paths: readTaskWait(task.waiting)?.paths ?? [],
      });
    case "check-failed":
      return fixCard({
        number: task.number,
        title: task.title,
        command: member.spec.check ?? "the check",
        output: readTaskCheck(task.check)?.output ?? "",
      });
    case "review":
      return reviewReworkCard({
        number: task.number,
        title: task.title,
        note: readTaskWait(task.waiting)?.reason ?? "",
      });
  }
};

/** *Ask to resolve* a merge-in's conflicts, or *Ask to fix* a failed check: one turn as the person. */
export const askRework = (
  core: CrewCore,
  principal: TurnPrincipal,
  taskId: string,
  on: "conflict" | "check-failed",
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const task = yield* requireTask(core, taskId);
    if (task.state !== "rework" || readTaskWait(task.waiting)?.on !== on) {
      return yield* refuse("wrong-state", `#${task.number} is ${task.state}`);
    }
    const member = memberOf(applied, task.member);
    if (member === undefined) return yield* refuse("unknown-crewmate", `@${task.member}`);
    yield* continueTask(core, applied, member, task, principal, reworkCard(member, task, on));
  });
