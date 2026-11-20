/**
 * What the crew reads in the conversations it watches: in a crewmate's, a run admitted, reached
 * and ended, its cost, and what its task does next; in the Mate's own, its turns and its deploys.
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
import { deploy } from "./decide.host.ts";

const memberByConversation = (state: CrewState, conversationId: string) =>
  membersInOrder(state).find((member) => member.conversationId === conversationId);

const deliveryOfRun = (state: CrewState, runId: RunId) =>
  Object.entries(state.deliveries).find(([, delivery]) => delivery.runId === runId);

/** What the crew takes in from one event of the Mate's own conversation. */
type MateReading = (b: Builder, mate: CrewState["ownerId"]) => void;
/** What the crew takes in from one event of a crewmate's conversation. */
type CrewmateReading = (b: Builder, member: MemberRecord) => void;

/**
 * Whether the crew reads an event of a conversation, a crewmate's or the Mate's own. Its observer
 * tells the crew only these, with the range they stand in, and the crew's cursor moves past the
 * rest with them; the crew's fold takes them in by the same readings.
 */
export const crewReads = (event: KnownEngineEvent, crewmate: boolean): boolean =>
  (crewmate ? crewmateReading(event) : mateReading(event)) !== undefined;

/**
 * An observed range of a conversation's record, `from` to `upTo`: the events the crew reads in it
 * are folded in order, and its cursor moves to the range's end, past the events it does not read.
 */
export const observed = (
  b: Builder,
  conversationId: string,
  from: number,
  upTo: number,
  events: ReadonlyArray<KnownEngineEvent>,
): void => {
  const cursor = b.state.cursors[conversationId] ?? 0;
  // A record is read in order: a range past the cursor follows one the crew never took in, and
  // taking it would skip that one's events. Its reader reads again from the cursor.
  if (from > cursor + 1) {
    throw wrongState(`The crew read ${conversationId}'s record past what it took in.`);
  }
  // A range read again (its step committed, its reader did not hear) holds nothing new.
  if (upTo <= cursor) return;
  for (const event of events) {
    if (event.seq <= cursor) continue;
    const member = memberByConversation(b.state, conversationId);
    if (member === undefined) mateReading(event)?.(b, conversationId as CrewState["ownerId"]);
    else crewmateReading(event)?.(b, member);
  }
  b.emit({ _tag: "ObservedUpTo", observed: conversationId, upTo });
};

/**
 * The Mate's own conversation: a landing waits while it runs a turn, and a deploy onto a dev
 * service freezes that host's copies until it ends.
 */
const mateReading = (event: KnownEngineEvent): MateReading | undefined => {
  switch (event._tag) {
    case "RunAdmitted":
    case "RunStarted": {
      const runId = event.runId;
      return (b, mate) => {
        if (b.state.mate.runId !== runId) b.emit({ _tag: "MateRunChanged", mate, runId });
      };
    }
    case "RunEnded": {
      const runId = event.runId;
      return (b, mate) => {
        if (b.state.mate.runId === runId) b.emit({ _tag: "MateRunChanged", mate, runId: null });
      };
    }
    default: {
      const migrated = supervisorMigrationOf(event);
      if (migrated !== undefined) {
        return (b) => {
          deploy(b, migrated, "started");
          deploy(b, migrated, "ended");
        };
      }
      const phase = deployPhaseOf(event);
      return phase === undefined ? undefined : (b) => deploy(b, phase.host, phase.phase);
    }
  }
};

const crewmateReading = (event: KnownEngineEvent): CrewmateReading | undefined => {
  switch (event._tag) {
    case "RunQueued": {
      // A delivery's command id names its effect (`crew.deliver`'s receipt key).
      const effectId = deliveryOfCommand(event.commandId);
      if (effectId === undefined) return undefined;
      const runId = event.runId;
      return (b) => {
        const delivery = b.state.deliveries[effectId];
        if (delivery !== undefined && delivery.runId === null) {
          b.emit({ _tag: "DeliveryLinked", effectId, runId });
        }
      };
    }
    case "RunAdmitted": {
      const { runId, at } = event;
      return (b, member) => {
        const linked = deliveryOfRun(b.state, runId);
        const delivery = linked?.[1];
        const active: ActiveRun = {
          runId,
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
          since: at,
        };
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { active, lastEnd: null, lastNote: null },
        });
      };
    }
    case "EffectRequested": {
      // Its session opening or its send asked for: admission let the run through.
      const runId = event.runId;
      if ((event.kind !== "session.open" && event.kind !== "provider.send") || runId === null) {
        return undefined;
      }
      return (b, member) => {
        if (member.active?.runId === runId) passedAdmission(b, member.handle);
      };
    }
    case "RunStarted": {
      const runId = event.runId;
      return (b, member) => {
        if (member.active?.runId === runId) passedAdmission(b, member.handle);
        const current = b.state.members[member.handle]?.active;
        if (current?.runId === runId && !current.reached) {
          b.emit({
            _tag: "CrewmateUpdated",
            handle: member.handle,
            set: { active: { ...current, reached: true } },
          });
        }
      };
    }
    case "ItemClosed": {
      const { runId, body } = event;
      if (runId === null || body.kind !== "note" || body.card !== undefined) return undefined;
      const text = body.text;
      if (text.trim() === "") return undefined;
      return (b, member) =>
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { lastNote: { runId, text } },
        });
    }
    case "ItemOpened":
      if (event.body.kind !== "marker" || event.body.marker.kind !== "compacted") return undefined;
      return (b, member) =>
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { session: { ...member.session, compactions: member.session.compactions + 1 } },
        });
    case "RunEnded": {
      const ended = event;
      return (b, member) => runEnded(b, member, ended);
    }
    default:
      return undefined;
  }
};

const toolNameOf = (name: string): string => name.replace(/^mcp__[^_]+__/, "");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The service a `zerops_deploy` call deploys onto, as its row shows its input. */
const deployTarget = (shows: unknown, input: string | undefined): string | undefined => {
  if (isRecord(shows)) {
    const direct = shows.targetService;
    if (typeof direct === "string") return direct;
    const nested = isRecord(shows.input) ? shows.input.targetService : undefined;
    if (typeof nested === "string") return nested;
  }
  const match = input?.match(/targetService["':=\s]+([A-Za-z0-9-]+)/);
  return match?.[1];
};

/** The dev service a `zerops_dev_server` call names, as its row shows its input. */
const devServerHost = (shows: unknown, input: string | undefined): string | undefined => {
  if (isRecord(shows)) {
    const direct = shows.hostname;
    if (typeof direct === "string") return direct;
    const nested = isRecord(shows.input) ? shows.input.hostname : undefined;
    if (typeof nested === "string") return nested;
  }
  return input?.match(/hostname["':=\s]+([A-Za-z0-9-]+)/)?.[1];
};

/**
 * A `zerops_deploy` call's start or end in the Mate's conversation: its row opened or updated
 * running starts it (the crew freezes a host once), its row closed ends it. A closed row updated
 * again (a late detail) says nothing new of the deploy.
 */
const deployPhaseOf = (
  event: KnownEngineEvent,
): { readonly host: string; readonly phase: "started" | "ended" } | undefined => {
  if (event._tag !== "ItemOpened" && event._tag !== "ItemUpdated" && event._tag !== "ItemClosed") {
    return undefined;
  }
  const body = event.body;
  if (body.kind !== "call" || toolNameOf(body.tool.name) !== "zerops_deploy") return undefined;
  const host = deployTarget(body.shows, body.input);
  if (host === undefined) return undefined;
  // A call a restart cut off (`unreturned`, `stopped`) says nothing of the deploy: it may still run.
  if (body.state === "unreturned" || body.state === "stopped") return undefined;
  if (body.state === "running") {
    return event._tag === "ItemClosed" ? undefined : { host, phase: "started" };
  }
  return event._tag === "ItemClosed" ? { host, phase: "ended" } : undefined;
};

/**
 * The dev service a finished `zerops_dev_server` call moved onto the dev-server supervisor: zcp
 * redeploys it once for the move and says so with `migratedToSupervisor: true` in its JSON result.
 * That redeploy is a deploy of the host the call named, known only when the call returns.
 */
const supervisorMigrationOf = (event: KnownEngineEvent): string | undefined => {
  if (event._tag !== "ItemClosed") return undefined;
  const body = event.body;
  if (body.kind !== "call" || toolNameOf(body.tool.name) !== "zerops_dev_server") return undefined;
  const text = body.result?.resultText;
  if (text === undefined) return undefined;
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(result) || result.migratedToSupervisor !== true) return undefined;
  return devServerHost(body.shows, body.input);
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
