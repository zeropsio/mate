/**
 * The cards the crew sends as turns: the words the agent reads and the typed {@link CrewCard} the
 * record draws in their place, so no client re-parses a card's text.
 *
 * @module crew/engine/cards
 */
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import type { CrewCard, CrewTaskSource } from "@t3tools/contracts";

import { backToTreeCommand, type DevServerShape, showOnDevCommand } from "../crewShowOnDev.ts";
import {
  opensApp,
  reviewsOf,
  type CrewState,
  type HandOffOutcome,
  type TaskRecord,
} from "./state.ts";

export interface SentCard {
  readonly text: string;
  readonly card: CrewCard;
}

const SOURCE_LABELS: Readonly<Record<CrewTaskSource, string>> = {
  you: "from you",
  message: "from your message",
  lead: "from the lead",
  issue: "from an issue",
};

const short = (sha: string): string => sha.slice(0, 7);

const taskCardOf = (
  task: Pick<TaskRecord, "id" | "number" | "title">,
  kind: CrewCard["kind"],
  why: string,
  extra: Partial<Pick<CrewCard, "doneWhen" | "links">> = {},
): CrewCard => ({
  kind,
  taskId: task.id,
  number: task.number,
  title: task.title,
  why,
  doneWhen: extra.doneWhen ?? null,
  links: extra.links ?? [],
});

/** A card's words as the agent reads them: the crew's opener, its heading, its body. */
const lines = (head: string, body: ReadonlyArray<string>): string =>
  [CREW_CARD_OPENER, head, ...body].join("\n");

/** A task's first turn: the whole brief, never a summary. */
/** What a reader's task reviews: the writer's task, and how that writer's own app opens. */
export interface ReviewedWork {
  readonly number: number;
  readonly title: string;
  readonly owner: string;
  /** The writer runs its app on a crew port (`opensApp`). */
  readonly opens: boolean;
  /** Where a browser reaches that app inside the project (`appAddressOf`). */
  readonly app: string | null;
}

const reviewLines = (work: ReviewedWork): ReadonlyArray<string> => [
  `You review #${work.number} ${work.title}, @${work.owner}'s work: read its changes with ` +
    `crew_diff (handle ${work.owner}), then give your verdict on #${work.number} with crew_review.`,
  ...(work.opens
    ? [
        `@${work.owner} runs its own app from its copy while it works: open its pages with ` +
          `crew_open_app (handle ${work.owner})` +
          (work.app === null ? "." : `, or at ${work.app} with zerops_browser where you have it.`),
      ]
    : []),
];

export const taskCard = (
  task: TaskRecord,
  resetTo: string | null,
  reviews?: ReviewedWork,
): SentCard => {
  const doneWhen = task.card.doneWhen.trim();
  return {
    text: lines(`#${task.number} ${task.title} · ${SOURCE_LABELS[task.source]}`, [
      ...(doneWhen === "" ? [] : [`Done when: ${doneWhen}`]),
      ...(task.card.note === null ? [] : [task.card.note]),
      ...(resetTo === null
        ? []
        : [`Your copy starts again from your tree's head (${short(resetTo)}).`]),
      ...(reviews === undefined ? [] : reviewLines(reviews)),
      "",
      task.card.brief.trim(),
    ]),
    card: taskCardOf(task, "task", task.card.brief.trim(), {
      doneWhen: doneWhen === "" ? null : doneWhen,
      ...(reviews === undefined ? {} : { links: [{ kind: "crewmate", handle: reviews.owner }] }),
    }),
  };
};

/** A task carried on: a run going on after a pause, a new session, a restart. */
export const continueCard = (task: TaskRecord, why: string): SentCard => ({
  text: lines(`#${task.number} ${task.title} · continues`, [
    why,
    "",
    "Carry on with your task from your copy and its history.",
  ]),
  card: taskCardOf(task, "continue", why),
});

/**
 * A new session's first turn on a task already open: the task and why the session is new, then
 * the words the turn was sent with.
 */
export const carriedCard = (task: TaskRecord, why: string, text: string): SentCard => ({
  text: lines(`#${task.number} ${task.title} · continues`, [why, "", text.trim()]),
  card: taskCardOf(task, "continue", why),
});

export const resolveCard = (task: TaskRecord, paths: ReadonlyArray<string>): SentCard => ({
  text: lines(`#${task.number} ${task.title} · resolve the conflicts`, [
    "Merging your tree's head into your copy stopped on conflicts in:",
    ...paths.map((path) => `- ${path}`),
    "Resolve them in your copy, keeping what both sides meant. The merge is committed once no " +
      "conflict marker is left; then report with crew_report.",
  ]),
  card: taskCardOf(task, "resolve", paths.join("\n"), {
    links: paths.map((path) => ({ kind: "path" as const, path })),
  }),
});

export const fixCard = (task: TaskRecord, command: string, output: string): SentCard => ({
  text: lines(`#${task.number} ${task.title} · fix the check`, [
    `The check (${command}) failed on the tree that would land:`,
    "```",
    output.trimEnd(),
    "```",
    "Fix it in your copy, then report with crew_report.",
  ]),
  card: taskCardOf(task, "fix", output.trimEnd()),
});

export const reworkCard = (task: TaskRecord, note: string): SentCard => ({
  text: lines(`#${task.number} ${task.title} · rework after review`, [
    "The review sent it back:",
    note.trim(),
    "Change it in your copy, then report with crew_report.",
  ]),
  card: taskCardOf(task, "rework", note.trim()),
});

export const nudgeCard = (task: TaskRecord): SentCard => ({
  text: lines(`#${task.number} ${task.title} · no report yet`, [
    "Your turn ended without crew_report. If the task is done, report done. If only the person " +
      "or the lead can unblock you, report blocked with your question. Otherwise carry on.",
  ]),
  card: taskCardOf(task, "nudge", ""),
});

const verdictLine = (reader: TaskRecord, on: TaskRecord): string =>
  reader.verdict === undefined
    ? `@${reader.owner} gave no verdict on #${on.number}.`
    : `@${reader.owner}'s verdict on #${on.number}: ${reader.verdict.verdict}` +
      (reader.verdict.note.trim() === "" ? "." : ` — ${reader.verdict.note.trim()}`);

/**
 * The lead's wake for a task in review, with what the readers said of it. A reader's own task
 * carries its verdict on the task it reviews: only the lead's verdict on that task lands it.
 */
export const reviewCard = (state: CrewState, task: TaskRecord): SentCard => {
  const report = task.report?.summary ?? null;
  const reviewed = task.reviews === undefined ? undefined : state.tasks[task.reviews];
  const verdicts = reviewsOf(state, task).flatMap((reader) =>
    reader.verdict === undefined ? [] : [verdictLine(reader, task)],
  );
  const owner = state.members[task.owner];
  const read =
    owner?.kind === "writer"
      ? `Read its changes with crew_diff (handle ${task.owner})` +
        (opensApp(owner) ? `, open its app with crew_open_app (handle ${task.owner}),` : "") +
        ` and give your verdict on #${task.number} with crew_review.`
      : `It changed no files: give your verdict on #${task.number} with crew_review.`;
  return {
    text: lines(`#${task.number} ${task.title} · review @${task.owner}'s work`, [
      ...(report === null ? [] : [`@${task.owner} reports: ${report}`]),
      ...(reviewed === undefined
        ? []
        : [
            verdictLine(task, reviewed),
            `Only your verdict on #${reviewed.number} lands it: give it with crew_review.`,
          ]),
      ...verdicts,
      "Its check passed on the tree that would land.",
      read,
    ]),
    card: taskCardOf(task, "review", report ?? "", {
      links: [{ kind: "crewmate", handle: task.owner }],
    }),
  };
};

/** The lead's wake for a crewmate's question. */
export const questionCard = (task: TaskRecord, question: string): SentCard => ({
  text: lines(`#${task.number} ${task.title} · @${task.owner} asks`, [
    question.trim(),
    "",
    `Your reply goes to @${task.owner} as the answer. If only the person can answer it, call ` +
      "crew_report with status blocked and the question instead.",
  ]),
  card: taskCardOf(task, "question", question.trim(), {
    links: [{ kind: "crewmate", handle: task.owner }],
  }),
});

/** An answer to a crewmate's question: the lead's reply, or the person's. */
export const answerCard = (task: TaskRecord, from: string | null, answer: string): SentCard => ({
  text: lines(
    `#${task.number} ${task.title} · ${from === null ? "answer" : `answer from @${from}`}`,
    [answer.trim()],
  ),
  card: taskCardOf(task, "answer", answer.trim(), {
    links: from === null ? [] : [{ kind: "crewmate", handle: from }],
  }),
});

const noticeCard = (
  kind: CrewCard["kind"],
  title: string,
  text: string,
  host: string,
): SentCard => ({
  text: lines(title, [text]),
  card: {
    kind,
    taskId: null,
    number: null,
    title,
    why: text,
    doneWhen: null,
    links: [{ kind: "host", host }],
  },
});

/** The claim turn after a grant: the dev server runs from the crewmate's copy. */
export const claimStartCard = (
  host: string,
  handle: string,
  devServer: DevServerShape,
  workDir: string,
) =>
  noticeCard(
    "claim-start",
    `Show your work on ${host}`,
    `The person lets ${host}'s dev server run from your copy. Run exactly this one command: ` +
      `${showOnDevCommand(host, handle, devServer, workDir)}. Nothing else.`,
    host,
  );

/** The release turn: *Back to my tree*, a report, or a timeout. */
export const claimReleaseCard = (host: string, handle: string, devServer: DevServerShape) =>
  noticeCard(
    "claim-release",
    `Give ${host} back`,
    `${host}'s dev server goes back to the person's tree. Run exactly this one command: ` +
      `${backToTreeCommand(host, handle, devServer)}. Nothing else.`,
    host,
  );

const HANDED_OFF: Readonly<Record<HandOffOutcome, string>> = {
  ready: "is ready",
  asks: "asks",
  "needs-you": "waits for the person",
  landed: "landed",
  parked: "is parked",
  discarded: "was discarded",
};

/** What the task's state says, in the crew's own words. */
const handOffWhy = (task: TaskRecord, outcome: HandOffOutcome): string => {
  switch (outcome) {
    case "ready":
      return task.report?.summary.trim() || "Its check passed.";
    case "asks":
      return task.report?.question?.trim() ?? "";
    case "needs-you":
      return `Its landing waits on files edited in your tree: ${(task.wait?.paths ?? []).join(", ")}`;
    case "landed":
      return task.landedCommit === null
        ? "It is in your tree."
        : `It is in your tree as ${short(task.landedCommit)}.`;
    case "parked":
      return task.wait?.reason ?? "";
    case "discarded":
      return "";
  }
};

/** What the conversation's agent does next: carries on, or tells the person what only they do. */
const handOffNext = (task: TaskRecord, outcome: HandOffOutcome): string => {
  switch (outcome) {
    case "ready":
      return (
        "Tell the person it is ready: they land it, or send it back with a note, from its card " +
        "in this conversation. Carry on with what does not wait on it."
      );
    case "asks":
      return `Tell the person: they answer @${task.owner} in its conversation, and it goes on.`;
    case "needs-you":
      return "Tell the person: it lands once those files are committed or put away.";
    case "landed":
      return "Carry on with what it unblocks.";
    case "parked":
      return "Tell the person: they retry it, or drop it, from its card.";
    case "discarded":
      return "Carry on without it.";
  }
};

/** How a task this conversation handed off went: its agent hears it as a turn and carries on. */
export const handOffCard = (task: TaskRecord, outcome: HandOffOutcome): SentCard => {
  const why = handOffWhy(task, outcome);
  return {
    text: lines(`#${task.number} ${task.title} · @${task.owner} ${HANDED_OFF[outcome]}`, [
      ...(why === "" ? [] : [why, ""]),
      handOffNext(task, outcome),
    ]),
    card: taskCardOf(task, "hand-off", why, {
      links: [{ kind: "crewmate", handle: task.owner }],
    }),
  };
};
