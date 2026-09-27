/**
 * crewTurns — what the engine does with a crew thread's provider events
 * (`ProviderRuntimeEventBus`), and with a self-deploy onto a service that
 * holds lanes.
 *
 * - `turn.started` marks the crewmate working and its stint active.
 * - `turn.completed` is the turn's end: the WIP commit under the lane-commit
 *   precondition, ref policing, the lane's figures; a save waiting on this
 *   turn rotates the stint (and *Save and apply now* sends its continue
 *   turn); a task the crewmate reported done merges in and checks; a
 *   crewmate that freed up starts its next queued task. An interrupted turn
 *   ends like any other — its work is committed too.
 * - token usage and compaction are recorded for the section's context meter.
 * - `zerops_deploy` onto a service with lanes (any thread) freezes the
 *   service's lanes and interrupts their turns; when the deploy ends and the
 *   mount answers, `recover` brings the lanes back or names what was lost.
 *
 * @module crewTurns
 */
import { CommandId, ThreadId, type SpiEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  asRefusal,
  memberOf,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { integrate, refreshLaneStats } from "./crewLanding.ts";
import type { LaneSpec } from "./CrewWorkspace.ts";
import { rotate } from "./CrewStints.ts";
import type { CrewAssignmentRow, CrewStintRow } from "./CrewStore.ts";
import { continueAfterSave, openTaskOf, parkTask, pump } from "./crewTasks.ts";

const GUARD_WORDS = {
  dependencies: "an unignored dependency directory",
  secrets: "a secret file",
  size: "a file over the size cap",
} as const;

/** The lane specs of a host's writers, for a recovery that sets lanes up again. */
export const laneSpecsOn = (applied: AppliedCrew, host: string): ReadonlyArray<LaneSpec> =>
  applied.definition.members.flatMap((spec) => {
    const row = applied.members.get(spec.handle);
    if (spec.kind !== "writer" || spec.host !== host || row === undefined) return [];
    return [
      {
        crew: CREW_ID,
        handle: spec.handle,
        host,
        setup: spec.setup,
        crewPort: row.crewPort ?? undefined,
        env: spec.env,
      },
    ];
  });

const commitAndPolice = (core: CrewCore, member: CrewMember, task: CrewAssignmentRow | undefined) =>
  Effect.gen(function* () {
    const key = { crew: CREW_ID, handle: member.row.handle };
    const turnKey = task === undefined ? "" : `${task.assignment}:${task.attempt}`;
    const committed = yield* asRefusal(
      core.workspace.commitTurn(key, {
        assignment: task?.assignment ?? "idle",
        turn: core.memory.turns.get(turnKey) ?? 1,
      }),
    );
    switch (committed._tag) {
      case "lane-missing":
        core.memory.missingLanes.add(member.row.handle);
        return;
      case "parked":
        if (task !== undefined) {
          yield* parkTask(
            core,
            task,
            committed.reason === "unknown-tip"
              ? "its copy of the code moved outside the engine"
              : `the WIP commit stopped on ${GUARD_WORDS[committed.reason]}: ${committed.paths.join(", ")}`,
          );
        }
        return;
      case "committed":
      case "unchanged": {
        const changes = yield* asRefusal(core.integration.police(key));
        if (changes.length > 0 && task !== undefined) {
          yield* parkTask(
            core,
            task,
            `a ref changed outside the engine: ${changes.map((change) => change.ref).join(", ")}`,
          );
        }
        return;
      }
      case "rework":
      case "frozen":
        return;
    }
  });

const recordCost = (core: CrewCore, task: CrewAssignmentRow, costUsd: number | undefined) =>
  costUsd === undefined || costUsd <= 0
    ? Effect.void
    : Effect.gen(function* () {
        const attempts = yield* asRefusal(core.store.attemptsOf(task.assignment));
        const attempt = attempts.find((row) => row.attempt === task.attempt);
        if (attempt !== undefined) {
          yield* asRefusal(
            core.store.putAttempt({ ...attempt, costUsd: attempt.costUsd + costUsd }),
          );
        }
      });

const turnEnded = (
  core: CrewCore,
  stint: CrewStintRow,
  event: Extract<SpiEvent, { readonly type: "turn.completed" }>,
) =>
  Effect.gen(function* () {
    const { memory } = core;
    memory.working.delete(stint.threadId);
    memory.shaped.delete(stint.threadId);
    if (event.payload.terminalReason !== undefined) {
      memory.terminalReasons.set(stint.threadId, event.payload.terminalReason);
    }
    if (event.payload.state === "failed") {
      memory.lastError = event.payload.errorMessage ?? `@${stint.member}'s turn failed`;
    }
    const applied = yield* core.applied;
    const member = applied === undefined ? undefined : memberOf(applied, stint.member);
    if (applied === undefined || member === undefined) return;
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const open = openTaskOf(tasks, stint.member);
    if (open !== undefined) yield* recordCost(core, open, event.payload.totalCostUsd);
    if (member.row.kind === "writer") {
      yield* commitAndPolice(
        core,
        member,
        open ?? tasks.findLast((row) => row.member === stint.member),
      );
      yield* refreshLaneStats(core, member);
    }
    const handle = stint.member;
    const pendingContinue = memory.continueAtTurnEnd.get(handle);
    if (memory.freshAtTurnEnd.has(handle) || pendingContinue !== undefined) {
      memory.freshAtTurnEnd.delete(handle);
      memory.continueAtTurnEnd.delete(handle);
      yield* rotate(core, applied, member, "prompt-changed");
      if (pendingContinue !== undefined) yield* continueAfterSave(core, handle, pendingContinue);
    }
    const after = openTaskOf(yield* asRefusal(core.store.assignments(CREW_ID)), handle);
    if (after?.state === "merging") {
      yield* core.background(
        integrate(core, after.assignment).pipe(Effect.andThen(pump(core, handle))),
      );
    } else if (after === undefined) {
      yield* pump(core, handle);
    }
  });

/** A deploy's target when it replaces a service that holds lanes. */
const deployTarget = (applied: AppliedCrew, event: SpiEvent): string | undefined => {
  const call = event.toolCall;
  if (call === undefined || call.name !== "zerops_deploy") return undefined;
  const args = call.arguments;
  const target =
    typeof args === "object" && args !== null && "targetService" in args
      ? (args as { readonly targetService?: unknown }).targetService
      : undefined;
  return typeof target === "string" && applied.repositories.has(target) ? target : undefined;
};

/** Handles one provider event; `deploys` remembers which running deploy froze which service. */
export const makeTurnHandler = (core: CrewCore) => {
  const deploys = new Map<string, string>();

  const freeze = (applied: AppliedCrew, host: string) =>
    Effect.gen(function* () {
      yield* asRefusal(core.workspace.freeze(host));
      const now = yield* core.now;
      for (const stint of applied.stints) {
        const member = applied.members.get(stint.member);
        if (
          stint.retiredAt !== null ||
          member?.host !== host ||
          !core.memory.working.has(stint.threadId)
        ) {
          continue;
        }
        yield* asRefusal(
          core.orchestration.dispatch({
            type: "thread.turn.interrupt",
            commandId: CommandId.make(`crew:freeze:${stint.threadId}:${now}`),
            threadId: ThreadId.make(stint.threadId),
            createdAt: now,
          }),
        );
      }
    });

  const recover = (applied: AppliedCrew, host: string) =>
    Effect.gen(function* () {
      yield* core.repositories.refresh;
      const outcome = yield* asRefusal(core.workspace.recover(host, laneSpecsOn(applied, host)));
      if (outcome._tag === "lost") {
        core.memory.lastError =
          `${host} came back from its deploy without crew work: ` +
          [
            ...outcome.landings.map((landing) => `landing of ${landing.title}`),
            ...outcome.branches.map((handle) => `crew/${handle}`),
            ...outcome.wip.map((lane) => `crew/${lane.handle} work since ${lane.since}`),
          ].join(", ");
        return;
      }
      for (const handle of outcome.readded) core.memory.missingLanes.delete(handle);
      for (const handle of applied.members.keys()) yield* pump(core, handle);
    });

  return (event: SpiEvent) =>
    Effect.gen(function* () {
      const applied = yield* core.applied;
      if (applied === undefined) return;
      const target = deployTarget(applied, event);
      if (target !== undefined && event.itemId !== undefined) {
        if (event.type === "item.started" && !deploys.has(event.itemId)) {
          deploys.set(event.itemId, target);
          yield* freeze(applied, target);
        } else if (event.type === "item.completed" && deploys.delete(event.itemId)) {
          yield* core.background(recover(applied, target));
        }
      }
      const stint = applied.stints.find((row) => row.threadId === event.threadId);
      if (stint === undefined) return;
      switch (event.type) {
        case "turn.started":
          core.memory.working.add(stint.threadId);
          core.memory.terminalReasons.delete(stint.threadId);
          if (stint.sessionId === null) {
            yield* asRefusal(
              core.store.updateStint(stint.crew, stint.member, stint.stint, (row) => ({
                ...row,
                sessionId: event.turnId ?? stint.threadId,
              })),
            );
            yield* asRefusal(core.reload);
          }
          break;
        case "turn.completed":
          yield* turnEnded(core, stint, event);
          break;
        case "thread.token-usage.updated":
          core.memory.context.set(stint.threadId, {
            tokens: event.payload.usage.usedTokens,
            window: event.payload.usage.maxTokens ?? 0,
          });
          break;
        case "thread.state.changed":
          if (event.payload.state === "compacted") {
            yield* asRefusal(
              core.store.updateStint(stint.crew, stint.member, stint.stint, (row) => ({
                ...row,
                compactions: row.compactions + 1,
              })),
            );
            yield* asRefusal(core.reload);
          }
          break;
        default:
          return;
      }
      yield* core.changed;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          core.memory.lastError = error.message;
        }),
      ),
    );
};
