/**
 * The cards the crew sends as turns: the words the agent reads and the typed {@link CrewCard} the
 * record draws in their place, so no client re-parses a card's text.
 *
 * @module crew/engine/cards
 */
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import type { CrewCard, CrewTaskSource } from "@t3tools/contracts";

import type { TaskRecord } from "./state.ts";

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
export const taskCard = (task: TaskRecord, resetTo: string | null): SentCard => {
  const doneWhen = task.card.doneWhen.trim();
  return {
    text: lines(`#${task.number} ${task.title} · ${SOURCE_LABELS[task.source]}`, [
      ...(doneWhen === "" ? [] : [`Done when: ${doneWhen}`]),
      ...(task.card.note === null ? [] : [task.card.note]),
      ...(resetTo === null
        ? []
        : [`Your copy starts again from your tree's head (${short(resetTo)}).`]),
      "",
      task.card.brief.trim(),
    ]),
    card: taskCardOf(task, "task", task.card.brief.trim(), {
      doneWhen: doneWhen === "" ? null : doneWhen,
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

/** The lead's wake for a task in review. */
export const reviewCard = (task: TaskRecord): SentCard => {
  const report = task.report?.summary ?? null;
  return {
    text: lines(`#${task.number} ${task.title} · review @${task.owner}'s work`, [
      ...(report === null ? [] : [`@${task.owner} reports: ${report}`]),
      "Its check passed on the tree that would land.",
      `Read its changes with crew_diff (handle ${task.owner}) and give your verdict on ` +
        `#${task.number} with crew_review.`,
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

export interface DevServerShape {
  readonly port: number;
  readonly command: string;
}

/** The claim turn after a grant: the dev server runs from the crewmate's copy. */
export const claimStartCard = (host: string, devServer: DevServerShape, workDir: string) =>
  noticeCard(
    "claim-start",
    `Show your work on ${host}`,
    `The person lets ${host}'s dev server run from your copy. Restart it with zerops_dev_server: ` +
      `action=restart hostname=${host} port=${devServer.port} ` +
      `processMatch="${devServer.command}" command="${devServer.command}" workDir=${workDir}. ` +
      "Nothing else.",
    host,
  );

/** The release turn: *Back to my tree*, a report, or a timeout. */
export const claimReleaseCard = (host: string, devServer: DevServerShape) =>
  noticeCard(
    "claim-release",
    `Give ${host} back`,
    `${host}'s dev server goes back to the person's tree. Restart it with zerops_dev_server: ` +
      `action=restart hostname=${host} port=${devServer.port} ` +
      `processMatch="${devServer.command}", no workDir. Nothing else.`,
    host,
  );
