/**
 * `decideCrew(state, envelope, now)`: every rule of a Mate's crew, pure. One writer per crew; it
 * never waits on a driver, a copy or a check.
 *
 * - **Out**, the crew asks for effects: a `crew.deliver` to a crewmate's conversation (a card or
 *   a person's message as a turn, a Stop, a new session, its agent, a seam row), and the git work
 *   in its copy as a chain (`crew.checkpoint → crew.mergeIn → crew.check → crew.land`).
 * - **In**, it reads each crewmate's conversation through a cursor: a run admitted, reached, ended
 *   (with its cost and why), the agent's last message, a compaction.
 * - **Timers** are wakes on the crew owner: the lead's spacing, a question's 15 minutes, a task
 *   left unattended, the run's working time, a claim's request, a redeploy's reads.
 *
 * After every accepted input the crew advances: each free crewmate's open task goes on in a
 * running run (rework, a nudge, a landing, a pause's carry-on), or its next queued task starts;
 * the lead is woken for the next review or question; the run's clock follows its crew's work.
 * The machines (`crewMachines`), the rotation table (`rotationDecision`), the routing
 * (`crewRouting`), the versions (`crewVersions`) and the door (`crewAccess`) are the guards.
 *
 * @module crew/engine/decide
 */
import {
  type ChatAttachment,
  type CrewCommand,
  crewCommandReach,
  type EffectId,
  type KnownEngineEvent,
  type Principal,
  type RunId,
  type WakeId,
} from "@t3tools/contracts";
import type { CrewDefinition } from "@t3tools/shared/crewHome";

import { AGENT_STOPPED_ITSELF } from "../../../engine/MateEngine.ts";
import {
  CHECKED_STATES,
  EDITED_AFTER_CHECK,
  MOVED_AFTER_CHECK,
  NO_REPORT,
  attemptEndingOf,
  initialTaskState,
  runTransition,
} from "../crewMachines.ts";
import { implicitTaskTitle, routeCrewMessage } from "../crewRouting.ts";
import type { CrewProposedTask, CrewReportInput } from "../crewSeams.ts";
import {
  answerCard,
  continueCard,
  fixCard,
  nudgeCard,
  resolveCard,
  reworkCard,
  taskCard,
} from "./cards.ts";
import {
  type CrewDecision,
  type CrewEffectPayload,
  type CrewEffectValues,
  type CrewEnvelope,
  type CrewInput,
  type CrewToolCall,
  deliveryOfCommand,
  type HostRead,
  taskAssignment,
  type TaskSeen,
} from "./command.ts";
import type { CrewImport } from "./importV1Crew.ts";
import {
  copyBusy,
  copyWriting,
  hostFrozen,
  isFree,
  isOpenTask,
  isTurnPurpose,
  isWorking,
  membersInOrder,
  openTaskOf,
  questionKey,
  runOn,
  runningRun,
  tasksInOrder,
  tasksOf,
  type ActiveRun,
  DEFAULT_CREW_TIMING,
  frozenHosts,
  type AttentionRecord,
  type CrewState,
  type CrewTiming,
  type DeliveryRecord,
  type MemberRecord,
  type PendingEffect,
  type TaskRecord,
} from "./state.ts";
import {
  INDEX_LOCK,
  busyWords,
  Rejected,
  wrongState,
  Builder,
  userOf,
  crewAs,
  dispatchPrincipal,
  step,
  stepOrRefuse,
  park,
  createTask,
  attemptsOf,
  landed,
  statsSet,
  laneEnvironmentOf,
  requireApplied,
  requireFreeCopy,
} from "./decide.step.ts";
import {
  RUN_PAUSED,
  STOPPED_MIDWAY,
  RESTART_CUT,
  NEW_SESSION,
  checkpoint,
  deliver,
  sendTurn,
  rotateSession,
  startTask,
  continueTask,
} from "./decide.turns.ts";
import {
  land,
  seam,
  mergeIn,
  checkPassed,
  unattended,
  reviewTask,
  landPress,
  landNow,
} from "./decide.land.ts";
import { createLane, assignAgent, applyHome, saveHome } from "./decide.home.ts";
import {
  wakeLead,
  renewLeadWakes,
  settleLead,
  reachedLimit,
  pauseRun,
  checkLimits,
  followClock,
  runFrom,
  startRun,
  requireRun,
  resumeRun,
  stopRun,
  finishRun,
} from "./decide.run.ts";
import {
  moveClaim,
  requestClaim,
  grantClaim,
  releaseClaim,
  claimTurn,
  claimRead,
} from "./decide.claims.ts";

/* ------------------------------------------------------------ constants */

/** How long a crewmate's question waits on the lead before the person sees it too. */
export const QUESTION_TO_PERSON_MS = 15 * 60_000;

/** An attention row the flip's import raised: *Continue* takes its task up where it stood. */
export const IMPORTED_ROW = "imported:";
/** Why a task V1 left mid-way goes on: what its crewmate reads. */
export const UPDATE_WHY = "It stopped for an update to the Mate; carry on from where it stood.";

/* ------------------------------------------------------------ the step */

export const decideCrew = (state: CrewState, envelope: CrewEnvelope, now: number): CrewDecision => {
  const b = new Builder(state, envelope, now);
  try {
    handle(b, envelope.input);
    // The import moves nothing of its own: the crew goes on at the next input, never in it.
    if (b.state.applied !== null && envelope.input._tag !== "ImportV1") settle(b);
  } catch (error) {
    if (error instanceof Rejected) {
      return { _tag: "Reject", rejection: { reason: error.reason, detail: error.detail } };
    }
    throw error;
  }
  return {
    _tag: "Accept",
    step: {
      events: b.events,
      effects: b.effects,
      result: {
        _tag: "Accepted",
        seq: b.state.headSeq,
        ...(b.reply === undefined ? {} : { reply: b.reply }),
        ...(b.taskIds.length === 0 ? {} : { taskIds: b.taskIds }),
      },
    },
  };
};

const handle = (b: Builder, input: CrewInput): void => {
  switch (input._tag) {
    case "Press":
      return pressed(b, input.press, input.door.refusal, input.home, input.seen, input.hosts);
    case "Tool":
      return tool(b, input.handle, input.call);
    case "Observed":
      return observed(b, input.conversationId, input.events);
    case "Deploy":
      return deploy(b, input.host, input.phase);
    case "Gauge":
      if ((b.state.usage[input.login] ?? null) !== input.usagePercent) {
        b.emit({ _tag: "UsageRead", login: input.login, percent: input.usagePercent });
      }
      return;
    case "LoginsChanged":
      return loginsChanged(b, input.logins);
    case "WakeFired":
      return wakeFired(b, input.wakeId);
    case "EffectSettled":
      return settled(b, input.effectId, input.outcome);
    case "Recovered":
      return recovered(b);
    case "ProcessesMoved":
      for (const host of frozenHosts(b.state)) if (!recovering(b, host)) readDeploy(b, host);
      return;
    case "Configure":
      if (JSON.stringify(b.state.timing) !== JSON.stringify(input.timing)) {
        b.emit({ _tag: "CrewConfigured", timing: input.timing });
      }
      return;
    case "ImportV1":
      return importV1(b, input.crew);
  }
};

/* ------------------------------------------------------------ starting and carrying on */

/**
 * Starts the crewmate's oldest queued task whose dependencies landed, when it is free: a press
 * names its own task, which then starts as the presser; every other starts as the running run's
 * starter, or without a run as its creator. The lead's plan starts only in a running run, and a
 * start admission refused waits for *Try again* or a sign-in.
 */
const pump = (
  b: Builder,
  handle: string,
  own?: { readonly taskId: string; readonly principal: Principal },
): void => {
  const member = b.state.members[handle];
  if (member === undefined || member.kind === "lead" || !isFree(b.state, handle)) return;
  if (openTaskOf(b.state, handle) !== undefined) return;
  if (hostFrozen(b.state, member.host)) return;
  if (member.lane !== null && member.lane.state !== "ready") return;
  const run = runningRun(b.state);
  const startable = tasksOf(b.state, handle).filter(
    (task) =>
      task.state === "queued" &&
      task.starting === null &&
      task.cantStart === null &&
      (task.source !== "lead" || run !== undefined) &&
      task.dependsOn.every((id) => landed(b.state, id)),
  );
  const next = startable.find((task) => task.id === own?.taskId) ?? startable[0];
  if (next === undefined) return;
  const ownCall = own !== undefined && own.taskId === next.id;
  startTask(b, next, ownCall ? own.principal : dispatchPrincipal(b.state, next), ownCall);
};

/** What a running run does with a free crewmate's open task. */
const carryOn = (b: Builder, member: MemberRecord, task: TaskRecord): void => {
  const run = runningRun(b.state);
  if (member.carryOn !== null && task.state === "working") {
    if (member.carryOn.as === null && run === undefined) return;
    const as = member.carryOn.as ?? dispatchPrincipal(b.state, task);
    b.emit({ _tag: "CrewmateUpdated", handle: member.handle, set: { carryOn: null } });
    continueTask(b, task, as, continueCard(task, member.carryOn.why), "continue");
    return;
  }
  if (run === undefined) return;
  const as = dispatchPrincipal(b.state, task);
  switch (task.state) {
    case "rework": {
      const on = task.wait?.on;
      if (on === "conflict") {
        continueTask(b, task, as, resolveCard(task, task.wait?.paths ?? []), "rework");
      } else if (on === "check-failed") {
        continueTask(
          b,
          task,
          as,
          fixCard(task, member.check ?? "the check", task.check?.output ?? ""),
          "rework",
        );
      } else if (on === "review") {
        continueTask(b, task, as, reworkCard(task, task.wait?.reason ?? ""), "rework");
      }
      return;
    }
    case "ready": {
      const landing = run.options.landing;
      if (landing === "check" || (landing === "lead" && task.review?.verdict === "accept")) {
        land(b, task, as, "run");
      }
      return;
    }
    case "working": {
      if (
        task.midway === null ||
        member.lastEnd?.completed !== true ||
        task.nudgedAttempt === task.counters.attempt
      ) {
        return;
      }
      b.emit({
        _tag: "TaskUpdated",
        taskId: task.id,
        set: { nudgedAttempt: task.counters.attempt },
      });
      continueTask(b, b.task(task.id), as, nudgeCard(task), "nudge");
      return;
    }
    default:
      return;
  }
};

/** A crewmate is free, or something it waits on moved: its open task goes on, or its next starts. */
const advanceMember = (b: Builder, handle: string): void => {
  const member = b.state.members[handle];
  if (member === undefined || !isFree(b.state, handle)) return;
  // A copy a redeploy may still replace is left alone until it ends.
  if (hostFrozen(b.state, member.host)) return;
  if (member.rotateWhenFree !== null) {
    rotateSession(b, member, member.rotateWhenFree, crewAs(b.state.run?.startedBy ?? ""));
  }
  if (claimTurn(b, b.state.members[handle]!)) return;
  const open = openTaskOf(b.state, handle);
  if (open === undefined) return pump(b, handle);
  if (open.landAs !== null && open.state === "ready") {
    land(b, open, open.landAs, "press-later");
    return;
  }
  carryOn(b, b.state.members[handle]!, open);
};

/** The run's clock follows its crew's work, its limits are checked, and the crew advances. */
const settle = (b: Builder): void => {
  checkLimits(b);
  for (const member of membersInOrder(b.state)) advanceMember(b, member.handle);
  wakeLead(b);
  followClock(b);
};

/* ------------------------------------------------------------ presses */

const pressed = (
  b: Builder,
  press: CrewCommand,
  refusal: string | null,
  home: CrewDefinition | undefined,
  seen: TaskSeen | undefined,
  hosts?: Readonly<Record<string, HostRead>>,
): void => {
  const reach = crewCommandReach(press);
  if (refusal !== null && reach.kind !== "reads" && reach.kind !== "stops") {
    throw new Rejected("not-allowed", refusal);
  }
  const as = b.envelope.principal;
  if (press._tag !== "apply") requireApplied(b);
  switch (press._tag) {
    case "apply":
      if (home === undefined)
        throw new Rejected("invalid-definition", "the crew home is unreadable");
      applyHome(b, home, "nextTurn", hosts);
      return;
    case "briefSave":
    case "jobSave":
      if (home === undefined)
        throw new Rejected("invalid-definition", "the crew home is unreadable");
      return saveHome(b, home, press.apply);
    case "start":
      return startRun(b, {
        budgetUsd: press.budgetUsd,
        timeLimitHours: press.timeLimitHours,
        stopAtUsagePercent: press.stopAtUsagePercent,
        landing: press.landing,
        devGrant: press.devGrant,
        leadMayStart: press.leadMayStart,
      });
    case "pause": {
      const run = requireRun(b, press.runId);
      if (runTransition(runFrom(run), { type: "pause", reason: "person" }).kind !== "moved") {
        throw wrongState(`the run is ${runFrom(run)}`);
      }
      return pauseRun(b, "person", null);
    }
    case "resume":
      return resumeRun(b, press);
    case "stop":
      return stopRun(b, press.runId);
    case "finish":
      return finishRun(b, requireRun(b, press.runId));
    case "message":
      return message(b, press.handle, press.text, as, press.attachments);
    case "tell":
      return tell(b, press.text, press.mentions, as);
    case "taskCreate": {
      b.member(press.owner);
      for (const id of press.dependsOn) b.task(id);
      requireFreeCopy(b, press.owner);
      const task = createTask(b, {
        owner: press.owner,
        title: press.title,
        source: "you",
        createdBy: userOf(as),
        brief: press.brief,
        doneWhen: press.doneWhen,
        note: null,
        dependsOn: press.dependsOn,
      });
      return pump(b, press.owner, { taskId: task.id, principal: as });
    }
    case "taskEdit": {
      const task = b.task(press.taskId);
      if (task.state === "landed" || task.state === "discarded") {
        throw wrongState(`#${task.number} is ${task.state}`);
      }
      // The person edits from the task they saw: one that moved since is theirs to look at again.
      // An edit that names no read (an older client, V1's press) writes as V1's did.
      if (seen !== undefined && (seen.state !== task.state || seen.attempts !== attemptsOf(task))) {
        throw wrongState(`#${task.number} is ${task.state}`);
      }
      b.emit({
        _tag: "TaskUpdated",
        taskId: task.id,
        set: {
          ...(press.title === undefined ? {} : { title: press.title }),
          card: {
            ...task.card,
            ...(press.brief === undefined ? {} : { brief: press.brief }),
            ...(press.doneWhen === undefined ? {} : { doneWhen: press.doneWhen }),
          },
          ...(press.dependsOn === undefined ? {} : { dependsOn: press.dependsOn }),
        },
      });
      if (press.dependsOn !== undefined && task.state === "queued") {
        pump(b, task.owner, { taskId: task.id, principal: as });
      }
      return;
    }
    case "discard":
      return discard(b, b.task(press.taskId));
    case "markFresh": {
      const task = b.task(press.taskId);
      if (task.state !== "queued" && task.state !== "proposed") {
        throw wrongState(`#${task.number} has started`);
      }
      b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { fresh: true } });
      return;
    }
    case "taskRetry": {
      const task = b.task(press.taskId);
      requireFreeCopy(b, task.owner);
      if (task.state === "queued" && task.cantStart !== null) {
        b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { cantStart: null } });
      } else if (task.state === "parked") {
        stepOrRefuse(b, task, { type: "retry" }, { wait: null, started: false });
      } else {
        throw wrongState(`#${task.number} is ${task.state}`);
      }
      return pump(b, task.owner, { taskId: task.id, principal: as });
    }
    case "planAccept":
    case "planDiscard": {
      const tasks = press.taskIds.map((id) => b.task(id));
      const late = tasks.find((task) => task.state !== "proposed");
      if (late !== undefined) throw wrongState(`#${late.number} is ${late.state}`);
      for (const task of tasks) {
        step(b, task, press._tag === "planAccept" ? { type: "accept" } : { type: "discard" });
      }
      return;
    }
    case "review": {
      const task = b.task(press.taskId);
      if (task.state !== "review") throw wrongState(`#${task.number} is ${task.state}`);
      reviewTask(b, task, press.verdict, press.note, null);
      return;
    }
    case "land":
      return landPress(b, b.task(press.taskId), as);
    case "landNow":
      return landNow(b, b.task(press.taskId), as);
    case "askResolve":
    case "askFix": {
      const task = b.task(press.taskId);
      const on = press._tag === "askResolve" ? "conflict" : "check-failed";
      if (task.state !== "rework" || task.wait?.on !== on) {
        throw wrongState(`#${task.number} is ${task.state}`);
      }
      requireFreeCopy(b, task.owner);
      const member = b.member(task.owner);
      continueTask(
        b,
        task,
        as,
        on === "conflict"
          ? resolveCard(task, task.wait.paths)
          : fixCard(task, member.check ?? "the check", task.check?.output ?? ""),
        "rework",
      );
      return;
    }
    case "answer":
      return answer(b, press.handle, press.taskId, press.text, as);
    case "showOnDev": {
      const member = b.member(press.handle);
      if (member.host === null) throw wrongState(`@${member.handle} has no copy of the code`);
      requestClaim(b, member, null);
      return grantClaim(b, member.host, as);
    }
    case "claimGrant":
      return grantClaim(b, press.host, as);
    case "claimDeny": {
      const claim = b.state.claims[press.host];
      if (claim === undefined) throw wrongState(`${press.host} has no request`);
      moveClaim(b, press.host, "deny");
      return;
    }
    case "claimRelease":
      return releaseClaim(b, press.host, as, "press");
    case "startFresh": {
      const member = b.member(press.handle);
      if (member.active !== null) throw wrongState(`@${member.handle}'s turn is running`);
      if (isFree(b.state, member.handle)) rotateSession(b, member, "start-fresh", as);
      else {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { rotateWhenFree: "start-fresh" },
        });
      }
      return;
    }
    case "memoryEdit":
    case "memoryRemove":
    case "forgetMemory":
      b.member(press.handle);
      b.emit({ _tag: "MemoryChanged", handle: press.handle, op: press });
      return;
    case "removeCrewmate":
      return removeCrewmate(b, b.member(press.handle), press.discardUnlanded);
    case "appRun":
    case "appStop": {
      const member = b.member(press.handle);
      if (member.kind !== "writer" || member.runCommand === null) {
        throw wrongState(`@${member.handle} has no app to run`);
      }
      if (press._tag === "appRun") return runApp(b, member, member.runCommand);
      b.effect(
        { kind: "crew.app.stop", handle: member.handle, host: member.host! },
        member.handle,
        { handle: member.handle },
      );
      return;
    }
    case "thawHost": {
      // Only a host whose redeploy could not be read for long is thawed on the person's word.
      if (!b.state.attention.some((row) => row.id === `deploy-unreadable:${press.host}`)) {
        throw wrongState(`${press.host} is not waiting to be thawed.`);
      }
      recover(b, press.host);
      return;
    }
    case "rebuildCopy": {
      const member = b.member(press.handle);
      if (member.kind !== "writer" || member.host === null) {
        throw wrongState(`@${member.handle} has no copy of the code`);
      }
      requireFreeCopy(b, member.handle);
      return createLane(b, member);
    }
    case "operationContinue":
    case "operationDiscard": {
      const row = b.state.attention.find((entry) => entry.id === press.operationId);
      if (row === undefined) throw wrongState("that row is gone");
      b.emit({ _tag: "AttentionCleared", id: row.id });
      if (
        press._tag === "operationContinue" &&
        row.id.startsWith(IMPORTED_ROW) &&
        row.taskId !== null
      ) {
        const task = b.state.tasks[row.taskId];
        if (task !== undefined) continueImported(b, task, as);
        return;
      }
      if (press._tag === "operationContinue") return continueOperation(b, row, as);
      if (press._tag === "operationDiscard" && row.taskId !== null) {
        const task = b.state.tasks[row.taskId];
        if (task !== undefined && task.state !== "landed" && task.state !== "discarded") {
          step(b, task, { type: "discard" });
        }
      }
      return;
    }
    case "useCrewCopy":
    case "orphanScan":
    case "adopt":
    case "deliverDraft":
    case "addCrewPorts":
      throw new Rejected("unavailable", `${press._tag} is served beside the crew, not by it`);
  }
};

/** A crewmate chat's send: it steers the running turn, goes to the lead, or works the open task. */
const message = (
  b: Builder,
  handle: string,
  text: string,
  as: Principal,
  attachments: ReadonlyArray<ChatAttachment>,
): void => {
  const member = b.member(handle);
  const sent = { text, card: null };
  if (member.active !== null) {
    sendTurn(
      b,
      member,
      sent,
      as,
      "message",
      openTaskOf(b.state, handle)?.id ?? null,
      attachments,
      member.active.runId,
    );
    return;
  }
  if (member.kind === "lead") {
    b.emit({ _tag: "LeadUpdated", set: { spokenBy: userOf(as) } });
    sendTurn(b, member, sent, as, "lead-message", null, attachments);
    return;
  }
  const open = openTaskOf(b.state, handle);
  if (open !== undefined) {
    // Its copy is being written (a turn's save, a merge, a landing): the message waits for none.
    // A check only reads the copy, so a message goes on during it.
    if (open.state === "merging" || open.state === "landing" || copyWriting(b.state, handle)) {
      throw wrongState(busyWords(handle));
    }
    continueTask(b, open, as, sent, "message", attachments);
    return;
  }
  requireFreeCopy(b, handle);
  const task = createTask(b, {
    owner: handle,
    title: implicitTaskTitle(text) || "Message",
    source: "message",
    createdBy: userOf(as),
    brief: text,
    doneWhen: "",
    note: null,
    dependsOn: [],
  });
  if (!isFree(b.state, handle)) return;
  startTask(b, task, as, true, attachments);
};

/** *Tell the crew*: to the lead, or one task per crewmate it mentions. */
const tell = (
  b: Builder,
  text: string,
  mentions: ReadonlyArray<{ readonly handle: string }>,
  as: Principal,
): void => {
  const route = routeCrewMessage({
    place: "tell",
    roster: membersInOrder(b.state).map((member) => ({ handle: member.handle, kind: member.kind })),
    text,
    mentions,
  });
  switch (route.kind) {
    case "refused":
      throw route.reason === "unknown-mention"
        ? new Rejected(
            "unknown-crewmate",
            (route.handles ?? []).map((handle) => `@${handle}`).join(", "),
          )
        : new Rejected("no-mention");
    case "to-crewmate":
      return message(b, route.handle, text, as, []);
    case "to-lead":
      return message(
        b,
        route.lead,
        route.addressed.length === 0
          ? text
          : `${text}\n\nAddressed: ${route.addressed.map((handle) => `@${handle}`).join(", ")}`,
        as,
        [],
      );
    case "tasks": {
      for (const routed of route.tasks) requireFreeCopy(b, routed.handle);
      for (const routed of route.tasks) {
        const task = createTask(b, {
          owner: routed.handle,
          title: routed.title || "Message",
          source: "you",
          createdBy: userOf(as),
          brief: text,
          doneWhen: "",
          note: routed.note ?? null,
          dependsOn: [],
        });
        pump(b, routed.handle, { taskId: task.id, principal: as });
      }
      return;
    }
  }
};

/** Answers a crewmate's question as the person; the lead's own question when `taskId` is null. */
const answer = (
  b: Builder,
  handle: string,
  taskId: string | null,
  text: string,
  as: Principal,
): void => {
  const member = b.member(handle);
  if (taskId === null) {
    const { [handle]: _answered, ...questions } = b.state.lead.questions;
    b.emit({ _tag: "LeadUpdated", set: { questions } });
    sendTurn(b, member, { text, card: null }, as, "lead-message", null);
    return;
  }
  const task = b.task(taskId);
  if (task.owner !== handle || task.state !== "blocked") {
    throw wrongState(`#${task.number} is ${task.state}`);
  }
  continueTask(b, task, as, answerCard(task, null, text), "answer");
};

/** *Continue* on an operation: its effect asked again from where it stood, or its turn sent again. */
const continueOperation = (b: Builder, row: AttentionRecord, as: Principal): void => {
  const facts = row.operation;
  const task = row.taskId === null ? undefined : b.state.tasks[row.taskId];
  if (facts?.redo !== undefined && task !== undefined && task.state === "parked") {
    b.emit({
      _tag: "TaskStepped",
      taskId: task.id,
      cause: "operation-continue",
      from: task.state,
      to: facts.resumeState,
      counters: task.counters,
      set: {
        wait: null,
        ...(facts.kind === "check" ? { check: { state: "running", output: "", tip: null } } : {}),
      },
    });
    b.effect(facts.redo as CrewEffectPayload, task.owner, {
      handle: task.owner,
      taskId: task.id,
      attempt: task.counters.attempt,
    });
    return;
  }
  const member = row.handle === null ? undefined : b.state.members[row.handle];
  if (facts?.turn === undefined || member === undefined) return;
  if (task !== undefined && isOpenTask(task.state)) {
    continueTask(
      b,
      task,
      facts.turn.principal ?? as,
      { text: facts.turn.text, card: null },
      "continue",
    );
  } else if (task === undefined) {
    sendTurn(
      b,
      member,
      { text: facts.turn.text, card: null },
      facts.turn.principal,
      member.kind === "lead" ? "lead-message" : "message",
      null,
    );
  }
};

/** Discards a task; an open one's work is kept aside and its copy reset first. */
const discard = (b: Builder, task: TaskRecord): void => {
  if (task.state === "landed" || task.state === "discarded") {
    throw wrongState(`#${task.number} is ${task.state}`);
  }
  if (task.state === "proposed" || task.state === "queued" || task.state === "parked") {
    stepOrRefuse(b, task, { type: "discard" }, { cantStart: null });
    return;
  }
  const member = b.member(task.owner);
  if (isWorking(b.state, member.handle)) throw wrongState(`@${member.handle}'s turn is running`);
  requireFreeCopy(b, member.handle);
  if (member.kind !== "writer") {
    stepOrRefuse(b, task, { type: "discard" });
    return;
  }
  b.effect(
    {
      kind: "crew.lane.keep",
      handle: member.handle,
      taskId: task.id,
      attempt: task.counters.attempt,
      assignment: taskAssignment(task),
      run: task.runId,
    },
    member.handle,
    { handle: member.handle, taskId: task.id, attempt: task.counters.attempt },
  );
};

const removeCrewmate = (b: Builder, member: MemberRecord, discardUnlanded: boolean): void => {
  if ((member.lane?.stats?.ahead ?? 0) > 0 && !discardUnlanded) {
    throw new Rejected("unlanded-commits", `@${member.handle}'s copy has work not landed yet`);
  }
  if (isWorking(b.state, member.handle)) throw wrongState(`@${member.handle}'s turn is running`);
  requireFreeCopy(b, member.handle);
  for (const task of tasksOf(b.state, member.handle)) {
    if (task.state !== "landed" && task.state !== "discarded") step(b, task, { type: "discard" });
  }
  if (member.kind === "writer") {
    b.effect({ kind: "crew.lane.remove", handle: member.handle, discardUnlanded }, member.handle, {
      handle: member.handle,
    });
  }
  deliver(
    b,
    member,
    { _tag: "Archive" },
    {
      purpose: "archive",
      taskId: null,
      principal: b.envelope.principal,
      text: null,
    },
  );
  const applied = b.state.applied!;
  const definition = {
    ...applied.definition,
    members: applied.definition.members.filter((spec) => spec.handle !== member.handle),
  };
  b.emit({
    _tag: "CrewApplied",
    definition,
    briefVersion: applied.briefVersion,
    members: membersInOrder(b.state).filter((other) => other.handle !== member.handle),
    removed: [member.handle],
  });
};

/* ------------------------------------------------------------ tools */

const replyText = (b: Builder, text: string): void => {
  b.reply = { text, isError: false };
};

const replyError = (b: Builder, text: string): void => {
  b.reply = { text, isError: true };
};

const tool = (b: Builder, handle: string, call: CrewToolCall): void => {
  requireApplied(b);
  const member = b.member(handle);
  switch (call.tool) {
    case "report":
      return report(b, member, call.input);
    case "review": {
      const task = tasksInOrder(b.state).find((row) => row.number === call.input.task);
      if (task === undefined) return replyError(b, `There is no #${call.input.task} on the board.`);
      if (task.state !== "review") {
        return replyError(b, `#${task.number} is not in review (${task.state}).`);
      }
      reviewTask(b, task, call.input.verdict, call.input.note, member.handle);
      if (call.input.verdict === "reject") {
        return replyText(b, `#${task.number} goes back to @${task.owner} with your note.`);
      }
      const run = runningRun(b.state);
      if (run === undefined || run.options.landing !== "lead") {
        return replyText(b, `Accepted — #${task.number} waits for the person to land it`);
      }
      return replyText(
        b,
        b.state.members[task.owner]?.lane?.stats?.ahead === 0
          ? `Accepted — #${task.number} had no changes, closed`
          : "Accepted — landing…",
      );
    }
    case "propose":
      return propose(b, call.plan);
    case "finish": {
      const run = runningRun(b.state);
      if (run === undefined) return replyError(b, "No run is on.");
      finishRun(b, run);
      return replyText(b, "The run is finished.");
    }
    case "show-on-dev": {
      if (member.host === null) return replyError(b, `@${member.handle} has no copy of the code.`);
      const claim = b.state.claims[member.host];
      if (claim !== undefined && !(claim.handle === member.handle && claim.state === "requested")) {
        return replyError(
          b,
          claim.handle === member.handle
            ? `${member.host} shows your copy already.`
            : `${member.host} is asked for by @${claim.handle} already.`,
        );
      }
      requestClaim(b, member, call.reason);
      return replyText(
        b,
        `Asked to show your copy on ${member.host}. Stop here; the answer arrives as a message.`,
      );
    }
    case "memory":
      b.emit({ _tag: "MemoryChanged", handle, op: call.op });
      return replyText(b, "Noted.");
  }
};

/** `crew_report`: done starts the merge-in at the turn's end; blocked asks the lead or the person. */
const report = (b: Builder, member: MemberRecord, input: CrewReportInput): void => {
  if (member.kind === "lead") {
    if (input.status !== "blocked") return replyText(b, "Noted.");
    const wake = b.state.lead.serving;
    if (wake?.kind === "question") {
      b.emit({
        _tag: "LeadUpdated",
        set: { escalated: { ...b.state.lead.escalated, [wake.key]: true } },
      });
    } else {
      b.emit({
        _tag: "LeadUpdated",
        set: {
          questions: {
            ...b.state.lead.questions,
            [member.handle]: { text: input.question ?? input.summary, at: b.now },
          },
        },
      });
    }
    return replyText(
      b,
      "The question is with the person. Stop here; the answer arrives as a message.",
    );
  }
  const open = openTaskOf(b.state, member.handle);
  if (open === undefined) {
    return replyText(
      b,
      "You have no open task. The person gives you one with a message or a task.",
    );
  }
  if (input.lessons !== undefined && input.lessons.length > 0) {
    b.emit({
      _tag: "MemoryChanged",
      handle: member.handle,
      op: { op: "lessons", lessons: input.lessons, taskId: open.id },
    });
  }
  const reported = {
    status: input.status,
    summary: input.summary,
    question: input.question ?? null,
  };
  switch (input.status) {
    case "progress":
      b.emit({ _tag: "TaskUpdated", taskId: open.id, set: { report: reported } });
      return replyText(b, "Noted.");
    case "blocked": {
      const blocked = step(
        b,
        open,
        { type: "report-blocked" },
        {
          report: { ...reported, question: input.question ?? input.summary },
          askedAt: b.now,
        },
      );
      if (blocked === undefined) return replyError(b, `#${open.number} is ${open.state}.`);
      b.arm("question", questionKey(blocked), b.now + QUESTION_TO_PERSON_MS, b.envelope.principal);
      return replyText(
        b,
        "Your question is with the person. Stop here; the answer arrives as a message.",
      );
    }
    case "done": {
      const merging = step(b, open, { type: "report-done" }, { report: reported });
      if (merging === undefined) return replyError(b, `#${open.number} is ${open.state}.`);
      if (member.host !== null && b.state.claims[member.host]?.handle === member.handle) {
        releaseClaim(b, member.host, b.envelope.principal, "report");
      }
      return replyText(
        b,
        "Reported. When this turn ends the engine commits your work, merges your tree's head into " +
          "your copy and runs the check; the person lands it. Stop here.",
      );
    }
  }
};

/** `crew_propose`: the plan onto the board, proposed for the person's Start or queued in a run. */
const propose = (b: Builder, plan: ReadonlyArray<CrewProposedTask>): void => {
  const board = tasksInOrder(b.state);
  const titles = plan.map((task) => task.title);
  const problems = plan.flatMap((task, index) => {
    const owner = b.state.members[task.owner.replace(/^@/u, "")];
    const unknown = (task.dependsOn ?? []).filter(
      (ref) =>
        !plan.some((other) => other.title === ref) &&
        !board.some((row) => `#${row.number}` === ref.trim()),
    );
    return [
      ...(owner === undefined ? [`${task.title}: there is no crewmate @${task.owner}`] : []),
      ...(owner?.kind === "lead" ? [`${task.title}: the lead takes no tasks`] : []),
      ...unknown.map((ref) => `${task.title}: no task "${ref}" in the plan or on the board`),
      ...(titles.indexOf(task.title) === index
        ? []
        : [`${task.title}: two tasks share this title`]),
    ];
  });
  if (problems.length > 0) return replyError(b, problems.join("\n"));
  const run = runningRun(b.state);
  const state = initialTaskState({
    source: "lead",
    leadMayStart: run?.options.leadMayStart === true,
  });
  const created = new Map<string, TaskRecord>();
  for (const task of plan) {
    created.set(
      task.title,
      createTask(b, {
        owner: task.owner.replace(/^@/u, ""),
        title: task.title,
        source: "lead",
        createdBy: run?.startedBy ?? b.state.lead.spokenBy ?? null,
        brief: task.brief,
        doneWhen: task.doneWhen ?? "",
        note: null,
        dependsOn: [],
        state,
      }),
    );
  }
  for (const task of plan) {
    const row = created.get(task.title)!;
    const dependsOn = (task.dependsOn ?? []).map(
      (ref) => created.get(ref)?.id ?? board.find((other) => `#${other.number}` === ref.trim())!.id,
    );
    if (dependsOn.length > 0) b.emit({ _tag: "TaskUpdated", taskId: row.id, set: { dependsOn } });
  }
  const listed = [...created.values()]
    .map((row) => `#${row.number} ${row.title} (@${row.owner})`)
    .join(", ");
  replyText(
    b,
    state === "proposed"
      ? `Proposed ${listed}. They wait for the person to start them.`
      : `Queued ${listed}. Each starts when its crewmate is free and what it depends on has landed.`,
  );
};

/* ------------------------------------------------------------ observed conversations */

const memberByConversation = (state: CrewState, conversationId: string) =>
  membersInOrder(state).find((member) => member.conversationId === conversationId);

const deliveryOfRun = (state: CrewState, runId: RunId) =>
  Object.entries(state.deliveries).find(([, delivery]) => delivery.runId === runId);

const observed = (
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
type Ending =
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
const turnEnded = (b: Builder, task: TaskRecord, ending: Ending): void => {
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

/* ------------------------------------------------------------ redeploys */

const deploy = (b: Builder, host: string, phase: "started" | "ended"): void => {
  const record = b.state.hosts[host];
  const writers = membersInOrder(b.state).filter((member) => member.host === host);
  if (writers.length === 0) return;
  if (phase === "started") {
    if (record?.frozenSince != null) return;
    b.emit({ _tag: "HostUpdated", host, set: { frozenSince: b.now } });
    for (const member of writers) {
      if (member.active === null) continue;
      // Its turn goes on once the copies are back, for whoever it ran for.
      if (member.active.taskId !== null) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: {
            carryOn: { why: redeployWords(host), as: crewAs(userOf(member.active.principal)) },
          },
        });
      }
      deliver(
        b,
        member,
        { _tag: "Stop", runId: member.active.runId },
        {
          purpose: "stop",
          taskId: null,
          principal: { kind: "engine" },
          text: null,
        },
      );
    }
    // The copies freeze in git too: no turn's save, merge or landing writes under the deploy.
    b.effect({ kind: "crew.host.freeze", host }, host, { host });
    return;
  }
  if (record?.frozenSince == null) return;
  recover(b, host);
};

/** Why a turn a redeploy stopped goes on once its copy is back. */
const redeployWords = (host: string): string =>
  `A redeploy of ${host} stopped your last turn; it goes on now that your copy is back.`;

/** The words a host frozen after a restart stands in while its redeploy runs or cannot be read. */
const frozenWords = (host: string, phase: "running" | "unreadable"): string =>
  phase === "running"
    ? `${host} is still redeploying; its crew copies stay frozen until the deploy ends.`
    : `Mate could not read whether ${host}'s deploy still runs; its crew copies stay frozen, and Mate reads it again when Zerops reports a process.`;

const timingOf = (state: CrewState): CrewTiming => state.timing ?? DEFAULT_CREW_TIMING;

/**
 * A frozen host's redeploy is read: at boot, and again at each process Zerops pushes. A read
 * under way may hold an answer from before the push, so one more queues behind it in the host's
 * lane; a third would read what the second does.
 */
const readDeploy = (b: Builder, host: string): void => {
  const reads = Object.values(b.state.effects).filter(
    (effect) => effect.kind === "crew.deploy.poll" && effect.host === host,
  ).length;
  if (reads < 2) b.effect({ kind: "crew.deploy.poll", host }, host, { host });
};

/** A host whose copies are being recovered is no longer read for its redeploy. */
const recovering = (b: Builder, host: string): boolean =>
  Object.values(b.state.effects).some(
    (effect) => effect.kind === "crew.recover" && effect.host === host,
  );

const recover = (b: Builder, host: string): void => {
  if (recovering(b, host)) return;
  b.cancel("thaw-offer", host, "the redeploy ended");
  const writers = membersInOrder(b.state).filter((member) => member.host === host);
  const handles = new Set(writers.map((member) => member.handle));
  b.effect(
    {
      kind: "crew.recover",
      host,
      handles: writers.map((member) => member.handle),
      specs: writers.map((member) => ({
        handle: member.handle,
        setup: member.setup,
        ...laneEnvironmentOf(b.state, member),
      })),
      landings: tasksInOrder(b.state)
        .filter((task) => task.landedCommit !== null && handles.has(task.owner))
        .map((task) => ({ assignment: taskAssignment(task), title: task.title })),
    },
    host,
    { host },
  );
};

const thaw = (
  b: Builder,
  host: string,
  lost: ReadonlyArray<string>,
  losses: ReadonlyArray<string> = [],
): void => {
  b.emit({ _tag: "HostUpdated", host, set: { frozenSince: null, unknownSince: null } });
  if (b.state.attention.some((row) => row.id === `deploy-unreadable:${host}`)) {
    b.emit({ _tag: "AttentionCleared", id: `deploy-unreadable:${host}` });
  }
  if (losses.length > 0) {
    b.emit({
      _tag: "ErrorNoted",
      text: `${host} came back from its deploy without crew work: ${losses.join(", ")}`,
    });
  } else if (
    b.state.lastError === frozenWords(host, "running") ||
    b.state.lastError === frozenWords(host, "unreadable")
  ) {
    b.emit({ _tag: "ErrorNoted", text: null });
  }
  for (const handle of lost) {
    const member = b.state.members[handle];
    if (member?.lane == null) continue;
    b.emit({
      _tag: "CrewmateUpdated",
      handle,
      set: { lane: { ...member.lane, state: "missing" } },
    });
  }
  for (const found of membersInOrder(b.state)) {
    if (found.host !== host) continue;
    // A copy the recovery brought back from its branch stands ready again.
    if (found.lane?.state === "missing" && !lost.includes(found.handle)) {
      b.emit({
        _tag: "CrewmateUpdated",
        handle: found.handle,
        set: { lane: { ...found.lane, state: "ready" } },
      });
    }
    const member = b.state.members[found.handle]!;
    // What the redeploy or a restart left in the copy is saved first, as at boot.
    if (
      member.kind === "writer" &&
      member.lane?.state === "ready" &&
      !lost.includes(member.handle)
    ) {
      b.effect(
        {
          kind: "crew.sweep",
          handle: member.handle,
          host,
          checked: CHECKED_STATES.has(openTaskOf(b.state, member.handle)?.state ?? "queued"),
        },
        member.handle,
        { handle: member.handle },
      );
    }
    // A redeploy drops the supervisor's crew apps (spec-mate §2.8a.2): the engine adds them again.
    if (
      member.app === "running" &&
      member.runCommand !== null &&
      member.lane?.state === "ready" &&
      !lost.includes(member.handle)
    ) {
      runApp(b, member, member.runCommand);
    }
    const open = openTaskOf(b.state, member.handle);
    if (open?.state === "merging" && !open.checkpointing) mergeIn(b, open);
  }
};

/** A writer's own app run on its crew port, by the dev service's supervisor. */
const runApp = (b: Builder, member: MemberRecord, command: string): void => {
  b.effect(
    {
      kind: "crew.app.run",
      handle: member.handle,
      host: member.host!,
      command,
      ...laneEnvironmentOf(b.state, member),
    },
    member.handle,
    { handle: member.handle },
  );
};

/* ------------------------------------------------------------ the rest of the engine */

const loginsChanged = (b: Builder, logins: ReadonlyArray<string>): void => {
  const changed = new Set(logins);
  for (const task of tasksInOrder(b.state)) {
    const member = b.state.members[task.owner];
    if (
      task.state === "queued" &&
      task.cantStart !== null &&
      member !== undefined &&
      changed.has(member.login)
    ) {
      b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { cantStart: null } });
    }
  }
};

/** What a restart stopped after a task's turn had ended, by the stage it stood in (V1's words). */
const AFTER_TURN_STAGES: Readonly<Partial<Record<TaskRecord["state"], string>>> = {
  merging: "Its turn had ended; the Mate restarted during its check.",
  checking: "Its turn had ended; the Mate restarted during its check.",
  landing: "Its turn had ended; the Mate restarted during its landing.",
};

const recovered = (b: Builder): void => {
  renewLeadWakes(b);
  // A redeploy the restart cut off may still run: its host stays frozen until a read says it ended.
  for (const host of frozenHosts(b.state)) readDeploy(b, host);
  for (const member of membersInOrder(b.state)) {
    if (
      member.kind === "writer" &&
      member.lane?.state === "ready" &&
      !copyBusy(b.state, member.handle) &&
      // A frozen host's copies are swept once its redeploy ends.
      !hostFrozen(b.state, member.host)
    ) {
      const open = openTaskOf(b.state, member.handle);
      b.effect(
        {
          kind: "crew.sweep",
          handle: member.handle,
          host: member.host!,
          checked: open !== undefined && CHECKED_STATES.has(open.state),
        },
        member.handle,
        { handle: member.handle },
      );
    }
  }
  // What a restart cut after a turn's end (its save, its check, its landing) ends the attempt in
  // V1's words; the work itself goes on as its effect is taken up again.
  for (const task of tasksInOrder(b.state)) {
    const stage = AFTER_TURN_STAGES[task.state];
    if (stage === undefined) continue;
    const rows = task.attemptRows ?? [];
    const at = rows.findIndex((row) => row.attempt === task.counters.attempt);
    if (at === -1 || rows[at]!.endedAt !== null) continue;
    b.emit({
      _tag: "TaskUpdated",
      taskId: task.id,
      set: {
        attemptRows: rows.map((row, index) =>
          index === at
            ? // When the task last moved: what the restart cut stood then.
              { ...row, ending: "interrupted", endingDetail: stage, endedAt: task.updatedAt }
            : row,
        ),
      },
    });
  }
  // A running run carries on what a restart found stopped mid-way (V1's boot): its task goes on.
  if (runningRun(b.state) === undefined) return;
  for (const member of membersInOrder(b.state)) {
    const open = openTaskOf(b.state, member.handle);
    if (
      open?.state !== "working" ||
      open.midway === null ||
      isWorking(b.state, member.handle) ||
      member.carryOn !== null
    ) {
      continue;
    }
    b.emit({
      _tag: "CrewmateUpdated",
      handle: member.handle,
      set: { carryOn: { why: STOPPED_MIDWAY, as: null } },
    });
    advanceMember(b, member.handle);
  }
};

/**
 * V1's crew, taken in one step at the flip: its crewmates get their agents, held claims their dev
 * server read again, open questions their wake from when they were asked, a frozen host its
 * redeploy read, and each copy the boot's sweep. A crew that holds one already takes nothing.
 */
const importV1 = (b: Builder, crew: CrewImport): void => {
  if (b.state.applied !== null || Object.keys(b.state.tasks).length > 0) return;
  b.emit({
    _tag: "CrewApplied",
    definition: crew.definition,
    briefVersion: crew.briefVersion,
    members: crew.members,
    removed: [],
  });
  for (const [host, set] of Object.entries(crew.hosts)) b.emit({ _tag: "HostUpdated", host, set });
  for (const task of crew.tasks) b.emit({ _tag: "TaskCreated", task });
  if (crew.run !== null) b.emit({ _tag: "RunStarted", run: crew.run });
  for (const [host, claim] of Object.entries(crew.claims)) {
    b.emit({ _tag: "ClaimUpdated", host, claim });
    b.effect({ kind: "crew.claim.read", host, handle: claim.handle, purpose: "import" }, host, {
      host,
      handle: claim.handle,
    });
  }
  for (const [handle, op] of Object.entries(crew.memory)) {
    b.emit({ _tag: "MemoryChanged", handle, op });
  }
  for (const row of crew.interrupted) b.emit({ _tag: "AttentionRaised", row });
  for (const task of tasksInOrder(b.state)) {
    if (task.state === "blocked" && task.askedAt !== null && task.report?.question != null) {
      b.arm("question", questionKey(task), task.askedAt + QUESTION_TO_PERSON_MS, {
        kind: "engine",
      });
    }
  }
  for (const member of membersInOrder(b.state)) assignAgent(b, member);
  recovered(b);
};

/** *Continue* on a task the import found mid-way: it goes on from where it stood. */
const continueImported = (b: Builder, task: TaskRecord, as: Principal): void => {
  switch (task.state) {
    case "working":
      if (isWorking(b.state, task.owner)) throw wrongState(busyWords(task.owner));
      continueTask(b, task, as, continueCard(task, UPDATE_WHY), "continue");
      return;
    case "merging":
      return mergeIn(b, task);
    case "ready":
      b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { landAs: as } });
      return;
    default:
      return;
  }
};

const wakeKey = (state: CrewState, wakeId: string, kind: string): string =>
  wakeId.slice(`${state.ownerId}/w/${kind}/`.length);

const wakeFired = (b: Builder, wakeId: WakeId): void => {
  const wake = b.state.wakes[wakeId];
  if (wake === undefined) return;
  const key = wakeKey(b.state, wakeId, wake.kind);
  b.emit({ _tag: "WakeFired", wakeId, dueAt: wake.dueAt });
  switch (wake.kind) {
    case "question":
    case "unattended":
      b.emit({ _tag: "Due", key: `${wake.kind}:${key}` });
      return;
    case "run-time":
      return checkLimits(b);
    case "claim-timeout": {
      const claim = b.state.claims[key];
      if (claim?.state === "requested") moveClaim(b, key, "timeout");
      else if (claim?.state === "held") releaseClaim(b, key, { kind: "engine" }, "timeout");
      return;
    }
    case "thaw-offer":
      if (b.state.hosts[key]?.frozenSince != null) {
        b.emit({
          _tag: "AttentionRaised",
          row: {
            id: `deploy-unreadable:${key}`,
            handle: null,
            taskId: null,
            text: `${key}'s redeploy could not be read`,
            at: b.now,
          },
        });
      }
      return;
    default:
      return;
  }
};

/* ------------------------------------------------------------ effect outcomes */

const valueOf = <K extends keyof CrewEffectValues>(_kind: K, value: unknown): CrewEffectValues[K] =>
  value as CrewEffectValues[K];

const settled = (
  b: Builder,
  effectId: EffectId,
  outcome: Extract<CrewInput, { _tag: "EffectSettled" }>["outcome"],
): void => {
  const pending = b.state.effects[effectId];
  if (pending === undefined) return;
  b.emit({ _tag: "EffectOutcomeRecorded", effectId, kind: pending.kind, outcome });
  if (outcome.kind !== "ok") return failedForGood(b, effectId, pending, outcome);
  const value = outcome.value;
  const member = pending.handle === null ? undefined : b.state.members[pending.handle];
  const task = pending.taskId === null ? undefined : b.state.tasks[pending.taskId];
  switch (pending.kind) {
    case "crew.deliver": {
      const delivery = b.state.deliveries[effectId];
      const runId = valueOf("crew.deliver", value)?.runId;
      if (delivery === undefined) return;
      if (
        delivery.purpose === "stop" ||
        delivery.purpose === "rotate" ||
        delivery.purpose === "assign" ||
        delivery.purpose === "archive" ||
        delivery.purpose === "seam"
      ) {
        b.emit({ _tag: "DeliveryClosed", effectId });
      } else if (
        runId !== undefined &&
        Object.entries(b.state.deliveries).some(
          ([other, entry]) => other !== effectId && entry.runId === runId,
        )
      ) {
        // It joined a run another delivery queued (a steer): that one carries the run.
        b.emit({ _tag: "DeliveryClosed", effectId });
      } else if (runId !== undefined && delivery.runId === null) {
        b.emit({ _tag: "DeliveryLinked", effectId, runId });
      }
      return;
    }
    case "crew.lane.create": {
      const created = valueOf("crew.lane.create", value);
      if (member?.lane == null) return;
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: {
          lane:
            created._tag === "ready"
              ? { ...member.lane, state: "ready", detail: null }
              : { ...member.lane, state: "failed", detail: created.detail },
        },
      });
      return;
    }
    case "crew.lane.reset": {
      if (member === undefined || task === undefined || task.starting === null) return;
      const reset = valueOf("crew.lane.reset", value);
      switch (reset._tag) {
        case "ready":
          b.emit({
            _tag: "CrewmateUpdated",
            handle: member.handle,
            set: statsSet(reset.stats, member),
          });
          sendTurn(
            b,
            b.state.members[member.handle]!,
            taskCard(task, reset.resetTo),
            task.starting.principal,
            "task",
            task.id,
            task.starting.attachments ?? [],
          );
          return;
        case "dirty":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          b.emit({
            _tag: "AttentionRaised",
            row: {
              id: `preserved:${member.handle}`,
              handle: member.handle,
              taskId: task.id,
              text: "its copy still has preserved edits; continue or preserve them first",
              at: b.now,
            },
          });
          return;
        case "frozen":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          return;
        case "lane-missing":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          if (member.lane !== null) {
            b.emit({
              _tag: "CrewmateUpdated",
              handle: member.handle,
              set: { lane: { ...member.lane, state: "missing" } },
            });
          }
          return;
        case "moved":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          park(b, b.task(task.id), "its copy of the code moved outside the engine");
          return;
      }
      return;
    }
    case "crew.lane.keep": {
      if (task === undefined) return;
      const kept = valueOf("crew.lane.keep", value);
      if (kept._tag === "kept") step(b, task, { type: "discard" }, { cantStart: null });
      else
        b.emit({ _tag: "ErrorNoted", text: `#${task.number} was not discarded: ${kept.detail}` });
      return;
    }
    case "crew.lane.remove":
      if (valueOf("crew.lane.remove", value)._tag === "unlanded-commits") {
        b.emit({
          _tag: "ErrorNoted",
          text: `@${pending.handle}'s copy kept: it has work not landed`,
        });
      }
      return;
    case "crew.checkpoint": {
      if (member === undefined || task === undefined) return;
      const saved = valueOf("crew.checkpoint", value);
      const purpose = (pending.payload as { purpose?: string }).purpose;
      const ending = ((pending.payload as { ending?: Ending }).ending ?? {
        kind: "completed",
      }) as Ending;
      if ("stats" in saved && saved.stats !== undefined) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: statsSet(saved.stats, member),
        });
      } else if (saved._tag === "lane-missing" && member.lane !== null) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { lane: { ...member.lane, state: "missing" } },
        });
      }
      if (saved._tag === "edited-after-check" && CHECKED_STATES.has(task.state)) {
        if (task.checkpointing)
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: false } });
        park(b, b.task(task.id), EDITED_AFTER_CHECK);
        return;
      }
      if (saved._tag === "park" && purpose !== "land-now") {
        if (task.checkpointing)
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: false } });
        park(b, b.task(task.id), saved.detail);
        return;
      }
      if (purpose === "land-now") {
        if (saved._tag !== "committed" && saved._tag !== "unchanged") {
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { landAs: null } });
          b.emit({
            _tag: "ErrorNoted",
            text: `#${task.number}'s copy could not be committed (${saved._tag})`,
          });
          return;
        }
        const merging = step(b, task, { type: "land-now" }, { wait: null, midway: null });
        if (merging !== undefined) mergeIn(b, merging);
        return;
      }
      turnEnded(b, task, ending);
      return;
    }
    case "crew.mergeIn": {
      if (member === undefined || task === undefined || task.state !== "merging") return;
      const merged = valueOf("crew.mergeIn", value);
      switch (merged._tag) {
        case "merged":
        case "current": {
          b.emit({
            _tag: "CrewmateUpdated",
            handle: member.handle,
            set: statsSet(merged.stats, member),
          });
          if (member.check === null || member.host === null) {
            const clean = step(b, task, { type: "merge-clean" }, { wait: null });
            if (clean !== undefined) checkPassed(b, clean);
            return;
          }
          step(
            b,
            task,
            { type: "merge-clean" },
            {
              wait: null,
              check: { state: "running", output: "", tip: null },
            },
          );
          b.effect(
            {
              kind: "crew.check",
              handle: member.handle,
              taskId: task.id,
              attempt: task.counters.attempt,
              command: member.check,
              setup:
                merged._tag === "merged" && merged.lockfileChanged === true ? member.setup : null,
              host: member.host,
              tip: merged.tip ?? null,
              ...laneEnvironmentOf(b.state, member),
            },
            member.handle,
            { handle: member.handle, taskId: task.id, attempt: task.counters.attempt },
          );
          return;
        }
        case "conflict":
          step(
            b,
            task,
            { type: "merge-conflict" },
            {
              wait: { on: "conflict", reason: "conflicts with what landed", paths: merged.paths },
            },
          );
          return;
        case "unrelated":
          step(b, task, { type: "merge-empty-base" });
          return;
        case "frozen":
          b.emit({
            _tag: "ErrorNoted",
            text: `${member.host} is redeploying; #${task.number} merges when it is back.`,
          });
          return;
        case "lane-missing":
          if (member.lane !== null) {
            b.emit({
              _tag: "CrewmateUpdated",
              handle: member.handle,
              set: { lane: { ...member.lane, state: "missing" } },
            });
          }
          park(b, task, "its copy of the code is missing");
          return;
        case "uncommitted":
          park(b, task, "its copy has work the engine did not commit");
          return;
        case "unknown-tip":
          park(b, task, "its copy of the code moved outside the engine");
          return;
      }
      return;
    }
    case "crew.check": {
      if (task === undefined) return;
      // A message sent it back to work meanwhile: the verdict is on a tree that will not land.
      if (task.state !== "checking") {
        if (task.state === "merging") mergeIn(b, task);
        return;
      }
      const checked = valueOf("crew.check", value);
      switch (checked._tag) {
        case "passed":
          checkPassed(b, task, {
            check: { state: "passed", output: checked.tail, tip: checked.tip },
          });
          return;
        case "failed":
          step(
            b,
            task,
            { type: "check-failed" },
            {
              check: { state: "failed", output: checked.tail, tip: null },
              wait: { on: "check-failed", reason: "the check failed", paths: [] },
            },
          );
          return;
        case "timed-out":
          park(b, task, "the check timed out");
          return;
        case "killed":
          park(b, task, "the check was killed");
          return;
        case "setup-failed":
          park(b, task, "its setup failed");
          // The check's command never ran: Continue runs it again from its setup.
          b.emit({
            _tag: "AttentionRaised",
            row: {
              id: effectId,
              handle: task.owner,
              taskId: task.id,
              text: "its setup failed",
              at: b.now,
              operation: {
                kind: "check",
                stage: "setting-up",
                confirmedStage: "setting-up",
                status: "failed",
                resumeState: "checking",
                startedBy: userOf(dispatchPrincipal(b.state, task)),
                attempt: task.counters.attempt,
                row: false,
                redo: pending.payload as CrewEffectPayload,
              },
            },
          });
          return;
        case "lane-missing":
          park(b, task, "its copy of the code is missing");
          return;
        case "moved":
          park(b, task, "its copy of the code moved outside the engine");
          return;
      }
      return;
    }
    case "crew.land":
      return landSettled(b, effectId, member, task, valueOf("crew.land", value));
    case "crew.claim.read":
      return claimRead(b, pending, valueOf("crew.claim.read", value));
    case "crew.app.run":
    case "crew.app.stop":
      if (member !== undefined) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { app: valueOf("crew.app.run", value).state },
        });
      }
      return;
    case "crew.deploy.poll": {
      const host = pending.host!;
      const record = b.state.hosts[host];
      // A read that was in flight when the recovery began must not hold the host it let go.
      if (record?.frozenSince == null || recovering(b, host)) return;
      const phase = valueOf("crew.deploy.poll", value).phase;
      if (phase === "ended") return recover(b, host);
      const unknownSince = phase === "unreadable" ? (record.unknownSince ?? b.now) : null;
      if (unknownSince !== (record.unknownSince ?? null)) {
        b.emit({ _tag: "HostUpdated", host, set: { unknownSince } });
      }
      const words = frozenWords(host, phase);
      if (b.state.lastError !== words) b.emit({ _tag: "ErrorNoted", text: words });
      const offered = b.state.attention.some((row) => row.id === `deploy-unreadable:${host}`);
      if (unknownSince === null) {
        b.cancel("thaw-offer", host, "its redeploy reads again");
        if (offered) b.emit({ _tag: "AttentionCleared", id: `deploy-unreadable:${host}` });
      } else if (!offered) {
        // Unreadable for long enough, the person is offered to say it ended.
        b.arm("thaw-offer", host, unknownSince + timingOf(b.state).thawOfferMs, {
          kind: "engine",
        });
      }
      return;
    }
    case "crew.recover": {
      const recovered = valueOf("crew.recover", value);
      return thaw(b, pending.host!, recovered.lost, recovered.losses ?? []);
    }
    case "crew.host.freeze":
      return;
    case "crew.sweep": {
      const swept = valueOf("crew.sweep", value);
      if (member === undefined) return;
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: statsSet(swept.stats, member),
      });
      return sweptCopy(b, b.state.members[member.handle]!, swept.copy);
    }
    default:
      return;
  }
};

/**
 * What a restart left in a copy: saved work is said in its crewmate's chat, edits on a copy its
 * check passed stop its task, and a copy gone is brought back.
 */
const sweptCopy = (
  b: Builder,
  member: MemberRecord,
  copy: CrewEffectValues["crew.sweep"]["copy"],
): void => {
  switch (copy?._tag) {
    case "committed":
      if (copy.paths.length > 0) {
        seam(b, member, {
          seam: "swept",
          branch: `crew/${member.handle}`,
          commit: copy.commit,
          paths: copy.paths,
        });
      }
      return;
    case "held": {
      const open = openTaskOf(b.state, member.handle);
      if (open !== undefined && CHECKED_STATES.has(open.state)) {
        park(b, open, EDITED_AFTER_CHECK);
      }
      return;
    }
    case "missing":
      if (member.lane !== null) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { lane: { ...member.lane, state: "missing" } },
        });
      }
      if (member.host !== null) recover(b, member.host);
      return;
    default:
      return;
  }
};

/** An effect that failed for good: a row on Waiting on you, and the work it held let go. */
const failedForGood = (
  b: Builder,
  effectId: EffectId,
  pending: PendingEffect,
  outcome: Extract<CrewInput, { _tag: "EffectSettled" }>["outcome"],
): void => {
  const reason = outcome.kind === "failed" ? outcome.reason : outcome.kind;
  const task = pending.taskId === null ? undefined : b.state.tasks[pending.taskId];
  if (pending.kind === "crew.deliver") b.emit({ _tag: "DeliveryClosed", effectId });
  if (task?.starting != null) {
    b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
  }
  if (task?.checkpointing === true) {
    b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: false } });
  }
  b.emit({
    _tag: "AttentionRaised",
    row: {
      id: effectId,
      handle: pending.handle,
      taskId: pending.taskId,
      text: `${pending.kind.replace(/^crew\./u, "")} failed: ${reason}`,
      at: b.now,
    },
  });
};

const landSettled = (
  b: Builder,
  _effectId: EffectId,
  member: MemberRecord | undefined,
  task: TaskRecord | undefined,
  outcome: CrewEffectValues["crew.land"],
): void => {
  if (member === undefined || task === undefined || task.state !== "landing") return;
  const held = (words: string) => b.emit({ _tag: "LandingHeld", taskId: task.id, words });
  switch (outcome._tag) {
    case "landed":
    case "already-landed": {
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: statsSet(outcome.stats, member),
      });
      const done = step(
        b,
        task,
        { type: outcome._tag === "landed" ? "fast-forward" : "trailer-found" },
        { landedCommit: outcome.commit, landedAt: b.now, wait: null, landAs: null },
      );
      if (done !== undefined) {
        seam(b, member, {
          seam: "landed",
          taskId: done.id,
          number: done.number,
          commit: outcome.commit,
        });
      }
      return;
    }
    case "nothing": {
      const done = step(
        b,
        task,
        { type: "fast-forward" },
        {
          landedCommit: null,
          landedAt: b.now,
          wait: null,
          landAs: null,
        },
      );
      if (done !== undefined)
        seam(b, member, { seam: "closed", taskId: done.id, number: done.number });
      return;
    }
    case "head-moved":
    case "not-fast-forward": {
      held(
        outcome._tag === "head-moved"
          ? "your tree moved since its check; it merges again"
          : "your tree moved during the landing; it merges again",
      );
      const moved = step(b, task, { type: outcome._tag });
      if (moved?.state === "merging") mergeIn(b, moved);
      return;
    }
    case "dirty-tree":
    case "untracked-in-way":
      held(
        `your tree has ${outcome._tag === "dirty-tree" ? "uncommitted edits" : "untracked files"} in its way: ${outcome.paths.join(", ")}`,
      );
      step(
        b,
        task,
        { type: outcome._tag },
        {
          wait: { on: "your-tree", reason: null, paths: outcome.paths },
          landAs: null,
        },
      );
      return;
    case "index-lock":
      held(INDEX_LOCK);
      b.emit({ _tag: "ErrorNoted", text: `#${task.number} waits to land: ${INDEX_LOCK}` });
      step(b, task, { type: "index-lock" });
      return;
    case "missing-object": {
      held("an object the landing needs was missing; it lands again");
      const retried = task.landRetriedAttempt === task.counters.attempt;
      step(
        b,
        task,
        { type: "missing-object", retried },
        {
          landRetriedAttempt: task.counters.attempt,
        },
      );
      return;
    }
    case "disk-full":
      step(b, task, { type: "disk-full" });
      return;
    case "park":
      park(b, task, outcome.detail);
      return;
    case "uncommitted":
      park(b, task, EDITED_AFTER_CHECK);
      return;
    case "unchecked":
      park(b, task, MOVED_AFTER_CHECK);
      return;
    case "frozen":
    case "lane-missing":
    case "unknown-tip":
      park(b, task, `its copy could not land (${outcome._tag})`);
      return;
  }
};
