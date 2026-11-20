/**
 * A person's presses on the crew: the crew home, the run, a message, an answer, Continue, discard, review, Land and removing a crewmate.
 *
 * @module crew/engine/decide.presses
 */
import {
  type ChatAttachment,
  type CrewCommand,
  crewCommandReach,
  type Principal,
} from "@t3tools/contracts";
import type { CrewDefinition } from "@t3tools/shared/crewHome";
import { runTransition } from "../crewMachines.ts";
import { implicitTaskTitle, routeCrewMessage } from "../crewRouting.ts";
import { answerCard, continueCard, fixCard, resolveCard } from "./cards.ts";
import { type CrewEffectPayload, type HostRead, taskAssignment, type TaskSeen } from "./command.ts";
import {
  copyWriting,
  isFree,
  isOpenTask,
  isWorking,
  membersInOrder,
  openTaskOf,
  tasksOf,
  type AttentionRecord,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";
import {
  busyWords,
  Rejected,
  wrongState,
  type Builder,
  userOf,
  step,
  stepOrRefuse,
  createTask,
  attemptsOf,
  requireApplied,
  requireFreeCopy,
} from "./decide.step.ts";
import { deliver, sendTurn, rotateSession, startTask, continueTask } from "./decide.turns.ts";
import { mergeIn, reviewTask, landPress, landNow } from "./decide.land.ts";
import { createLane, applyHome, saveHome, removeLane, requireRemovable } from "./decide.home.ts";
import {
  pauseRun,
  runFrom,
  startRun,
  requireRun,
  resumeRun,
  stopRun,
  finishRun,
} from "./decide.run.ts";
import { moveClaim, requestClaim, grantClaim, releaseClaim } from "./decide.claims.ts";
import { pump } from "./decide.advance.ts";
import { recover, runApp } from "./decide.host.ts";

/** An attention row the flip's import raised: *Continue* takes its task up where it stood. */
export const IMPORTED_ROW = "imported:";

/** Why a task V1 left mid-way goes on: what its crewmate reads. */
export const UPDATE_WHY = "It stopped for an update to the Mate; carry on from where it stood.";

export const pressed = (
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
      laneAssignments: tasksOf(b.state, member.handle).map(taskAssignment),
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
  requireRemovable(b, member, discardUnlanded);
  for (const task of tasksOf(b.state, member.handle)) {
    if (task.state !== "landed" && task.state !== "discarded") step(b, task, { type: "discard" });
  }
  if (member.kind === "writer") {
    removeLane(b, member, discardUnlanded);
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
