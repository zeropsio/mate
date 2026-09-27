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
 * - token usage and compaction are recorded for the section's context meter;
 *   a turn's cost and the logins' usage windows move a run's meters.
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
  runningRun,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { moveClaim, releaseAfterTurn, settleClaim } from "./crewClaims.ts";
import { integrate, refreshLaneStats } from "./crewLanding.ts";
import { crewStateRef } from "./CrewStateRef.ts";
import { attemptRef, type LaneSpec } from "./CrewWorkspace.ts";
import { recordRunSpend, recordUsage } from "./crewRuns.ts";
import { rotate, rotateBetweenTurns } from "./CrewStints.ts";
import type { CrewAssignmentRow, CrewStintRow } from "./CrewStore.ts";
import { continueAfterSave, openTaskOf, parkTask } from "./crewTasks.ts";
import { settleLeadWake } from "./crewLead.ts";
import { flushState } from "./crewState.ts";
import { CREW_ROTATE_AFTER_DEFAULT } from "./rotationDecision.ts";
import { advance, advanceAll } from "./crewRunFlow.ts";

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

/**
 * Every ref the engine itself writes on a service, which ref policing must not
 * blame on a turn: the crew-state mirror, each task's kept attempts and its
 * landing anchor (another crewmate's landing may be mid-way).
 */
export const engineRefs = (tasks: ReadonlyArray<CrewAssignmentRow>): ReadonlyArray<string> => [
  crewStateRef(CREW_ID),
  ...tasks.flatMap((task) => [
    `refs/t3/crew/landing/${task.assignment}`,
    ...Array.from({ length: Math.max(1, task.attempt) }, (_, index) =>
      attemptRef({ run: task.run, assignment: task.assignment, attempt: index + 1 }),
    ),
  ]),
];

const commitAndPolice = (
  core: CrewCore,
  member: CrewMember,
  task: CrewAssignmentRow | undefined,
  tasks: ReadonlyArray<CrewAssignmentRow>,
) =>
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
        const changes = yield* asRefusal(core.integration.police(key, engineRefs(tasks)));
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
    const shaped = memory.shaped.get(stint.threadId);
    memory.working.delete(stint.threadId);
    memory.endings.set(stint.threadId, event.payload.state);
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
    yield* recordRunSpend(core, event.payload.totalCostUsd);
    if (member.row.kind === "writer") {
      yield* commitAndPolice(
        core,
        member,
        open ?? tasks.findLast((row) => row.member === stint.member),
        tasks,
      );
      yield* refreshLaneStats(core, member);
    }
    const handle = stint.member;
    const pendingContinue = memory.continueAtTurnEnd.get(handle);
    const freshReason = memory.freshAtTurnEnd.get(handle);
    memory.freshAtTurnEnd.delete(handle);
    memory.continueAtTurnEnd.delete(handle);
    if (pendingContinue !== undefined) {
      yield* rotate(core, applied, member, freshReason ?? "prompt-changed");
      yield* continueAfterSave(core, handle, pendingContinue);
    } else if (freshReason !== undefined) {
      yield* rotateBetweenTurns(core, applied, member, freshReason);
    }
    const host = member.row.host;
    if (host !== null && (shaped?.turn === "claim-start" || shaped?.turn === "claim-release")) {
      yield* core.background(settleClaim(core, host));
    } else {
      yield* releaseAfterTurn(core, handle);
    }
    if (member.row.kind === "lead") yield* settleLeadWake(core, applied, member);
    yield* core.background(flushState(core));
    const after = openTaskOf(yield* asRefusal(core.store.assignments(CREW_ID)), handle);
    if (after?.state === "merging") {
      yield* core.background(
        integrate(core, after.assignment).pipe(Effect.andThen(advance(core, handle))),
      );
    } else {
      yield* advance(core, handle);
    }
  });

/** Keeps a thread's last assistant message: the streamed text, closed by its item's end. */
const recordLeadText = (core: CrewCore, stint: CrewStintRow, event: SpiEvent) => {
  const { lastText, textBuffer } = core.memory;
  switch (event.type) {
    case "turn.started":
      lastText.delete(stint.threadId);
      textBuffer.delete(stint.threadId);
      return;
    case "content.delta":
      if (event.payload.streamKind === "assistant_text") {
        textBuffer.set(
          stint.threadId,
          (textBuffer.get(stint.threadId) ?? "") + event.payload.delta,
        );
      }
      return;
    case "item.completed":
      if (event.payload.itemType === "assistant_message") {
        lastText.set(stint.threadId, event.payload.detail ?? textBuffer.get(stint.threadId) ?? "");
        textBuffer.delete(stint.threadId);
      }
      return;
  }
};

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

/** The service a person's own `zerops_dev_server` call restarts; the person wins a held claim. */
const personDevServerHost = (event: SpiEvent): string | undefined => {
  const call = event.toolCall;
  if (event.type !== "item.started" || call?.name !== "zerops_dev_server") return undefined;
  const args = call.arguments;
  const host =
    typeof args === "object" && args !== null && "hostname" in args
      ? (args as { readonly hostname?: unknown }).hostname
      : undefined;
  return typeof host === "string" ? host : undefined;
};

/** Handles one provider event; `deploys` remembers which running deploy froze which service. */
export const makeTurnHandler = (core: CrewCore) => {
  const deploys = new Map<string, string>();

  const freeze = (applied: AppliedCrew, host: string) =>
    Effect.gen(function* () {
      yield* asRefusal(core.workspace.freeze(host));
      if (core.memory.claims.get(host)?.state === "held") {
        yield* moveClaim(core, host, "self-deploy");
      }
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
      yield* advanceAll(core);
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
      const personDevServer = stint === undefined ? personDevServerHost(event) : undefined;
      if (
        personDevServer !== undefined &&
        core.memory.claims.get(personDevServer)?.state === "held"
      ) {
        yield* moveClaim(core, personDevServer, "person-dev-server");
      }
      if (event.type === "account.rate-limits.updated") yield* recordUsage(core, event);
      if (stint === undefined) {
        // A landing a run holds while your chat works goes on once it is done.
        if (event.type === "turn.completed" && runningRun(applied) !== undefined) {
          yield* core.background(advanceAll(core));
        }
        return;
      }
      // The lead's words, for the answer its question wake carries back (`crewLead`).
      if (applied.members.get(stint.member)?.kind === "lead") recordLeadText(core, stint, event);
      switch (event.type) {
        case "turn.started":
          core.memory.working.add(stint.threadId);
          core.memory.terminalReasons.delete(stint.threadId);
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
            const spec = applied.definition.members.find((entry) => entry.handle === stint.member);
            const rotateAfter = spec?.rotateAfter ?? CREW_ROTATE_AFTER_DEFAULT;
            // rotateAfter compactions: the stint rotates at its crewmate's next task (CONCEPT §3A.4).
            yield* asRefusal(
              core.store.updateStint(stint.crew, stint.member, stint.stint, (row) => ({
                ...row,
                compactions: row.compactions + 1,
                rotatePending:
                  row.rotatePending || (rotateAfter > 0 && row.compactions + 1 >= rotateAfter),
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
