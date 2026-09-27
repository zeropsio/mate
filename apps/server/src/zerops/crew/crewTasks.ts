/**
 * crewTasks — tasks and the turns that work them, without a run (PRD §5.2,
 * §5.2a, §5.3, §6).
 *
 * - **A message** to a crewmate steers its running turn, or opens an
 *   implicit task when it has none (the message is the card), or is the next
 *   turn of its open task. Admission comes first, as the caller, against the
 *   crewmate's login; a refusal changes nothing.
 * - **A task** created for a busy crewmate waits `queued`; when its crewmate
 *   frees up (its task lands, parks or is discarded) the oldest queued task
 *   whose dependencies landed starts, as the person who created it. A refusal
 *   leaves it queued with a *Can't start* row.
 * - **Tell the crew** without a lead: one task per mentioned crewmate, each
 *   carrying the whole message (`routeCrewMessage`).
 *
 * A crewmate works one task at a time; a stint rotates at a task's start or a
 * turn's when `rotationDecision` finds it due (probe 22 failed: a changed
 * prompt reaches a crewmate only in a new conversation).
 *
 * @module crewTasks
 */
import type { ChatAttachment, CrewTaskSource } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { carriedCard, continueCard, taskCard } from "./crewCards.ts";
import {
  asRefusal,
  currentStint,
  dispatchPrincipal,
  isWorking,
  memberOf,
  principalUser,
  refuse,
  requireApplied,
  requireMember,
  runningRun,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
  type PendingContinue,
} from "./crewCore.ts";
import {
  admitCrewTurn,
  crewTurnCommand,
  dispatchCrewTurn,
  modelSelectionFor,
} from "./CrewDispatch.ts";
import { CREW_ID } from "./CrewHome.ts";
import { taskTransition, type TaskCounters, type TaskEvent } from "./crewMachines.ts";
import { implicitTaskTitle, routeCrewMessage } from "./crewRouting.ts";
import { pauseRun } from "./crewRuns.ts";
import { isOpenTask } from "./crewSnapshot.ts";
import { openStint, rotate } from "./CrewStints.ts";
import type { CrewAssignmentRow, CrewStintRow } from "./CrewStore.ts";
import { readTaskCard, type TaskCard, type TaskWait } from "./crewTaskData.ts";
import { rotationDecision, type RotationMoment } from "./rotationDecision.ts";

/* ------------------------------------------------------------ task rows */

/** The board's words for the machine's own reasons to park (`crewMachines`); the engine's are words already. */
const PARK_WORDS: Readonly<Record<string, string>> = {
  reworks: "it came back for rework too often",
  infrastructure: "its turn died with the Mate server twice",
  rotations: "its conversation outgrew its context too often",
  "empty-merge-base": "your tree's history was rewritten",
  "disk-full": "the service's disk is full",
};

export const requireTask = (core: CrewCore, taskId: string) =>
  asRefusal(core.store.getAssignment(taskId)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(refuse("unknown-task", taskId)),
        onSome: Effect.succeed,
      }),
    ),
  );

export const saveTask = (core: CrewCore, row: CrewAssignmentRow) =>
  Effect.gen(function* () {
    const next = { ...row, updatedAt: yield* core.now };
    yield* asRefusal(core.store.putAssignment(next));
    return next;
  });

/**
 * One step of a task's machine, written. A step the task's state does not
 * take is refused as `wrong-state`; a park records its reason for triage.
 */
export const stepTask = (
  core: CrewCore,
  row: CrewAssignmentRow,
  event: TaskEvent,
  change: (next: CrewAssignmentRow) => CrewAssignmentRow = (next) => next,
  /** Counters the row does not carry: re-queues are counted from the task's attempts. */
  counted: Partial<Pick<TaskCounters, "requeues" | "rotations">> = {},
) =>
  Effect.gen(function* () {
    const step = taskTransition(
      {
        state: row.state,
        counters: {
          attempt: Math.max(1, row.attempt),
          reworks: row.reworks,
          remerges: row.remerges,
          requeues: counted.requeues ?? 0,
          rotations: counted.rotations ?? 0,
        },
      },
      event,
    );
    if (step.kind !== "moved") {
      return yield* refuse(
        "wrong-state",
        step.kind === "held" ? step.reason : `#${row.number} is ${row.state}`,
      );
    }
    const parked: TaskWait | undefined =
      step.parked === undefined
        ? undefined
        : { on: "triage", reason: PARK_WORDS[step.parked] ?? step.parked, paths: [] };
    return yield* saveTask(
      core,
      change({
        ...row,
        state: step.to,
        attempt: row.attempt === 0 && step.to !== "working" ? 0 : step.counters.attempt,
        reworks: step.counters.reworks,
        remerges: step.counters.remerges,
        ...(parked === undefined ? {} : { waiting: parked }),
      }),
    );
  });

/** Parks a task with the engine's own words for why. */
export const parkTask = (core: CrewCore, row: CrewAssignmentRow, reason: string) =>
  stepTask(core, row, { type: "park", reason }).pipe(
    Effect.tap((parked) =>
      asRefusal(
        core.store.appendLog({
          crew: CREW_ID,
          run: null,
          at: parked.updatedAt,
          kind: "parked",
          payload: { task: parked.assignment, reason },
        }),
      ),
    ),
  );

export const openTaskOf = (tasks: ReadonlyArray<CrewAssignmentRow>, handle: string) =>
  tasks.find((row) => row.member === handle && isOpenTask(row.state));

export const createTask = (
  core: CrewCore,
  input: {
    readonly owner: string;
    readonly title: string;
    readonly source: CrewTaskSource;
    readonly createdBy: string;
    readonly card: TaskCard;
    readonly dependsOn: ReadonlyArray<string>;
  },
) =>
  core.numbered(
    Effect.gen(function* () {
      const now = yield* core.now;
      const row: CrewAssignmentRow = {
        assignment: `task-${yield* core.uuid}`,
        run: null,
        crew: CREW_ID,
        member: input.owner,
        number: yield* asRefusal(core.store.nextTaskNumber(CREW_ID)),
        title: input.title,
        source: input.source,
        createdBy: input.createdBy,
        card: input.card,
        pending: null,
        dependsOn: input.dependsOn,
        fresh: false,
        state: "queued",
        attempt: 0,
        reworks: 0,
        remerges: 0,
        mergedHead: null,
        check: null,
        review: null,
        report: null,
        waiting: null,
        landedCommit: null,
        createdAt: now,
        updatedAt: now,
      };
      yield* asRefusal(core.store.putAssignment(row));
      return row;
    }),
  );

/* ------------------------------------------------------------ rotation */

/** Rotates the crewmate's conversation now when one is due at this moment; its stint either way. */
export const stintForTurn = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  moment: RotationMoment,
  freshTask: boolean,
) =>
  Effect.gen(function* () {
    const stint = currentStint(applied, member.row.handle);
    if (stint === undefined) {
      return yield* openStint(core, applied, member, { reason: null, seed: null });
    }
    const login = member.row.login ?? "";
    const decision = rotationDecision({
      moment,
      transcriptMissing: false,
      resumeFailed: false,
      ...optionalReason(core.memory.terminalReasons.get(stint.threadId)),
      compactions: stint.compactions,
      rotateAfter: 0,
      stintPrincipal: "",
      principal: "",
      running: { brief: stint.briefVersion, job: stint.jobVersion },
      current: { brief: applied.briefVersion, job: member.row.jobVersion },
      ...optionalApply(core.memory.applyChoices.get(member.row.handle)),
      stintLogin: login,
      login,
      freshTask,
      startFresh: false,
      rotationsThisAttempt: 0,
    });
    return decision.kind === "rotate" || decision.kind === "park"
      ? yield* rotate(core, applied, member, decision.reason)
      : stint;
  });

const optionalReason = (reason: string | undefined) =>
  reason === undefined ? {} : { lastTerminalReason: reason };

const optionalApply = (apply: ReturnType<CrewCore["memory"]["applyChoices"]["get"]>) =>
  apply === undefined ? {} : { apply };

/* ------------------------------------------------------------ turns */

export type StartOutcome =
  | { readonly _tag: "started"; readonly task: CrewAssignmentRow }
  | { readonly _tag: "held"; readonly reason: string }
  | { readonly _tag: "refused"; readonly detail: string };

/** Sends one turn into `stint` as `principal`: admitted, then dispatched. */
export const sendTurn = (
  core: CrewCore,
  member: CrewMember,
  stint: CrewStintRow,
  principal: TurnPrincipal,
  text: string,
  attachments: ReadonlyArray<ChatAttachment> = [],
) =>
  Effect.gen(function* () {
    const command = yield* crewTurnCommand(core, {
      threadId: stint.threadId,
      modelSelection: yield* modelSelectionFor(core, member.row),
      text,
      attachments,
      createdAt: yield* core.now,
    });
    yield* admitCrewTurn(core, command, principal);
    core.memory.working.add(stint.threadId);
    yield* dispatchCrewTurn(core, command).pipe(
      Effect.tapError(() => Effect.sync(() => core.memory.working.delete(stint.threadId))),
    );
  });

/**
 * A task's first turn: its conversation (rotated when due), its copy made
 * ready (a copy whose tip is its last landing starts again from your tree),
 * the policed refs snapshotted, then the card — admitted as `principal`.
 */
export const startTask = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  task: CrewAssignmentRow,
  principal: TurnPrincipal,
  attachments: ReadonlyArray<ChatAttachment> = [],
) =>
  Effect.gen(function* () {
    const held = (reason: string): StartOutcome => ({ _tag: "held", reason });
    if (isWorking(core, applied, member.row.handle)) return held("lane-busy");
    const stint = yield* stintForTurn(core, applied, member, "task-start", task.fresh);
    let resetTo: string | null = null;
    let dispatchCommit: string | null = null;
    if (member.row.kind === "writer") {
      const key = { crew: CREW_ID, handle: member.row.handle };
      const prepared = yield* asRefusal(core.workspace.prepareDispatch(key));
      switch (prepared._tag) {
        case "frozen":
          return held("host-frozen");
        case "lane-missing":
          core.memory.missingLanes.add(member.row.handle);
          return held("lane-missing");
        case "parked":
          yield* parkTask(core, task, "its copy of the code moved outside the engine");
          return held("parked");
        case "ready":
          dispatchCommit = prepared.dispatchCommit;
          resetTo = prepared.reset ? prepared.dispatchCommit : null;
          yield* asRefusal(core.integration.snapshotRefs(key));
      }
    }
    const card = readTaskCard(task.card) ?? { brief: task.title, doneWhen: "", note: null };
    const text = taskCard({
      number: task.number,
      title: task.title,
      source: task.source,
      card,
      resetTo,
    });
    const refused = yield* sendTurn(core, member, stint, principal, text, attachments).pipe(
      Effect.as(undefined),
      Effect.catchTag("CrewCommandError", (error) =>
        error.reason === "not-allowed" ? Effect.succeed(error.detail ?? "") : Effect.fail(error),
      ),
    );
    const now = yield* core.now;
    if (refused !== undefined) {
      core.memory.cantStart.set(task.assignment, { text: refused, at: now });
      return { _tag: "refused", detail: refused } satisfies StartOutcome as StartOutcome;
    }
    core.memory.cantStart.delete(task.assignment);
    const started = yield* stepTask(core, task, {
      type: "dispatch",
      facts: { dependenciesLanded: true, laneIdle: true, hostFrozen: false, admitted: true },
    });
    core.memory.turns.set(`${started.assignment}:${started.attempt}`, 1);
    yield* asRefusal(
      core.store.putAttempt({
        assignment: started.assignment,
        attempt: started.attempt,
        threadId: stint.threadId,
        dispatchCommit,
        tipRef: null,
        rotations: 0,
        ending: null,
        endingDetail: null,
        costUsd: 0,
        startedAt: now,
        endedAt: null,
      }),
    );
    return { _tag: "started", task: started } satisfies StartOutcome as StartOutcome;
  });

/**
 * A further turn of an open task, as `principal` (a message, *Ask to resolve*,
 * *Ask to fix*). When the turn opens a new conversation, it carries the task
 * in a card (why the conversation is new, then the turn's words), so the new
 * stint starts from a card as every stint does.
 */
export const continueTask = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  task: CrewAssignmentRow,
  principal: TurnPrincipal,
  text: string,
  attachments: ReadonlyArray<ChatAttachment> = [],
) =>
  Effect.gen(function* () {
    const before = currentStint(applied, member.row.handle);
    const stint = yield* stintForTurn(core, applied, member, "turn-start", false);
    const sent =
      before !== undefined && before.threadId !== stint.threadId
        ? carriedCard({ number: task.number, title: task.title, reason: stint.reason ?? "", text })
        : text;
    const probe = yield* crewTurnCommand(core, {
      threadId: stint.threadId,
      modelSelection: yield* modelSelectionFor(core, member.row),
      text: sent,
      attachments,
      createdAt: yield* core.now,
    });
    yield* admitCrewTurn(core, probe, principal);
    const working = yield* stepTask(core, task, { type: "message" }, (next) =>
      task.state === "rework" ? { ...next, waiting: null } : next,
    );
    const key = `${working.assignment}:${working.attempt}`;
    core.memory.turns.set(key, (core.memory.turns.get(key) ?? 0) + 1);
    yield* sendTurn(core, member, stint, principal, sent, attachments);
    return working;
  });

/* ------------------------------------------------------------ the queue */

const landed = (tasks: ReadonlyArray<CrewAssignmentRow>, id: string) =>
  tasks.find((row) => row.assignment === id)?.state === "landed";

/**
 * Starts the crewmate's oldest queued task whose dependencies landed, when
 * it is free. `now` names a task dispatched inside its creator's own call,
 * which runs as their session; every other runs as the running run's
 * starter, or without a run as its creator. The lead's tasks start only in
 * a running run (PRD §5.4), and a run whose own dispatch admission refuses
 * pauses with admission's words.
 */
export const pump = (
  core: CrewCore,
  handle: string,
  now?: { readonly taskId: string; readonly principal: TurnPrincipal },
) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    const member = memberOf(applied, handle);
    if (member === undefined || isWorking(core, applied, handle)) return;
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    if (openTaskOf(tasks, handle) !== undefined) return;
    const run = runningRun(applied);
    const next = tasks.find(
      (row) =>
        row.member === handle &&
        row.state === "queued" &&
        (row.source !== "lead" || run !== undefined) &&
        row.dependsOn.every((id) => landed(tasks, id)),
    );
    if (next === undefined) return;
    const ownCall = now !== undefined && now.taskId === next.assignment;
    const principal = ownCall ? now.principal : dispatchPrincipal(applied, next);
    const outcome = yield* startTask(core, applied, member, next, principal);
    if (outcome._tag === "refused" && run !== undefined && !ownCall) {
      yield* pauseRun(core, "refused", outcome.detail);
    }
    yield* core.changed;
  });

/** Pumps every crewmate; a failure is the section's last error, never a stop. */
export const pumpAll = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    if (applied === undefined) return;
    for (const handle of applied.members.keys()) {
      yield* pump(core, handle).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = error.message;
          }),
        ),
      );
    }
  });

/* ------------------------------------------------------------ commands */

/** A crewmate chat's send (PRD §5.2a). */
export const message = (
  core: CrewCore,
  principal: TurnPrincipal,
  input: {
    readonly handle: string;
    readonly text: string;
    readonly attachments: ReadonlyArray<ChatAttachment>;
  },
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, input.handle);
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const open = openTaskOf(tasks, input.handle);
    const current = currentStint(applied, input.handle);
    if (current !== undefined && core.memory.working.has(current.threadId)) {
      yield* sendTurn(core, member, current, principal, input.text, input.attachments);
      return;
    }
    if (open !== undefined) {
      if (open.state === "merging" || open.state === "landing") {
        return yield* refuse(
          "wrong-state",
          `#${open.number} is ${open.state}; try again in a moment`,
        );
      }
      yield* continueTask(core, applied, member, open, principal, input.text, input.attachments);
      return;
    }
    const stint =
      current ?? (yield* openStint(core, applied, member, { reason: null, seed: null }));
    const probe = yield* crewTurnCommand(core, {
      threadId: stint.threadId,
      modelSelection: yield* modelSelectionFor(core, member.row),
      text: input.text,
      attachments: input.attachments,
      createdAt: yield* core.now,
    });
    yield* admitCrewTurn(core, probe, principal);
    const task = yield* createTask(core, {
      owner: input.handle,
      title: implicitTaskTitle(input.text) || "Message",
      source: "message",
      createdBy: principalUser(principal),
      card: { brief: input.text, doneWhen: "", note: null },
      dependsOn: [],
    });
    const reloaded = (yield* core.applied) ?? applied;
    const outcome = yield* startTask(core, reloaded, member, task, principal, input.attachments);
    if (outcome._tag === "refused") return yield* refuse("not-allowed", outcome.detail);
  });

/** *New task* / the board's + New task (PRD §4.4): queued, started now when its crewmate is free. */
export const newTask = (
  core: CrewCore,
  principal: TurnPrincipal,
  input: {
    readonly owner: string;
    readonly title: string;
    readonly brief: string;
    readonly doneWhen: string;
    readonly dependsOn: ReadonlyArray<string>;
  },
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    yield* requireMember(applied, input.owner);
    for (const id of input.dependsOn) yield* requireTask(core, id);
    const task = yield* createTask(core, {
      owner: input.owner,
      title: input.title,
      source: "you",
      createdBy: principalUser(principal),
      card: { brief: input.brief, doneWhen: input.doneWhen, note: null },
      dependsOn: input.dependsOn,
    });
    yield* pump(core, input.owner, { taskId: task.assignment, principal });
  });

/** *Tell the crew* (PRD §5.3). */
export const tell = (
  core: CrewCore,
  principal: TurnPrincipal,
  input: { readonly text: string; readonly mentions: ReadonlyArray<{ readonly handle: string }> },
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const route = routeCrewMessage({
      place: "tell",
      roster: [...applied.members.values()].map((row) => ({ handle: row.handle, kind: row.kind })),
      text: input.text,
      mentions: input.mentions,
    });
    switch (route.kind) {
      case "refused":
        return yield* route.reason === "unknown-mention"
          ? refuse(
              "unknown-crewmate",
              (route.handles ?? []).map((handle) => `@${handle}`).join(", "),
            )
          : refuse("no-mention");
      case "to-crewmate":
        return yield* message(core, principal, {
          handle: route.handle,
          text: input.text,
          attachments: [],
        });
      case "to-lead":
        return yield* message(core, principal, {
          handle: route.lead,
          text:
            route.addressed.length === 0
              ? input.text
              : `${input.text}\n\nAddressed: ${route.addressed.map((handle) => `@${handle}`).join(", ")}`,
          attachments: [],
        });
      case "tasks":
        for (const routed of route.tasks) {
          const task = yield* createTask(core, {
            owner: routed.handle,
            title: routed.title || "Message",
            source: "you",
            createdBy: principalUser(principal),
            card: { brief: input.text, doneWhen: "", note: routed.note ?? null },
            dependsOn: [],
          });
          yield* pump(core, routed.handle, { taskId: task.assignment, principal });
        }
    }
  });

export const editTask = (
  core: CrewCore,
  input: {
    readonly taskId: string;
    readonly title?: string | undefined;
    readonly brief?: string | undefined;
    readonly doneWhen?: string | undefined;
    readonly dependsOn?: ReadonlyArray<string> | undefined;
  },
) =>
  Effect.gen(function* () {
    const row = yield* requireTask(core, input.taskId);
    if (row.state === "landed" || row.state === "discarded") {
      return yield* refuse("wrong-state", `#${row.number} is ${row.state}`);
    }
    const card = readTaskCard(row.card) ?? { brief: "", doneWhen: "", note: null };
    yield* saveTask(core, {
      ...row,
      title: input.title ?? row.title,
      card: {
        ...card,
        brief: input.brief ?? card.brief,
        doneWhen: input.doneWhen ?? card.doneWhen,
      },
      dependsOn: input.dependsOn ?? row.dependsOn,
    });
  });

export const markFresh = (core: CrewCore, taskId: string) =>
  Effect.gen(function* () {
    const row = yield* requireTask(core, taskId);
    if (row.state !== "queued" && row.state !== "proposed") {
      return yield* refuse("wrong-state", `#${row.number} has started`);
    }
    yield* saveTask(core, { ...row, fresh: true });
  });

/** Discards a task from any state; an open task's work is kept aside and its copy reset. */
export const discard = (core: CrewCore, taskId: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const row = yield* requireTask(core, taskId);
    if (isOpenTask(row.state) && isWorking(core, applied, row.member)) {
      return yield* refuse("wrong-state", `@${row.member}'s turn is running`);
    }
    const discarded = yield* stepTask(core, row, { type: "discard" });
    const member = memberOf(applied, row.member);
    if (isOpenTask(row.state) && member?.row.kind === "writer") {
      yield* asRefusal(
        core.workspace.keepAndReset(
          { crew: CREW_ID, handle: row.member },
          { run: null, assignment: row.assignment, attempt: row.attempt, abortMerge: true },
        ),
      );
    }
    core.memory.cantStart.delete(discarded.assignment);
    yield* pump(core, row.member);
  });

/** *Try again* on a stopped task (parked → queued), or on a queued one admission refused. */
export const retryTask = (core: CrewCore, principal: TurnPrincipal, taskId: string) =>
  Effect.gen(function* () {
    const row = yield* requireTask(core, taskId);
    if (row.state !== "parked" && row.state !== "queued") {
      return yield* refuse("wrong-state", `#${row.number} is ${row.state}`);
    }
    const queued =
      row.state === "queued"
        ? row
        : yield* stepTask(core, row, { type: "retry" }, (next) => ({ ...next, waiting: null }));
    yield* pump(core, row.member, { taskId: queued.assignment, principal });
  });

/** The one turn *Save and apply now* sends to a crewmate its save interrupted. */
export const continueAfterSave = (core: CrewCore, handle: string, pending: PendingContinue) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = yield* requireMember(applied, handle);
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const open = openTaskOf(tasks, handle);
    if (open === undefined) return;
    const text = continueCard({ number: open.number, title: open.title, change: pending.change });
    yield* continueTask(
      core,
      applied,
      member,
      open,
      { kind: "crew", startedBy: pending.startedBy },
      text,
    );
  });
