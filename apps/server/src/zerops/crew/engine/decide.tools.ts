/**
 * A crewmate's tool calls: a report, a proposed plan, a question for the lead, and the replies they get.
 *
 * @module crew/engine/decide.tools
 */
import { initialTaskState } from "../crewMachines.ts";
import type { CrewProposedTask, CrewReportInput } from "../crewSeams.ts";
import { type CrewToolCall } from "./command.ts";
import {
  openTaskOf,
  questionKey,
  runningRun,
  tasksInOrder,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";
import { type Builder, step, createTask, requireApplied } from "./decide.step.ts";
import { reviewTask } from "./decide.land.ts";
import { finishRun } from "./decide.run.ts";
import { requestClaim, releaseClaim } from "./decide.claims.ts";

/** How long a crewmate's question waits on the lead before the person sees it too. */
export const QUESTION_TO_PERSON_MS = 15 * 60_000;

const replyText = (b: Builder, text: string): void => {
  b.reply = { text, isError: false };
};

const replyError = (b: Builder, text: string): void => {
  b.reply = { text, isError: true };
};

export const tool = (b: Builder, handle: string, call: CrewToolCall): void => {
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
