/**
 * crewBoot — an applied crew after a Mate server restart (ARCHITECTURE §5
 * *Mate server restart recovery*), run once the server accepts commands.
 *
 * Lane truth is git, so each writer's service is swept first: a dirty lane
 * that is not merging gets its WIP commit, an unreadable ref or a tip the
 * engine did not write parks, a missing directory is recovered (or its loss
 * named). A landing killed mid-way resolves from its anchor: it landed, or it
 * merges again. A task stuck in `merging`, `checking` or `landing` goes back
 * through integration. A task whose turn was running when the server died is
 * re-queued once (an infrastructure ending), and starts again as the person
 * who created it. Then the figures the snapshot shows are read again and
 * every free crewmate's queue moves.
 *
 * @module crewBoot
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ThreadId } from "@t3tools/contracts";

import { grantAfterTurn, settleAllClaims } from "./crewClaims.ts";
import { asRefusal, memberOf, type CrewCore } from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { integrate, refreshLaneStats } from "./crewLanding.ts";
import { laneSpecsOn } from "./crewTurns.ts";
import { advanceAll } from "./crewRunFlow.ts";
import { repairWorktrees } from "./CrewStints.ts";
import { requeueTask, saveTask, stepTask } from "./crewTasks.ts";

const sweepHost = (core: CrewCore, host: string) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    const swept = yield* asRefusal(core.workspace.sweep(host));
    const missing = swept.lanes
      .filter((lane) => lane._tag === "missing")
      .map((lane) => lane.handle);
    for (const handle of missing) core.memory.missingLanes.add(handle);
    if (missing.length > 0) {
      const recovered = yield* asRefusal(core.workspace.recover(host, laneSpecsOn(applied, host)));
      if (recovered._tag === "recovered") {
        for (const handle of recovered.readded) core.memory.missingLanes.delete(handle);
      } else {
        core.memory.lastError = `${host} lost crew work while the Mate was down: ${[
          ...recovered.landings.map((landing) => landing.title),
          ...recovered.branches.map((handle) => `crew/${handle}`),
        ].join(", ")}`;
      }
    }
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    for (const anchor of yield* asRefusal(core.integration.inFlight(host))) {
      const task = tasks.find((row) => row.assignment === anchor.assignment);
      if (task?.state !== "landing") continue;
      if (anchor._tag === "landed") {
        yield* stepTask(core, task, { type: "trailer-found" }, (next) => ({
          ...next,
          landedCommit: anchor.commit,
        }));
      } else {
        yield* stepTask(core, task, { type: "not-fast-forward" });
      }
    }
  });

/** A task whose turn was running when the server stopped: its session died with it. */
const turnDied = (core: CrewCore, threadId: string | null) =>
  threadId === null
    ? Effect.succeed(false)
    : core.projection.getThreadShellById(ThreadId.make(threadId)).pipe(
        Effect.map((shell) =>
          Option.match(shell, {
            onNone: () => false,
            onSome: (thread) =>
              thread.session?.status === "running" || thread.latestTurn?.state === "running",
          }),
        ),
        Effect.orElseSucceed(() => false),
      );

export const boot = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    for (const host of applied.repositories.keys()) {
      yield* sweepHost(core, host).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = error.message;
          }),
        ),
      );
    }
    for (const task of yield* asRefusal(core.store.assignments(CREW_ID))) {
      switch (task.state) {
        case "landing":
          yield* saveTask(core, { ...task, state: "merging" });
          yield* core.background(integrate(core, task.assignment).pipe(Effect.asVoid));
          break;
        case "merging":
          yield* core.background(integrate(core, task.assignment).pipe(Effect.asVoid));
          break;
        case "checking":
          yield* saveTask(core, { ...task, state: "merging" });
          yield* core.background(integrate(core, task.assignment).pipe(Effect.asVoid));
          break;
        case "working": {
          const attempts = yield* asRefusal(core.store.attemptsOf(task.assignment));
          const attempt = attempts.find((row) => row.attempt === task.attempt);
          if (!(yield* turnDied(core, attempt?.threadId ?? null))) break;
          yield* requeueTask(core, task, "the Mate server restarted during its turn");
          break;
        }
        default:
          break;
      }
    }
    for (const [handle, row] of applied.members) {
      const member = memberOf(applied, handle);
      if (member === undefined || row.kind !== "writer" || row.host === null) continue;
      yield* refreshLaneStats(core, member);
      if (row.runCommand !== null) {
        const status = yield* core.app
          .status({ host: row.host, handle })
          .pipe(Effect.orElseSucceed(() => ({ state: "stopped" }) as const));
        if (status.state === "lane-missing") core.memory.missingLanes.add(handle);
        else core.memory.apps.set(handle, status.state);
      }
    }
    yield* settleAllClaims(core);
    // An Allow that waited on a turn the restart ended goes out now.
    for (const handle of applied.members.keys()) yield* grantAfterTurn(core, handle);
    yield* repairWorktrees(core, (yield* core.applied) ?? applied);
    yield* advanceAll(core);
    yield* core.changed;
  });
