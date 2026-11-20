/**
 * What the crew reads in its crewmates' conversations: a run admitted, reached and ended, its cost, and what its task does next.
 *
 * @module crew/engine/decide.observed
 */
import { type EffectId, type KnownEngineEvent, type RunId } from "@t3tools/contracts";
import { AGENT_STOPPED_ITSELF } from "../../../engine/MateEngine.ts";
import { NO_REPORT, attemptEndingOf } from "../crewMachines.ts";
import { deliveryOfCommand } from "./command.ts";
import {
  isOpenTask,
  isTurnPurpose,
  membersInOrder,
  openTaskOf,
  runOn,
  runningRun,
  type ActiveRun,
  type CrewState,
  type DeliveryRecord,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";
import { wrongState, type Builder, userOf, crewAs, step } from "./decide.step.ts";
import {
  RUN_PAUSED,
  RESTART_CUT,
  NEW_SESSION,
  checkpoint,
  sendTurn,
  rotateSession,
} from "./decide.turns.ts";
import { mergeIn, unattended } from "./decide.land.ts";
import { settleLead, reachedLimit, pauseRun } from "./decide.run.ts";

const memberByConversation = (state: CrewState, conversationId: string) =>
  membersInOrder(state).find((member) => member.conversationId === conversationId);

const deliveryOfRun = (state: CrewState, runId: RunId) =>
  Object.entries(state.deliveries).find(([, delivery]) => delivery.runId === runId);

export const observed = (
  b: Builder,
  conversationId: string,
  events: ReadonlyArray<KnownEngineEvent>,
): void => {
  const cursor = b.state.cursors[conversationId] ?? 0;
  // A record is read in order: a batch past the cursor follows one the crew never took in, and
  // taking it would skip that one's events. Its reader reads again from the cursor.
  const first = events[0];
  if (first !== undefined && first.seq > cursor + 1) {
    throw wrongState(`The crew read ${conversationId}'s record past what it took in.`);
  }
  const fresh = events.filter((event) => event.seq > cursor);
  if (fresh.length === 0) return;
  for (const event of fresh) {
    const member = memberByConversation(b.state, conversationId);
    if (member === undefined) mateEvent(b, conversationId, event);
    else crewmateEvent(b, member, event);
  }
  b.emit({ _tag: "ObservedUpTo", observed: conversationId, upTo: fresh.at(-1)!.seq });
};

/** The Mate's own conversation: a landing waits while it runs a turn. */
const mateEvent = (b: Builder, conversationId: string, event: KnownEngineEvent): void => {
  const id = conversationId as typeof b.state.ownerId;
  switch (event._tag) {
    case "RunAdmitted":
    case "RunStarted":
      if (b.state.mate.runId !== event.runId) {
        b.emit({ _tag: "MateRunChanged", mate: id, runId: event.runId });
      }
      return;
    case "RunEnded":
      if (b.state.mate.runId === event.runId) {
        b.emit({ _tag: "MateRunChanged", mate: id, runId: null });
      }
      return;
    default:
      return;
  }
};

const crewmateEvent = (b: Builder, member: MemberRecord, event: KnownEngineEvent): void => {
  switch (event._tag) {
    case "RunQueued": {
      // A delivery's command id names its effect (`crew.deliver`'s receipt key).
      const effectId = deliveryOfCommand(event.commandId);
      const delivery = effectId === undefined ? undefined : b.state.deliveries[effectId];
      if (effectId !== undefined && delivery !== undefined && delivery.runId === null) {
        b.emit({ _tag: "DeliveryLinked", effectId, runId: event.runId });
      }
      return;
    }
    case "RunAdmitted": {
      const linked = deliveryOfRun(b.state, event.runId);
      const delivery = linked?.[1];
      const active: ActiveRun = {
        runId: event.runId,
        principal: delivery?.principal ?? { kind: "engine" },
        delivery: (linked?.[0] ?? null) as EffectId | null,
        taskId: delivery?.taskId ?? null,
        purpose:
          delivery !== undefined &&
          delivery.purpose !== "stop" &&
          delivery.purpose !== "rotate" &&
          delivery.purpose !== "assign" &&
          delivery.purpose !== "archive" &&
          delivery.purpose !== "seam"
            ? delivery.purpose
            : "self",
        admitted: true,
        reached: false,
        since: event.at,
      };
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: { active, lastEnd: null, lastNote: null },
      });
      return;
    }
    case "EffectRequested":
      // Its session opening or its send asked for: admission let the run through.
      if (
        (event.kind === "session.open" || event.kind === "provider.send") &&
        event.runId !== null &&
        member.active?.runId === event.runId
      ) {
        passedAdmission(b, member.handle);
      }
      return;
    case "RunStarted":
      if (member.active?.runId === event.runId) passedAdmission(b, member.handle);
      if (
        b.state.members[member.handle]?.active?.runId === event.runId &&
        !b.state.members[member.handle]!.active!.reached
      ) {
        const current = b.state.members[member.handle]!.active!;
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { active: { ...current, reached: true } },
        });
      }
      return;
    case "ItemClosed":
      if (
        event.runId !== null &&
        event.body.kind === "note" &&
        event.body.card === undefined &&
        event.body.text.trim() !== ""
      ) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { lastNote: { runId: event.runId, text: event.body.text } },
        });
      }
      return;
    case "ItemOpened":
      if (event.body.kind === "marker" && event.body.marker.kind === "compacted") {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { session: { ...member.session, compactions: member.session.compactions + 1 } },
        });
      }
      return;
    case "RunEnded":
      return runEnded(b, member, event);
    default:
      return;
  }
};

/**
 * The crewmate's run got past admission: the engine's `RunAdmitted` only takes its slot, the
 * admission is `run.prepare`'s. A task its first turn starts is working from here; a refused one
 * stays queued with its Can't start row.
 */
const passedAdmission = (b: Builder, handle: string): void => {
  const active = b.state.members[handle]?.active;
  if (active == null) return;
  const task = active.taskId === null ? undefined : b.state.tasks[active.taskId];
  if (active.purpose === "task" && task?.starting != null) {
    step(
      b,
      task,
      {
        type: "dispatch",
        facts: { dependenciesLanded: true, laneIdle: true, hostFrozen: false, admitted: true },
      },
      { starting: null, cantStart: null, midway: null },
    );
  } else if (task !== undefined && task.midway !== null) {
    b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { midway: null } });
  }
};

/** How a crew turn ended, for its task. */
export type Ending =
  | { readonly kind: "completed" }
  | { readonly kind: "overflow" }
  | { readonly kind: "infrastructure"; readonly detail: string }
  | { readonly kind: "stopped" }
  | { readonly kind: "cut" }
  | { readonly kind: "budget" };

const endingOf = (event: Extract<KnownEngineEvent, { _tag: "RunEnded" }>): Ending => {
  if (event.detail === "overflow") return { kind: "overflow" };
  const end = event.end;
  // Its agent stopped the turn with nobody asking: interrupted, as V1 reads it, not broken.
  if (end.kind === "failed" && end.reason === AGENT_STOPPED_ITSELF && event.detail === undefined) {
    return { kind: "stopped" };
  }
  if (event.detail === "provider-error" || end.kind === "failed" || end.kind === "crashed") {
    return {
      kind: "infrastructure",
      detail:
        end.kind === "failed" || end.kind === "crashed" ? end.reason : "the provider broke off",
    };
  }
  if (end.kind === "stopped") return { kind: "stopped" };
  if (end.kind === "cut-by-restart" || end.kind === "usage-limit") return { kind: "cut" };
  return { kind: "completed" };
};

/**
 * A run's cost, from the session total its driver reported (V1's metering): the rise over the
 * total last counted counts toward the run; a total below it starts the count again from it,
 * counting nothing; a turn that reached its agent and reported none leaves the session's history
 * unknown, so its next total counts nothing either.
 */
const countCost = (
  b: Builder,
  handle: string,
  event: Extract<KnownEngineEvent, { _tag: "RunEnded" }>,
  reached: boolean,
): void => {
  const member = b.state.members[handle]!;
  const kept = member.session.costKept === undefined ? 0 : member.session.costKept;
  const total = event.costUsd;
  if (total === undefined) {
    if (reached && event.end.kind === "completed" && kept !== null) {
      b.emit({
        _tag: "CrewmateUpdated",
        handle,
        set: { session: { ...member.session, costKept: null } },
      });
    }
    return;
  }
  const counted = kept !== null && total >= kept ? total - kept : 0;
  if (total !== kept) {
    b.emit({
      _tag: "CrewmateUpdated",
      handle,
      set: { session: { ...member.session, costKept: total } },
    });
  }
  const run = runOn(b.state);
  if (run !== undefined && counted > 0) {
    b.emit({ _tag: "RunUpdated", set: { spentUsd: run.spentUsd + counted } });
  }
  // The attempt it ran for carries its cost.
  const task = openTaskOf(b.state, handle);
  const rows = task?.attemptRows;
  const at = rows?.findIndex((row) => row.attempt === task!.counters.attempt) ?? -1;
  if (task !== undefined && rows !== undefined && at !== -1 && counted > 0) {
    b.emit({
      _tag: "TaskUpdated",
      taskId: task.id,
      set: {
        attemptRows: rows.map((row, index) =>
          index === at ? { ...row, costUsd: row.costUsd + counted } : row,
        ),
      },
    });
  }
};

/** Work a restart left that the crew does not carry on by itself: a row with Continue / Drop it. */
const interrupted = (
  b: Builder,
  member: MemberRecord,
  task: TaskRecord | undefined,
  words: string,
  delivery: DeliveryRecord | undefined,
  runId?: RunId,
): void => {
  const id =
    task === undefined ? `interrupted:${runId ?? member.handle}` : `interrupted:${task.id}`;
  if (b.state.attention.some((row) => row.id === id)) return;
  b.emit({
    _tag: "AttentionRaised",
    row: {
      id,
      handle: member.handle,
      taskId: task?.id ?? null,
      text: words,
      at: b.now,
      operation: {
        kind: "dispatch",
        stage: "dispatching",
        confirmedStage: "prepared",
        status: "interrupted",
        resumeState: task?.state ?? "working",
        startedBy: userOf(delivery?.principal ?? b.envelope.principal),
        attempt: task?.counters.attempt ?? 0,
        row: true,
        ...(delivery?.text == null
          ? {}
          : { turn: { text: delivery.text, principal: delivery.principal } }),
      },
    },
  });
};

const runEnded = (
  b: Builder,
  member: MemberRecord,
  event: Extract<KnownEngineEvent, { _tag: "RunEnded" }>,
): void => {
  const linked = deliveryOfRun(b.state, event.runId);
  const delivery = linked?.[1];
  const active = member.active?.runId === event.runId ? member.active : null;
  if (active === null && delivery === undefined) return;
  const purpose = active?.purpose ?? delivery?.purpose ?? "self";
  const taskId = active?.taskId ?? delivery?.taskId ?? null;
  b.emit({
    _tag: "CrewmateUpdated",
    handle: member.handle,
    set: { active: null, lastEnd: { at: event.at, completed: event.end.kind === "completed" } },
  });
  if (linked !== undefined) b.emit({ _tag: "DeliveryClosed", effectId: linked[0] as EffectId });
  countCost(b, member.handle, event, active?.reached === true);

  if (event.detail === "refused") {
    const words = event.refusal ?? "admission refused the turn";
    const task = taskId === null ? undefined : b.state.tasks[taskId];
    const starting = purpose === "task" ? task?.starting : null;
    if (task !== undefined && starting != null) {
      b.emit({
        _tag: "TaskUpdated",
        taskId: task.id,
        set: { starting: null, cantStart: { text: words, at: event.at } },
      });
      if (runningRun(b.state) !== undefined && !starting.ownCall) pauseRun(b, "refused", words);
    } else if (runningRun(b.state) !== undefined) {
      pauseRun(b, "refused", words);
    } else if (purpose === "continue" && task !== undefined && isOpenTask(task.state)) {
      // A task its restart could not carry on: it waits on the person, Continue or Drop it.
      interrupted(b, member, task, words, delivery);
    }
    return;
  }

  // A turn its agent failed once the run had spent its budget ended at the budget the crew gave
  // it ("Reached maximum budget ($0.05)"), never broke off: sent again, it spent as much again.
  const run = runOn(b.state);
  const ending: Ending =
    event.end.kind === "failed" &&
    run !== undefined &&
    reachedLimit(b.state, run, b.now) === "budget"
      ? { kind: "budget" }
      : endingOf(event);
  if (member.kind === "lead") {
    settleLead(b, b.state.members[member.handle]!, event.runId, ending.kind === "completed");
  }
  if (purpose === "claim-start" || purpose === "claim-release") {
    const host = member.host;
    if (host !== null && b.state.claims[host]?.handle === member.handle) {
      b.effect(
        {
          kind: "crew.claim.read",
          host,
          handle: member.handle,
          purpose: purpose === "claim-start" ? "after-start" : "after-release",
        },
        host,
        { host, handle: member.handle },
      );
    }
  }
  if (
    ending.kind === "cut" &&
    member.kind === "lead" &&
    purpose === "lead-message" &&
    active?.reached !== false
  ) {
    // A person's own turn to the lead a restart cut: kept as a row, never sent again unasked.
    interrupted(b, member, undefined, "The Mate restarted during its turn.", delivery, event.runId);
  } else if (ending.kind === "cut") {
    if (b.state.run?.state === "paused") {
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: { carryOn: { why: RUN_PAUSED, as: null } },
      });
    } else if (active?.reached === false && delivery?.text != null) {
      sendTurn(
        b,
        b.state.members[member.handle]!,
        { text: delivery.text, card: delivery.card },
        delivery.principal,
        purpose !== "self" && isTurnPurpose(purpose) ? purpose : "continue",
        taskId,
      );
    } else if (taskId !== null) {
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        // Carried on by the engine for whoever it ran for, outside their session (V1's).
        set: {
          carryOn: {
            why: RESTART_CUT,
            as: active === null ? null : crewAs(userOf(active.principal)),
          },
        },
      });
    }
  }

  // The lead's turn serves a task it was woken about, which stays its crewmate's.
  if (member.kind === "lead") return;
  const task =
    (taskId === null ? undefined : b.state.tasks[taskId]) ?? openTaskOf(b.state, member.handle);
  if (task === undefined || !isOpenTask(task.state)) return;
  if (member.kind === "writer") {
    b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: true } });
    checkpoint(b, member, b.task(task.id), "turn-end", { ending });
    return;
  }
  turnEnded(b, task, ending);
};

/** How a turn that left its task `working` ended its attempt, and the words its row gives. */
const midwayEnding = (
  state: CrewState,
  ending: Ending,
): { readonly ending: string; readonly detail: string } => {
  const run = state.run;
  return attemptEndingOf({
    state:
      ending.kind === "stopped"
        ? "interrupted"
        : ending.kind === "completed"
          ? "completed"
          : "failed",
    terminalReason: ending.kind === "budget" ? "budget_exhausted" : undefined,
    errorMessage:
      ending.kind === "infrastructure"
        ? ending.detail
        : ending.kind === "cut"
          ? "its turn was cut off by a restart"
          : undefined,
    run:
      run === null
        ? undefined
        : {
            state: run.state,
            reason: run.reason,
            limits: {
              budgetUsd: run.options.budgetUsd,
              timeLimitHours: run.options.timeLimitHours,
              stopAtUsagePercent: run.options.stopAtUsagePercent,
            },
          },
  });
};

/** A crew turn ended (after its WIP commit, for a writer): what its task does next. */
export const turnEnded = (b: Builder, task: TaskRecord, ending: Ending): void => {
  if (task.checkpointing) {
    b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: false } });
  }
  const current = b.task(task.id);
  if (current.state === "merging") return mergeIn(b, current);
  if (current.state !== "working") return;
  switch (ending.kind) {
    case "overflow": {
      const moved = step(
        b,
        current,
        { type: "rotation-ending" },
        {
          midway: { since: b.now, why: "its conversation outgrew its context" },
        },
      );
      if (moved?.state !== "working") return;
      const member = b.member(moved.owner);
      rotateSession(b, member, "context-overflow", crewAs(b.state.run?.startedBy ?? ""));
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: { carryOn: { why: NEW_SESSION, as: null } },
      });
      unattended(b, moved);
      return;
    }
    case "infrastructure":
      step(b, current, { type: "infrastructure-ending" }, { midway: null });
      return;
    case "completed":
    case "stopped":
    case "cut":
    case "budget": {
      const ended = ending.kind === "completed" ? NO_REPORT : midwayEnding(b.state, ending);
      b.emit({
        _tag: "TaskUpdated",
        taskId: current.id,
        set: { midway: { since: b.now, why: ended.detail, ending: ended.ending } },
      });
      unattended(b, current);
      return;
    }
  }
};
