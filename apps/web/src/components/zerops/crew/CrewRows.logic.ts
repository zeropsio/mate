/**
 * A crewmate's row in the Crew tab — the menu's Mate row: its face wearing
 * its state, its name and a time, what it is on, its current step, and, when
 * it needs you, what for and the presses that settle it (the "Mate Crew Tab"
 * board, approved 2026-09-29).
 *
 * - Line 2 is what it is on — its task, as you or the lead put it — or, while
 *   it is on nothing, its job in the person's words, muted.
 * - Line 3 is its current step while it works (the thread's live step, D5),
 *   else where its task stands ("Done · the lead is checking it"), muted.
 * - What it needs from you follows, one line each, in ink — red only for
 *   something broken — with its presses; the face asks and an amber dot says
 *   so. What waits next is its last line. Rows never reorder.
 *
 * No status word, no version, no handle, no task number: the face carries the
 * state, and the words are the person's. Every word comes from the crew
 * phrases; this module only picks which.
 *
 * Pure: the thread's facts are handed in (`CrewRowThread`), read by the one
 * status resolver where the tab draws.
 */
import { matePose } from "@t3tools/client-runtime/zerops";
import {
  CREW_CARRY_ON_MESSAGE,
  CREW_CHECKING_ITS_WORK,
  CREW_COPY_READYING,
  CREW_ROW_VERBS,
  crewCopyAssignmentDetail,
  crewOperationDetail,
  crewPendingOperationWord,
  crewAskLeadToReviewMessage,
  crewAskToCommitWord,
  crewAskedLeadWord,
  crewBackToMateWord,
  crewBrokenCopyWord,
  crewCommitEditAsk,
  crewDoneCheckedWord,
  crewDoneGoingInWord,
  crewGoingInWord,
  crewGoneDependency,
  crewJobSentence,
  crewLeadAnsweringWord,
  crewLeadCheckingWord,
  crewNeedSentence,
  crewReadyWords,
  crewReworkMessage,
  crewRowVerbLine,
  crewSentBackWord,
  crewServedWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewAccess, CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type {
  CrewAttention,
  CrewCommand,
  CrewSnapshot,
  CrewTask,
  CrewTint,
  ThreadId,
} from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";

import type { LiveStepWords } from "~/zerops/liveStep";

/**
 * Where a press came from, so its refusal shows beside it (`useCrewCommand`'s
 * `origin`): the mode line, the head's menu, *Ask Fen to ship them*, one
 * crewmate's row, the plan.
 */
export const CREW_ORIGIN = {
  run: "run",
  deliver: "deliver",
  ports: "ports",
  plan: "plan",
  crewmate: (handle: string) => `crewmate:${handle}`,
} as const;

/** What the tab reads off a crewmate's thread, through the one status resolver. */
export interface CrewRowThread {
  /** Its thread's face; idle before its first turn. */
  readonly face: MateMarkState;
  readonly working: boolean;
  /** When it last did something — its turn's start while it works; `null` before its first. */
  readonly at: string | null;
  /** The step it is on while it works (D5); `null` where the server relays none. */
  readonly liveStep: LiveStepWords | null;
  /** What the person last asked it, in their words; `null` for none, or an engine card. */
  readonly asked: string | null;
}

/** A thread not read yet, or a crewmate before its first turn. */
export const CREW_ROW_NO_THREAD: CrewRowThread = {
  face: "idle",
  working: false,
  at: null,
  liveStep: null,
  asked: null,
};

/** A line's ink: the task in the second ink, the job and steps muted, a need in ink, broken in red. */
export type CrewRowTone = "ink-2" | "muted" | "ink" | "failed";

export interface CrewRowLine {
  readonly text: string;
  readonly tone: CrewRowTone;
  /** Finished work's size, after its words, in the diff's colours. */
  readonly diff?: { readonly insertions: number; readonly deletions: number } | undefined;
}

interface Labelled {
  readonly label: string;
  /** What it does: its tooltip. */
  readonly line: string;
}

export type CrewRowAction =
  /** Opens the answer box right in the row. */
  | (Labelled & {
      readonly kind: "answer";
      readonly handle: string;
      readonly taskId: string | null;
    })
  /** The task's review, where it goes into the Mate's code. */
  | (Labelled & { readonly kind: "review"; readonly taskId: string })
  /** Its copy of the app (`useCrewTry`). */
  | (Labelled & { readonly kind: "try"; readonly handle: string })
  /** A draft the Mate is handed, confirmed first. */
  | (Labelled & { readonly kind: "ask"; readonly ask: string })
  | (Labelled & { readonly kind: "command"; readonly command: CrewCommand });

export interface CrewRowNeed {
  /** Its row in the snapshot's list: stable while it stands. */
  readonly id: string;
  readonly line: CrewRowLine;
  readonly detail?: string;
  readonly actions: ReadonlyArray<CrewRowAction>;
}

export type CrewRowSlot =
  | { readonly kind: "clock"; readonly since: string }
  | { readonly kind: "age"; readonly at: string }
  | { readonly kind: "none" };

export interface CrewRowModel {
  readonly handle: string;
  readonly name: string;
  readonly tint: CrewTint;
  readonly lead: boolean;
  /** Its conversation, which the row opens; `null` before its first. */
  readonly threadId: ThreadId | null;
  readonly pose: MateMarkState;
  /** Something here needs you: the amber dot. */
  readonly needsYou: boolean;
  readonly slot: CrewRowSlot;
  readonly line2: CrewRowLine | null;
  readonly line3: CrewRowLine | null;
  readonly needs: ReadonlyArray<CrewRowNeed>;
  /** The lead's plan waits for Start in this row. */
  readonly plan: boolean;
  /** The Mate's dev address shows this crewmate's work: the line, and *Back to Fen's*. */
  readonly served: { readonly line: CrewRowLine; readonly action: CrewRowAction } | null;
  /** What it does next, its queue in order. */
  readonly next: string | null;
}

/**
 * What the crew needs from you, by whose row says it: a crewmate's own rows
 * in the snapshot's order; a row naming nobody on the crew goes to the lead's,
 * or the first row's, so nothing that needs you goes unsaid.
 */
export function crewNeedsByHandle(
  attention: ReadonlyArray<CrewAttention>,
  crewmates: ReadonlyArray<{ readonly handle: string; readonly kind: string }>,
): ReadonlyMap<string, ReadonlyArray<CrewAttention>> {
  const fallback =
    crewmates.find((mate) => mate.kind === "lead")?.handle ?? crewmates[0]?.handle ?? null;
  const known = new Set(crewmates.map((mate) => mate.handle));
  const byHandle = new Map<string, Array<CrewAttention>>();
  for (const row of attention) {
    const handle = row.handle !== null && known.has(row.handle) ? row.handle : fallback;
    if (handle === null) continue;
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), row]);
  }
  return byHandle;
}

const labelled = (verb: keyof typeof CREW_ROW_VERBS, mateName: string): Labelled => ({
  label: CREW_ROW_VERBS[verb],
  line: crewRowVerbLine(verb, mateName),
});

/**
 * What a need lets you press, in order — never a press that could do
 * nothing: the review only for a task, *Try it* only for a crewmate with a
 * copy of the app.
 */
export function crewNeedActions(
  row: CrewAttention,
  crew: Pick<CrewSnapshot, "crewmates" | "hosts" | "board">,
  mateName: string,
): ReadonlyArray<CrewRowAction> {
  const { taskId, handle } = row;
  const drop = (id: string): CrewRowAction => ({
    kind: "command",
    ...labelled("dropIt", mateName),
    command: { _tag: "discard", taskId: id },
  });
  const review = (id: string, verb: "review" | "reviewWhatItHas" | "reviewItYourself") =>
    ({ kind: "review", ...labelled(verb, mateName), taskId: id }) as const;
  switch (row.kind) {
    case "copy-missing":
      return handle === null
        ? []
        : [
            {
              kind: "command",
              ...labelled("rebuildCopy", mateName),
              command: { _tag: "rebuildCopy", handle },
            },
          ];
    case "interrupted": {
      if (handle === null || row.operation === undefined) return [];
      const continuation: CrewRowAction = {
        kind: "command",
        ...labelled("carryOn", mateName),
        command: { _tag: "operationContinue", handle, operationId: row.operation.id },
      };
      return row.operation.kind === "landing" || row.operation.taskId === null
        ? [continuation]
        : [
            continuation,
            {
              kind: "command",
              ...labelled("dropIt", mateName),
              command: { _tag: "operationDiscard", handle, operationId: row.operation.id },
            },
          ];
    }
    case "deploy-unreadable":
      return row.host === null
        ? []
        : [
            {
              kind: "command",
              ...labelled("thawHost", mateName),
              command: { _tag: "thawHost", host: row.host },
            },
          ];
    case "conversation-copy":
      return handle === null || row.copyAssignment === undefined
        ? []
        : [
            {
              kind: "command",
              ...labelled("useCrewCopy", mateName),
              command: {
                _tag: "useCrewCopy",
                handle,
                threadId: row.copyAssignment.threadId,
                expectedPath: row.copyAssignment.currentPath,
              },
            },
          ];
    case "question":
      return handle === null
        ? []
        : [{ kind: "answer", ...labelled("answer", mateName), handle, taskId }];
    case "landing-wait":
      return [
        {
          kind: "ask",
          label: crewAskToCommitWord(mateName),
          line: crewRowVerbLine("askToCommit", mateName),
          ask: crewCommitEditAsk(row.paths),
        },
      ];
    case "ready-to-land": {
      if (taskId === null) return [];
      const writer = crew.crewmates.find((mate) => mate.handle === handle)?.kind === "writer";
      return writer && handle !== null
        ? [review(taskId, "review"), { kind: "try", ...labelled("tryIt", mateName), handle }]
        : [review(taskId, "review")];
    }
    case "plan":
      return [];
    case "show-on-dev": {
      if (row.host === null) return [];
      const notNow: CrewRowAction = {
        kind: "command",
        ...labelled("notNow", mateName),
        command: { _tag: "claimDeny", host: row.host },
      };
      // Already let and waiting for its step to end: Not now takes it back.
      const waiting =
        crew.hosts.find((host) => host.host === row.host)?.claim.grantWaiting === true;
      return waiting
        ? [notNow]
        : [
            {
              kind: "command",
              ...labelled("letIt", mateName),
              command: { _tag: "claimGrant", host: row.host },
            },
            notNow,
          ];
    }
    case "conflict":
      return taskId === null
        ? []
        : [
            {
              kind: "command",
              ...labelled("askToSortOut", mateName),
              command: { _tag: "askResolve", taskId },
            },
          ];
    case "check-failed":
      return taskId === null
        ? []
        : [
            {
              kind: "command",
              ...labelled("askToFix", mateName),
              command: { _tag: "askFix", taskId },
            },
          ];
    case "cant-start":
      // The engine starts the queued task again, admission and all.
      return taskId === null
        ? []
        : [
            {
              kind: "command",
              ...labelled("tryAgain", mateName),
              command: { _tag: "taskRetry", taskId },
            },
          ];
    case "parked":
      // A stopped task queues again, or never goes in.
      return taskId === null
        ? []
        : [
            {
              kind: "command",
              ...labelled("tryAgain", mateName),
              command: { _tag: "taskRetry", taskId },
            },
            drop(taskId),
          ];
    case "stalled":
      // Its queue waits behind it: carry it on as you, review what it has, or drop it.
      return taskId === null || handle === null
        ? []
        : [
            {
              kind: "command",
              ...labelled("carryOn", mateName),
              command: { _tag: "message", handle, text: CREW_CARRY_ON_MESSAGE, attachments: [] },
            },
            review(taskId, "reviewWhatItHas"),
            drop(taskId),
          ];
    case "dependency-gone": {
      // What it waits for will not go in: stop waiting for it, or drop this too.
      if (taskId === null) return [];
      const task = crew.board.tasks.find((entry) => entry.id === taskId);
      const gone = task === undefined ? undefined : crewGoneDependency(task, crew.board.tasks);
      return task === undefined || gone === undefined
        ? [drop(taskId)]
        : [
            {
              kind: "command",
              ...labelled("startAnyway", mateName),
              command: {
                _tag: "taskEdit",
                taskId,
                dependsOn: task.dependsOn.filter((id) => id !== gone.id),
                // The engine's crew writes an edit only over the task as this board showed it.
                seen: { state: task.state, attempts: task.attempts },
              },
            },
            drop(taskId),
          ];
    }
    case "sent-back": {
      // No run sends it back: ask its crewmate as you, with the review's note, or drop it.
      const task = crew.board.tasks.find((entry) => entry.id === taskId);
      return taskId === null || handle === null || task === undefined
        ? []
        : [
            {
              kind: "command",
              ...labelled("askToRework", mateName),
              command: {
                _tag: "message",
                handle,
                text: crewReworkMessage(task.number, row.text),
                attachments: [],
              },
            },
            drop(taskId),
          ];
    }
    case "review-wait": {
      // Nobody reviews it: ask the lead as you, or review it yourself and add it from there.
      if (taskId === null) return [];
      const lead = crew.crewmates.find((mate) => mate.kind === "lead");
      const task = crew.board.tasks.find((entry) => entry.id === taskId);
      const yourself = review(taskId, "reviewItYourself");
      return lead === undefined || task === undefined
        ? [yourself]
        : [
            {
              kind: "command",
              ...labelled("askTheLead", mateName),
              command: {
                _tag: "message",
                handle: lead.handle,
                text: crewAskLeadToReviewMessage(task.number),
                attachments: [],
              },
            },
            yourself,
          ];
    }
  }
}

/**
 * Whether a need's press is offered to this viewer (D6): nothing that runs or
 * changes what runs on a login they may not run. A command by its own reach;
 * an answer by its crewmate's; a review by its task's crewmate's, whose
 * presses add the work or hand it back; an ask for the Mate by the chat it
 * goes to; *Try it* only where it opens what already runs (`useCrewTry`).
 */
export function crewActionOffered(
  action: CrewRowAction,
  access: Pick<CrewAccess, "command" | "reach">,
  askLock: CrewLock | null,
  tryOffered: boolean,
): boolean {
  switch (action.kind) {
    case "command":
      return access.command(action.command) === null;
    case "answer":
      return access.reach({ kind: "crewmates", handles: [action.handle] }) === null;
    case "review":
      return access.reach({ kind: "tasks", taskIds: [action.taskId] }) === null;
    case "ask":
      return askLock === null;
    case "try":
      return tryOffered;
  }
}

/**
 * A need's line: its sentence in ink, red for failing checks, finished work
 * muted with its size. A need about another task than the one the row is on
 * names that task first.
 */
function needLine(
  row: CrewAttention,
  snapshot: Pick<CrewSnapshot, "crewmates" | "hosts" | "board">,
  onTaskId: string | null,
  mateName: string,
): CrewRowLine {
  const task = snapshot.board.tasks.find((entry) => entry.id === row.taskId);
  const about = task === undefined || task.id === onTaskId ? "" : `${task.title} · `;
  if (row.kind === "ready-to-land") {
    return {
      text: `${about}${crewReadyWords(mateName)}`,
      tone: "muted",
      diff: task?.diffStat ?? undefined,
    };
  }
  return {
    text: `${about}${crewNeedSentence(row, snapshot, mateName)}`,
    tone: row.kind === "check-failed" ? "failed" : "ink",
  };
}

/** Where an open task stands while its crewmate is not at it, when nothing about it needs you. */
function standing(
  task: CrewTask,
  view: Pick<CrewView, "lead" | "personLands">,
  mateName: string,
): string | null {
  switch (task.state) {
    case "merging":
    case "checking":
      return CREW_CHECKING_ITS_WORK;
    case "review":
      return crewDoneCheckedWord(view.lead !== null);
    case "ready":
      return view.personLands ? crewReadyWords(mateName) : crewDoneGoingInWord(mateName);
    case "landing":
      return crewGoingInWord(mateName);
    case "blocked":
      return crewAskedLeadWord(task.question);
    case "rework":
      return crewSentBackWord(task.reason);
    case "proposed":
    case "queued":
    case "working":
    case "waiting-on-you":
    case "landed":
    case "parked":
    case "discarded":
      return null;
  }
}

/**
 * The lead's second line: while it works, what it is on as the crew's tasks
 * say it — a task it checks, a crewmate's question it answers — else what
 * you last asked it, the plan's subject while its plan waits.
 */
function leadOn(
  snapshot: Pick<CrewSnapshot, "board" | "crewmates" | "attention">,
  thread: CrewRowThread,
): CrewRowLine | null {
  if (thread.working) {
    const reviewing = snapshot.board.tasks.find((task) => task.state === "review");
    if (reviewing !== undefined) {
      return { text: crewLeadCheckingWord(reviewing.title), tone: "ink-2" };
    }
    // A question the lead takes first is one the person has not been handed.
    const asking = snapshot.board.tasks.find(
      (task) =>
        task.state === "blocked" &&
        !snapshot.attention.some((row) => row.kind === "question" && row.taskId === task.id),
    );
    const asker = snapshot.crewmates.find((mate) => mate.handle === asking?.owner);
    if (asker !== undefined) {
      return { text: crewLeadAnsweringWord(asker.displayName), tone: "ink-2" };
    }
  }
  return thread.asked === null ? null : { text: thread.asked, tone: "ink-2" };
}

export function crewRowModel(input: {
  readonly row: CrewmateView;
  readonly snapshot: CrewSnapshot;
  readonly view: Pick<CrewView, "lead" | "personLands">;
  readonly thread: CrewRowThread;
  /** This crewmate's rows of what the crew needs from you (`crewNeedsByHandle`). */
  readonly attention: ReadonlyArray<CrewAttention>;
  readonly mateName: string;
}): CrewRowModel {
  const { row, snapshot, view, thread, attention, mateName } = input;
  const mate = row.crewmate;
  const lead = mate.kind === "lead";
  const plan = attention.some((entry) => entry.kind === "plan");
  const asked = attention.filter((entry) => entry.kind !== "plan");

  // What it is on: its open task, else the task a need is about, else — the lead — what it works at.
  const onTask =
    row.openTask ??
    snapshot.board.tasks.find((task) => asked.some((entry) => entry.taskId === task.id)) ??
    null;
  const job: CrewRowLine = {
    text: crewJobSentence(mate.jobFirstLine, mate.displayName),
    tone: "muted",
  };
  const line2: CrewRowLine =
    onTask !== null
      ? { text: onTask.title, tone: "ink-2" }
      : lead && (thread.working || plan)
        ? (leadOn(snapshot, thread) ?? job)
        : job;

  const needs: ReadonlyArray<CrewRowNeed> = asked.map((entry) => ({
    id: entry.id,
    line: needLine(entry, snapshot, onTask?.id ?? null, mateName),
    ...(entry.copyAssignment === undefined
      ? {}
      : {
          detail: crewCopyAssignmentDetail(entry.copyAssignment),
        }),
    ...(entry.operation === undefined
      ? {}
      : { detail: crewOperationDetail(entry.operation.confirmedStage) }),
    actions: crewNeedActions(entry, snapshot, mateName),
  }));

  // Its step: a broken copy in red, a copy on its way, the live step while it works; else where
  // its task stands — unless a need says it.
  const open = row.openTask;
  const needsOnOpen = open !== null && asked.some((entry) => entry.taskId === open.id);
  const standsAt = open === null || needsOnOpen ? null : standing(open, view, mateName);
  const broken = mate.lane === null ? null : crewBrokenCopyWord(mate.lane, mateName);
  const readying = mate.lane?.state === "creating" || mate.lane?.state === "setting-up";
  const pending = snapshot.operations?.findLast(
    (operation) =>
      operation.handle === mate.handle &&
      operation.status === "running" &&
      operation.stage !== "dispatched",
  );
  const pendingWords = pending === undefined ? null : crewPendingOperationWord(pending, mateName);
  const line3: CrewRowLine | null =
    broken !== null
      ? { text: broken, tone: "failed" }
      : readying
        ? { text: CREW_COPY_READYING, tone: "muted" }
        : thread.working
          ? thread.liveStep === null
            ? null
            : { text: thread.liveStep.words, tone: "muted" }
          : pendingWords !== null
            ? { text: pendingWords, tone: "muted" }
            : standsAt === null
              ? null
              : { text: standsAt, tone: "muted" };

  // What it does next: its queue, less what a need already names.
  const named = new Set(asked.flatMap((entry) => (entry.taskId === null ? [] : [entry.taskId])));
  const next = row.queuedTasks
    .filter((task) => !named.has(task.id))
    .map((task) => task.title)
    .join(" · ");

  const servedHost = snapshot.hosts.find(
    (host) => host.served.by === "crewmate" && host.served.handle === mate.handle,
  );
  const servedWords =
    servedHost === undefined ? null : crewServedWord(servedHost, snapshot.crewmates, mateName);

  // The face: at work while it works; asking while it needs you — happy while all it has is
  // finished work to review; waking while its copy is made (`matePose`); else its thread's own.
  const finished = asked.length > 0 && asked.every((entry) => entry.kind === "ready-to-land");
  const pose: MateMarkState =
    thread.working || pending !== undefined
      ? "working"
      : plan || asked.length > 0
        ? finished && !plan
          ? "done"
          : "needs"
        : matePose(thread.face === "sleep" ? "idle" : thread.face, {
            life: readying ? "coming" : "up",
          });

  return {
    handle: mate.handle,
    name: mate.displayName,
    tint: mate.tint,
    lead,
    threadId: mate.currentThreadId,
    pose,
    needsYou: plan || asked.length > 0,
    slot:
      pending !== undefined && !thread.working
        ? { kind: "clock", since: pending.startedAt }
        : thread.at === null
          ? { kind: "none" }
          : thread.working
            ? { kind: "clock", since: thread.at }
            : { kind: "age", at: thread.at },
    line2,
    line3,
    needs,
    plan,
    served:
      servedHost === undefined || servedWords === null
        ? null
        : {
            line: { text: servedWords, tone: "muted" },
            action: {
              kind: "command",
              label: crewBackToMateWord(mateName),
              line: crewRowVerbLine("backToMate", mateName),
              command: { _tag: "claimRelease", host: servedHost.host },
            },
          },
    next: next === "" ? null : next,
  };
}
