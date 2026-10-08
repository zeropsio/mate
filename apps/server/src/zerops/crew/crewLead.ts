import { operationHolds } from "./crewOperations.ts";
/**
 * crewLead — the lead (PRD §4.6, §5.4, §5.5; CONCEPT §5): it plans and
 * reviews, has no copy of the code and no tasks of its own. The person talks
 * to it like to any crewmate (its turns carry no task); in a running run the
 * engine also wakes it, one wake at a time:
 *
 * - **Review.** A task whose check passed in a run landing *after the lead's
 *   review* waits in `review`; the lead reads it with `crew_diff` and answers
 *   with `crew_review`. Accept makes it ready and lands it; reject sends it
 *   back with the note as its rework.
 * - **Questions.** A crewmate's `crew_report(blocked)` goes to the lead
 *   first: its reply becomes the crewmate's next turn. When only the person
 *   can answer, the lead reports blocked itself and the question reaches the
 *   person at once; unanswered, it reaches them after 15 minutes anyway.
 * - **Plans.** `crew_propose` puts tasks on the board as `proposed` — or
 *   `queued` when the run lets the lead start them — and the person starts,
 *   edits or discards them (`planAccept`, `planDiscard`).
 * - **Finish.** `crew_finish` ends the run.
 *
 * Wakes stop at 30 per run (CONCEPT §5 caps); what is left waits for the
 * person on the board. The engine's own wakes stand two minutes apart; the
 * person's Start or Resume wakes the lead at once. A wake a pause, a stop or
 * a restart cut off, or one that ended without an answer, is taken up again
 * when a run starts, resumes or goes on after a restart.
 *
 * @module crewLead
 */
import type { CrewCommandError, CrewReviewVerdict } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { answerCard, questionCard, reviewCard } from "./crewCards.ts";
import {
  asRefusal,
  currentStint,
  dispatchPrincipal,
  isWorking,
  leadOf,
  memberOf,
  refuse,
  requireApplied,
  runningRun,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { initialTaskState } from "./crewMachines.ts";
import { remember } from "./crewNotes.ts";
import { finishRun, pauseRun, runOptionsOf } from "./crewRuns.ts";
import { questionKey } from "./crewSnapshot.ts";
import type {
  CrewProposedTask,
  CrewReportInput,
  CrewThreadMember,
  CrewToolText,
} from "./crewSeams.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";
import { readTaskReport } from "./crewTaskData.ts";
import {
  continueTask,
  createTask,
  discard,
  leadTurn,
  requireTask,
  saveOver,
  stepTask,
} from "./crewTasks.ts";

/** Wakes per run, and the least time between two (CONCEPT §5 caps). */
const LEAD_WAKES_MAX = 30;
const LEAD_WAKE_SPACING_MS = 2 * 60_000;

const text = (value: string): CrewToolText => ({ text: value, isError: false });
const error = (value: string): CrewToolText => ({ text: value, isError: true });

const reviewKey = (task: Pick<CrewAssignmentRow, "assignment" | "attempt">) =>
  `review:${task.assignment}:${task.attempt}`;

/** Whether the lead takes the crew's questions first: a run is running and the crew has a lead. */
export const leadAnswers = (applied: AppliedCrew): boolean =>
  runningRun(applied) !== undefined && leadOf(applied) !== undefined;

/** The first review or question waiting on the lead, and its card. */
const nextWake = (
  applied: AppliedCrew,
  core: CrewCore,
  tasks: ReadonlyArray<CrewAssignmentRow>,
) => {
  for (const task of tasks) {
    if (task.state === "review" && !core.memory.woken.has(reviewKey(task))) {
      return {
        wake: { kind: "review" as const, taskId: task.assignment, key: reviewKey(task) },
        card: reviewCard({
          number: task.number,
          title: task.title,
          owner: task.member,
          report: readTaskReport(task.report)?.summary ?? null,
        }),
      };
    }
    const question = readTaskReport(task.report)?.question;
    if (
      task.state === "blocked" &&
      applied.members.get(task.member)?.kind !== "lead" &&
      question !== undefined &&
      question !== null &&
      !core.memory.woken.has(questionKey(task))
    ) {
      return {
        wake: { kind: "question" as const, taskId: task.assignment, key: questionKey(task) },
        card: questionCard({
          number: task.number,
          title: task.title,
          owner: task.member,
          question,
        }),
      };
    }
  }
  return undefined;
};

/**
 * The wakes a run takes up again when it starts, resumes or goes on after a
 * restart: each review, and each question the lead has not passed on to the
 * person, that the lead was woken for and no running turn of the lead's
 * serves — a pause, a stop or a restart cut that turn off, or it ended
 * without an answer.
 */
export const wakesToRenew = (
  tasks: ReadonlyArray<Pick<CrewAssignmentRow, "assignment" | "state" | "attempt" | "updatedAt">>,
  woken: ReadonlySet<string>,
  escalated: ReadonlySet<string>,
  serving: string | undefined,
): ReadonlyArray<string> =>
  tasks.flatMap((task) => {
    const key =
      task.state === "review"
        ? reviewKey(task)
        : task.state === "blocked"
          ? questionKey(task)
          : undefined;
    return key !== undefined && woken.has(key) && !escalated.has(key) && key !== serving
      ? [key]
      : [];
  });

/** Lets the lead be woken again for what {@link wakesToRenew} finds. */
export const renewLeadWakes = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    const lead = applied === undefined ? undefined : leadOf(applied);
    if (applied === undefined || lead === undefined) return;
    const serving = isWorking(core, applied, lead.row.handle)
      ? core.memory.leadWakes.get(lead.row.handle)?.key
      : undefined;
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    for (const key of wakesToRenew(tasks, core.memory.woken, core.memory.escalated, serving)) {
      core.memory.woken.delete(key);
    }
  });

/**
 * Wakes a free lead for the next review or question, in a running run; a
 * wake sooner than two minutes after the last waits for them to pass.
 */
export const wakeLead = (
  core: CrewCore,
  applied: AppliedCrew,
  lead: CrewMember,
): Effect.Effect<void, CrewCommandError> =>
  Effect.gen(function* () {
    const run = runningRun(applied);
    if (
      run === undefined ||
      isWorking(core, applied, lead.row.handle) ||
      (yield* operationHolds(core, lead.row.handle))
    )
      return;
    const spent = core.memory.wakeCounts.get(run.run) ?? 0;
    if (spent >= LEAD_WAKES_MAX) return;
    const next = nextWake(applied, core, yield* asRefusal(core.store.assignments(CREW_ID)));
    if (next === undefined) return;
    const wait =
      (core.memory.lastWakeAt ?? 0) + LEAD_WAKE_SPACING_MS - (yield* Clock.currentTimeMillis);
    if (wait > 0) {
      if (core.memory.wakeWaiting) return;
      core.memory.wakeWaiting = true;
      yield* Effect.forkIn(
        Effect.sleep(Duration.millis(wait)).pipe(
          Effect.andThen(
            core.background(
              Effect.gen(function* () {
                core.memory.wakeWaiting = false;
                const now = yield* core.applied;
                const member = now === undefined ? undefined : memberOf(now, lead.row.handle);
                if (now !== undefined && member !== undefined) yield* wakeLead(core, now, member);
              }),
            ),
          ),
        ),
        core.scope,
      );
      return;
    }
    yield* remember(core, { kind: "lead-woken", key: next.wake.key }, run.run);
    core.memory.leadWakes.set(lead.row.handle, next.wake);
    yield* leadTurn(core, lead, { kind: "crew", startedBy: run.startedBy }, next.card).pipe(
      Effect.catchTags({
        CrewCommandError: (refusal) =>
          refusal.reason === "not-allowed"
            ? pauseRun(core, "refused", refusal.detail)
            : Effect.fail(refusal),
      }),
    );
  });

/**
 * The lead's turn ended: a question it was woken for gets the lead's reply
 * as its answer, unless the lead passed it on to the person.
 */
export const settleLeadWake = (core: CrewCore, applied: AppliedCrew, lead: CrewMember) =>
  Effect.gen(function* () {
    const wake = core.memory.leadWakes.get(lead.row.handle);
    core.memory.leadWakes.delete(lead.row.handle);
    if (wake?.kind !== "question" || core.memory.escalated.has(wake.key)) return;
    const stint = currentStint(applied, lead.row.handle);
    const answer = stint === undefined ? undefined : core.memory.lastText.get(stint.threadId);
    const task = yield* requireTask(core, wake.taskId);
    const owner = memberOf(applied, task.member);
    if (answer === undefined || answer.trim() === "" || task.state !== "blocked") return;
    if (owner === undefined) return;
    yield* continueTask(
      core,
      applied,
      owner,
      task,
      dispatchPrincipal(applied, task),
      answerCard({ number: task.number, title: task.title, lead: lead.row.handle, answer }),
    );
  });

/**
 * The lead's `crew_report`: it has no task, so only a question means
 * something — the crewmate's question it was woken for goes on to the
 * person, or else it is the lead's own question for them.
 */
export const leadReport = (core: CrewCore, member: CrewThreadMember, input: CrewReportInput) =>
  Effect.gen(function* () {
    if (input.status !== "blocked") return text("Noted.");
    const wake = core.memory.leadWakes.get(member.handle);
    const run = (yield* core.applied)?.run?.run ?? null;
    yield* wake?.kind === "question"
      ? remember(core, { kind: "escalated", key: wake.key }, run)
      : remember(
          core,
          { kind: "lead-asked", handle: member.handle, text: input.question ?? input.summary },
          run,
        );
    yield* core.changed;
    return text("The question is with the person. Stop here; the answer arrives as a message.");
  });

/** The person answered the lead's own question: it is no longer waiting. */
export const leadAnswered = (core: CrewCore, handle: string) =>
  core.memory.leadQuestions.has(handle)
    ? remember(core, { kind: "lead-answered", handle }, null)
    : Effect.void;

/**
 * `crew_propose`: the plan onto the board, `proposed` for the person's Start,
 * or `queued` when the running run lets the lead start tasks. A dependency
 * is a title of this plan or `#N` of a task on the board.
 */
export const propose = (
  core: CrewCore,
  member: CrewThreadMember,
  plan: ReadonlyArray<CrewProposedTask>,
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const board = yield* asRefusal(core.store.assignments(CREW_ID));
    const titles = plan.map((task) => task.title);
    const problems = plan.flatMap((task, index) => {
      const owner = applied.members.get(task.owner.replace(/^@/u, ""));
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
    if (problems.length > 0) return error(problems.join("\n"));
    const run = runningRun(applied);
    const state = initialTaskState({
      source: "lead",
      leadMayStart: run !== undefined && runOptionsOf(run)?.leadMayStart === true,
    });
    const created = new Map<string, CrewAssignmentRow>();
    for (const task of plan) {
      created.set(
        task.title,
        yield* createTask(core, {
          owner: task.owner.replace(/^@/u, ""),
          title: task.title,
          source: "lead",
          createdBy: run?.startedBy ?? core.memory.leadSpokenBy ?? "",
          card: { brief: task.brief, doneWhen: task.doneWhen ?? "", note: null },
          dependsOn: [],
          state,
        }),
      );
    }
    for (const task of plan) {
      const row = created.get(task.title)!;
      const dependsOn = (task.dependsOn ?? []).map(
        (ref) =>
          created.get(ref)?.assignment ??
          board.find((other) => `#${other.number}` === ref.trim())!.assignment,
      );
      if (dependsOn.length > 0) {
        yield* saveOver(core, row, { ...row, dependsOn });
      }
    }
    yield* core.changed;
    const listed = [...created.values()]
      .map((row) => `#${row.number} ${row.title} (@${row.member})`)
      .join(", ");
    return text(
      state === "proposed"
        ? `Proposed ${listed}. They wait for the person to start them.`
        : `Queued ${listed}. Each starts when its crewmate is free and what it depends on has landed.`,
    );
  });

/** *Start* on the lead's plan: its rows queue (a run starts them); `planDiscard` drops them. */
export const planAccept = (core: CrewCore, taskIds: ReadonlyArray<string>) =>
  Effect.forEach(taskIds, (taskId) =>
    Effect.flatMap(requireTask(core, taskId), (task) => stepTask(core, task, { type: "accept" })),
  );

export const planDiscard = (core: CrewCore, taskIds: ReadonlyArray<string>) =>
  Effect.forEach(taskIds, (taskId) =>
    Effect.flatMap(requireTask(core, taskId), (task) =>
      task.state === "proposed"
        ? discard(core, taskId)
        : Effect.fail(refuse("wrong-state", `#${task.number} is ${task.state}`)),
    ),
  );

/**
 * A verdict on a task in review: the lead's or a reader's `crew_review`
 * (`by` their handle), or the person's (`by` null). Accept makes it ready;
 * reject sends it back as rework with the note.
 */
export const reviewTask = (
  core: CrewCore,
  task: CrewAssignmentRow,
  input: { readonly verdict: CrewReviewVerdict; readonly note: string; readonly by: string | null },
) =>
  Effect.gen(function* () {
    if (task.state !== "review") {
      return yield* refuse("wrong-state", `#${task.number} is ${task.state}`);
    }
    const review = { verdict: input.verdict, note: input.note, by: input.by };
    return input.verdict === "accept"
      ? yield* stepTask(core, task, { type: "review-accepted" }, (next) => ({ ...next, review }))
      : yield* stepTask(core, task, { type: "review-rejected" }, (next) => ({
          ...next,
          review,
          waiting: { on: "review", reason: input.note, paths: [] },
        }));
  });

/** `crew_review`: the task by its number. */
export const reviewTool = (
  core: CrewCore,
  member: CrewThreadMember,
  input: { readonly task: number; readonly verdict: CrewReviewVerdict; readonly note: string },
) =>
  Effect.gen(function* () {
    const task = (yield* asRefusal(core.store.assignments(CREW_ID))).find(
      (row) => row.number === input.task,
    );
    if (task === undefined) return error(`There is no #${input.task} on the board.`);
    if (task.state !== "review") return error(`#${task.number} is not in review (${task.state}).`);
    yield* reviewTask(core, task, { ...input, by: member.handle });
    yield* core.changed;
    if (input.verdict === "reject") {
      return text(`#${task.number} goes back to @${task.member} with your note.`);
    }
    return text(yield* acceptedWords(core, task));
  });

/**
 * What an accept leads to, for the lead: a run that lands after the lead's
 * review lands it now — or closes it, when its copy holds nothing of its own
 * — and otherwise it waits for the person's *Land*.
 */
const acceptedWords = (core: CrewCore, task: CrewAssignmentRow) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const run = runningRun(applied);
    if (run === undefined || runOptionsOf(run)?.landing !== "lead") {
      return `Accepted — #${task.number} waits for the person to land it`;
    }
    const owner = applied.members.get(task.member);
    const ahead =
      owner?.kind === "writer" && owner.host !== null
        ? yield* core.reads.laneStats(owner.host, owner.handle).pipe(
            Effect.map((stats) => stats.ahead),
            Effect.orElseSucceed(() => undefined),
          )
        : undefined;
    return ahead === 0
      ? `Accepted — #${task.number} had no changes, closed`
      : "Accepted — landing…";
  });

/** `crew_finish`: every Done when line is met; the run ends. */
export const finishTool = (core: CrewCore) =>
  Effect.gen(function* () {
    const run = runningRun(yield* requireApplied(core));
    if (run === undefined) return error("No run is on.");
    yield* finishRun(core, run.run);
    return text("The run is finished.");
  });
