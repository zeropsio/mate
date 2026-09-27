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
import { afterLandCard, fixCard, landedSeamWords, resolveCard } from "./crewCards.ts";
import {
  asRefusal,
  currentStint,
  isWorking,
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
import { dropHandoff } from "./crewMemoryCommands.ts";
import { readDeclaredPorts } from "./crewPorts.ts";
import { appendSeam } from "./crewSeamLines.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";
import { readTaskCheck, readTaskWait } from "./crewTaskData.ts";
import {
  continueTask,
  parkTask,
  pump,
  requireTask,
  saveTask,
  sendTurn,
  stepTask,
  stintForTurn,
} from "./crewTasks.ts";

/** A copy shown on dev does not land: dev would keep serving work that is now also your tree's. */
const ON_DEV = "its work is on dev; take dev back to your tree first";

/** How many times a check stopped by its timeout or a signal runs again before the task parks. */
const CHECK_RERUNS = 1;

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

const runCheck = (core: CrewCore, member: CrewMember, task: CrewAssignmentRow) =>
  Effect.gen(function* () {
    const command = member.spec.check;
    if (command === undefined || member.row.host === null) {
      return yield* stepTask(core, task, { type: "check-passed", reviewed: false });
    }
    let checking = yield* saveTask(core, { ...task, check: { state: "running", output: "" } });
    yield* core.changed;
    for (let run = 0; ; run += 1) {
      const outcome = yield* asRefusal(
        core.checks.run({
          host: member.row.host,
          lane: member.row.handle,
          kind: "check",
          command,
          crewPort: member.row.crewPort ?? undefined,
          env: member.spec.env,
        }),
      );
      // A message during the check returned the task to its crewmate: the
      // check's verdict is on a tree that will not land.
      const current = yield* requireTask(core, checking.assignment);
      if (current.state !== "checking") return current;
      checking = current;
      switch (outcome._tag) {
        case "passed":
          return yield* stepTask(
            core,
            checking,
            { type: "check-passed", reviewed: false },
            (next) => ({
              ...next,
              check: { state: "passed", output: outcome.tail },
            }),
          );
        case "failed":
          return yield* stepTask(core, checking, { type: "check-failed" }, (next) => ({
            ...next,
            check: { state: "failed", output: outcome.tail },
            waiting: { on: "check-failed", reason: "the check failed", paths: [] },
          }));
        case "lane-missing":
          core.memory.missingLanes.add(member.row.handle);
          return yield* parkTask(core, checking, "its copy of the code is missing");
        case "timed-out":
        case "killed":
          if (run >= CHECK_RERUNS) {
            return yield* parkTask(
              core,
              checking,
              outcome._tag === "timed-out"
                ? "the check timed out twice"
                : "the check was killed twice",
            );
          }
          checking = yield* stepTask(core, checking, { type: "check-killed" });
      }
    }
  });

/**
 * Merge-in and check for a task in `merging`; a no-op in any other state, so
 * a report, a boot sweep and a press may all ask for it.
 */
export const integrate = (core: CrewCore, taskId: string) =>
  Effect.gen(function* () {
    const task = yield* requireTask(core, taskId);
    if (task.state !== "merging" || core.memory.integrating.has(taskId)) return task;
    core.memory.integrating.add(taskId);
    return yield* integrateMerging(core, task).pipe(
      Effect.ensuring(Effect.sync(() => core.memory.integrating.delete(taskId))),
    );
  });

const integrateMerging = (core: CrewCore, task: CrewAssignmentRow) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, task.member);
    if (member.row.kind !== "writer") {
      const clean = yield* stepTask(core, task, { type: "merge-clean" });
      return yield* stepTask(core, clean, { type: "check-passed", reviewed: false });
    }
    const key = { crew: CREW_ID, handle: member.row.handle };
    const merged = yield* asRefusal(core.integration.mergeIn(key));
    let result: CrewAssignmentRow;
    switch (merged._tag) {
      case "current":
      case "merged": {
        if (merged._tag === "merged" && merged.lockfileChanged && member.spec.setup !== undefined) {
          yield* asRefusal(
            core.checks.run({
              host: member.row.host ?? "",
              lane: member.row.handle,
              kind: "setup",
              command: member.spec.setup,
              crewPort: member.row.crewPort ?? undefined,
              env: member.spec.env,
            }),
          );
        }
        if (merged._tag === "merged" && member.row.restartAfterMerge)
          yield* restartApp(core, member);
        const checking = yield* stepTask(core, task, { type: "merge-clean" }, (next) => ({
          ...next,
          mergedHead: merged.head,
          waiting: null,
        }));
        result = yield* runCheck(core, member, checking);
        break;
      }
      case "conflict":
        result = yield* stepTask(core, task, { type: "merge-conflict" }, (next) => ({
          ...next,
          mergedHead: merged.head,
          waiting: { on: "conflict", reason: "conflicts with what landed", paths: merged.paths },
        }));
        break;
      case "unrelated":
        result = yield* stepTask(core, task, { type: "merge-empty-base" }, (next) => ({
          ...next,
          waiting: { on: "triage", reason: "your tree's history was rewritten", paths: [] },
        }));
        break;
      case "frozen":
        core.memory.lastError = `${member.row.host} is redeploying; #${task.number} merges when it is back.`;
        result = task;
        break;
      case "lane-missing":
        core.memory.missingLanes.add(member.row.handle);
        result = yield* parkTask(core, task, "its copy of the code is missing");
        break;
      case "uncommitted":
        result = yield* parkTask(core, task, "its copy has work the engine did not commit");
        break;
      case "unknown-tip":
        result = yield* parkTask(core, task, "its copy of the code moved outside the engine");
        break;
    }
    yield* refreshLaneStats(core, member);
    yield* core.changed;
    return result;
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

/** *Land* (PRD §5.2 step 5); from `waiting-on-you` it merges again first, since your tree moved. */
export const land = (
  core: CrewCore,
  principal: TurnPrincipal,
  taskId: string,
): Effect.Effect<void, CrewCommandError> =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    let task = yield* requireTask(core, taskId);
    const member = yield* requireMember(applied, task.member);
    if (task.state === "waiting-on-you") {
      task = yield* integrate(
        core,
        (yield* stepTask(core, task, { type: "tree-clean" })).assignment,
      );
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
    const landing = yield* stepTask(core, task, {
      type: "land",
      facts: { personTurnRunning: false, hostFrozen: false, laneShown: false, lockTaken: true },
    });
    if (member.row.kind !== "writer") {
      yield* stepTask(core, landing, { type: "fast-forward" });
      yield* pump(core, member.row.handle);
      return;
    }
    const outcome = yield* asRefusal(
      core.integration.land({
        crew: CREW_ID,
        handle: member.row.handle,
        assignment: landing.assignment,
        title: landing.title,
      }),
    );
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
          yield* appendSeam(core, stint.threadId, landedSeamWords(landing.number, outcome.commit), {
            seam: "landed",
            taskId: landing.assignment,
            number: landing.number,
            commit: outcome.commit,
          });
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
      case "head-moved": {
        const again = yield* stepTask(core, landing, { type: "head-moved" });
        if (
          again.state === "merging" &&
          (yield* integrate(core, again.assignment)).state === "ready"
        ) {
          return yield* land(core, principal, again.assignment);
        }
        return;
      }
      case "refused": {
        const { refusal } = outcome;
        switch (refusal.action) {
          case "wait":
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
            const again = yield* stepTask(core, landing, { type: "not-fast-forward" });
            if ((yield* integrate(core, again.assignment)).state === "ready") {
              return yield* land(core, principal, again.assignment);
            }
            return;
          }
          case "backoff":
            yield* stepTask(core, landing, { type: "index-lock" });
            return yield* refuse(
              "wrong-state",
              "another git process holds your tree's index; try again",
            );
          case "retry": {
            const again = yield* stepTask(core, landing, { type: "missing-object" });
            return yield* land(core, principal, again.assignment);
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
      case "frozen":
      case "lane-missing":
      case "uncommitted":
      case "unknown-tip":
        yield* parkTask(core, landing, `its copy could not land (${outcome._tag})`);
        return;
    }
  });

/**
 * *Land* on a task whose crewmate never reported (PRD §5.2 step 5′), or on one
 * sent back as rework, as its copy stands: WIP, merge-in, check, land.
 */
export const landNow = (core: CrewCore, principal: TurnPrincipal, taskId: string) =>
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
        return yield* refuse("wrong-state", `its copy could not be committed (${committed._tag})`);
      }
    }
    const merging = yield* stepTask(core, task, { type: "land-now" }, (next) => ({
      ...next,
      waiting: null,
    }));
    if ((yield* integrate(core, merging.assignment)).state === "ready") {
      yield* land(core, principal, merging.assignment);
    }
  });

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
    const wait = readTaskWait(task.waiting);
    if (task.state !== "rework" || wait?.on !== on) {
      return yield* refuse("wrong-state", `#${task.number} is ${task.state}`);
    }
    const member = memberOf(applied, task.member);
    if (member === undefined) return yield* refuse("unknown-crewmate", `@${task.member}`);
    const text =
      on === "conflict"
        ? resolveCard({ number: task.number, title: task.title, paths: wait.paths })
        : fixCard({
            number: task.number,
            title: task.title,
            command: member.spec.check ?? "the check",
            output: readTaskCheck(task.check)?.output ?? "",
          });
    yield* continueTask(core, applied, member, task, principal, text);
  });
