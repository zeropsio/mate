/**
 * crewCards — the text the engine writes into a crewmate's conversation.
 *
 * A card is a user message the server sends, never the person: it opens with
 * `CREW_CARD_OPENER`, its first line after the opener titles it (`#12 Camera
 * rig · from you`) and the rest is its text; the client renders it as an
 * event (`readCrewCard`). Every card the engine sends is built here:
 *
 * - the **task card** a task starts with — the whole brief, never a summary
 *   (fan-out without a lead is deliberately dumb, PRD §5.3);
 * - the one turn a press sends as the person: **continue** after *Save and
 *   apply now*, **resolve** a merge-in's conflicts, **fix** a failed check,
 *   **restart the dev server** after a landing, **show** the copy on dev and
 *   **give dev back**;
 * - a run's own turns: the **nudge** after a turn that ended without a
 *   report, the **rework** a review
 *   sent back, and the lead's wakes — a task to **review**, a crewmate's
 *   **question** — and the lead's **answer** to its crewmate;
 * - the **carried** card a new conversation's first turn on an open task
 *   starts from, so every stint begins with a card for its seam line.
 *
 * A stint's seam line — why its conversation is new — is `stintReasonWords`;
 * the chat shows it verbatim above the stint's first card. The seam lines no
 * card carries — a landing, a save that reaches the conversation later, a
 * conversation opened between turns — are thread activities
 * (`crewSeamLines`); their words are here too.
 *
 * The **rotation seed** is not a card: it is what `SessionStart` adds to a new
 * stint's first session, so the crewmate carries on without the old
 * transcript (the probe-22 fallback, PRD §5.6).
 *
 * @module crewCards
 */
import type { CrewApplyChoice, CrewTaskSource } from "@t3tools/contracts";
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";

import type { TaskCard } from "./crewTaskData.ts";
import type { PromptVersions } from "./crewVersions.ts";
import type { RotationReason } from "./rotationDecision.ts";

interface CardTask {
  readonly number: number;
  readonly title: string;
}

const card = (task: CardTask, label: string, lines: ReadonlyArray<string>): string =>
  [CREW_CARD_OPENER, `#${task.number} ${task.title} · ${label}`, ...lines].join("\n");

const short = (sha: string): string => sha.slice(0, 7);

const SOURCE_LABELS: Readonly<Record<CrewTaskSource, string>> = {
  you: "from you",
  message: "from your message",
  lead: "from the lead",
  issue: "from an issue",
};

export const taskCard = (
  task: CardTask & {
    readonly source: CrewTaskSource;
    readonly card: TaskCard;
    /** The integration head the copy was reset to before this task, if it was. */
    readonly resetTo: string | null;
  },
): string =>
  card(task, SOURCE_LABELS[task.source], [
    ...(task.card.doneWhen.trim() === "" ? [] : [`Done when: ${task.card.doneWhen.trim()}`]),
    ...(task.card.note === null ? [] : [task.card.note]),
    ...(task.resetTo === null
      ? []
      : [`Your copy starts again from your tree's head (${short(task.resetTo)}).`]),
    "",
    task.card.brief.trim(),
  ]);

/** What changed under a crewmate: its prompt's brief or job, at the new version. */
export interface PromptChange {
  readonly kind: "brief" | "job";
  readonly version: number;
}

export const continueCard = (task: CardTask & { readonly change: PromptChange }): string =>
  card(task, "continue", [
    `${task.change.kind === "job" ? "Your job" : "The brief"} changed (v${task.change.version}), ` +
      "so this is a new conversation. Continue your task from your copy and its history.",
  ]);

export const resolveCard = (task: CardTask & { readonly paths: ReadonlyArray<string> }): string =>
  card(task, "resolve the conflicts", [
    "Merging your tree's head into your copy stopped on conflicts in:",
    ...task.paths.map((path) => `- ${path}`),
    "Resolve them in your copy, keeping what both sides meant. The merge is committed once no " +
      "conflict marker is left; then report with crew_report.",
  ]);

export const fixCard = (
  task: CardTask & { readonly command: string; readonly output: string },
): string =>
  card(task, "fix the check", [
    `The check (${task.command}) failed on the tree that would land:`,
    "```",
    task.output.trimEnd(),
    "```",
    "Fix it in your copy, then report with crew_report.",
  ]);

export const reviewReworkCard = (task: CardTask & { readonly note: string }): string =>
  card(task, "rework after review", [
    "The review sent it back:",
    task.note.trim(),
    "Change it in your copy, then report with crew_report.",
  ]);

/** The lead's wake for a task in review (PRD §5.4 step 6). */
export const reviewCard = (
  task: CardTask & { readonly owner: string; readonly report: string | null },
): string =>
  card(task, `review @${task.owner}'s work`, [
    ...(task.report === null ? [] : [`@${task.owner} reports: ${task.report}`]),
    "Its check passed on the tree that would land.",
    `Read its changes with crew_diff (handle ${task.owner}) and give your verdict on #${task.number} ` +
      "with crew_review.",
  ]);

/** The lead's wake for a crewmate's question (PRD §5.4 step 8). */
export const questionCard = (
  task: CardTask & { readonly owner: string; readonly question: string },
): string =>
  card(task, `@${task.owner} asks`, [
    task.question.trim(),
    "",
    `Your reply goes to @${task.owner} as the answer. If only the person can answer it, call ` +
      "crew_report with status blocked and the question instead.",
  ]);

/** The lead's answer, as its crewmate's next turn. */
export const answerCard = (task: CardTask & { readonly lead: string; readonly answer: string }) =>
  card(task, `answer from @${task.lead}`, [task.answer.trim()]);

/** The one nudge a run sends when a turn ended without a report (CONCEPT §5 *Endings*). */
export const nudgeCard = (task: CardTask): string =>
  card(task, "no report yet", [
    "Your turn ended without crew_report. If the task is done, report done. If only the person " +
      "or the lead can unblock you, report blocked with your question. Otherwise carry on.",
  ]);

export const afterLandCard = (
  task: CardTask & {
    readonly commit: string;
    readonly host: string;
    readonly devServer: DevServerShape;
  },
): string =>
  card(task, "restart the dev server", [
    `Your task landed as ${short(task.commit)}. Restart ${task.host}'s dev server from the tree ` +
      `with zerops_dev_server: action=restart hostname=${task.host} port=${task.devServer.port} ` +
      `processMatch="${task.devServer.command}", no workDir. Nothing else.`,
  ]);

/** A dev server's restart shape: the port and full command the gate lets through (CONCEPT §3.3). */
export interface DevServerShape {
  readonly port: number;
  readonly command: string;
}

/** A card without a task: its title line is its only heading. */
const noticeCard = (title: string, text: string): string =>
  [CREW_CARD_OPENER, title, text].join("\n");

/** The claim turn after the person granted *Show on dev*. */
export const claimStartCard = (input: {
  readonly host: string;
  readonly devServer: DevServerShape;
  readonly workDir: string;
}): string =>
  noticeCard(
    `Show your work on ${input.host}`,
    `The person lets ${input.host}'s dev server run from your copy. Restart it with zerops_dev_server: ` +
      `action=restart hostname=${input.host} port=${input.devServer.port} ` +
      `processMatch="${input.devServer.command}" command="${input.devServer.command}" ` +
      `workDir=${input.workDir}. Nothing else.`,
  );

/** The release turn: *Back to my tree*, a report, or a timeout. */
export const claimReleaseCard = (input: {
  readonly host: string;
  readonly devServer: DevServerShape;
}): string =>
  noticeCard(
    `Give ${input.host} back`,
    `${input.host}'s dev server goes back to the person's tree. Restart it with zerops_dev_server: ` +
      `action=restart hostname=${input.host} port=${input.devServer.port} ` +
      `processMatch="${input.devServer.command}", no workDir. Nothing else.`,
  );

/**
 * The seam line a new stint opens with (PRD §4.5 *Seam lines*): the client
 * shows a stint's reason verbatim above its first card. `running` is what
 * the retired stint's session started with, `current` what the crew home
 * holds now.
 */
export const stintReasonWords = (
  reason: RotationReason,
  running: PromptVersions,
  current: PromptVersions,
): string => {
  switch (reason) {
    case "start-fresh":
      return "Started fresh by you";
    case "prompt-changed": {
      const brief = current.brief > running.brief;
      const job = current.job > running.job;
      const what =
        brief && job
          ? `Brief updated to v${current.brief} and job to v${current.job}`
          : brief
            ? `Brief updated to v${current.brief}`
            : `Job updated to v${current.job}`;
      return `${what} — applies from here`;
    }
    case "login-changed":
      return "New login — a new conversation";
    case "fresh-task":
      return "New conversation — the next task is unrelated work";
    case "principal-changed":
      return "New conversation — the next task is someone else's";
    case "second-rework":
      return "New conversation — the task came back a second time";
    case "compactions":
      return "New conversation — continues from memory";
    case "context-overflow":
      return "New conversation — the last one outgrew its context";
    case "transcript-missing":
    case "resume-failed":
      return "New conversation — the last one could not be resumed";
  }
};

/**
 * The seam line a save leaves in the conversation it reaches later (PRD
 * §5.6): at the next turn, now (the running turn is interrupted), or as a
 * fresh conversation once the running turn ends.
 */
export const savedSeamWords = (
  change: PromptChange,
  reason: RotationReason,
  apply: CrewApplyChoice,
): string => {
  const what =
    reason === "login-changed"
      ? "New login"
      : `${change.kind === "brief" ? "Brief" : "Job"} updated to v${change.version}`;
  switch (apply) {
    case "nextTurn":
      return `${what} — applies at the next turn`;
    case "now":
      return `${what} — applies now`;
    case "fresh":
      return `${what} — a fresh conversation follows this turn`;
  }
};

/** The seam line a landing leaves in its crewmate's chat (PRD §5.2 step 5). */
export const landedSeamWords = (number: number, commit: string): string =>
  `Task #${number} landed as ${commit.slice(0, 7)}`;

/** The seam line of a task closed with nothing of its own to land. */
export const closedSeamWords = (number: number): string =>
  `Task #${number} closed — nothing to land`;

/**
 * A new conversation's first turn on a task already open: the task and why
 * the conversation is new, then the words the turn was sent with — so the
 * stint starts from a card, which its seam line stands above.
 */
export const carriedCard = (
  task: CardTask & { readonly reason: string; readonly text: string },
): string => card(task, "continues", [task.reason, "", task.text.trim()]);

const ROTATION_WHY: Readonly<Record<RotationReason, string>> = {
  "prompt-changed": "the brief or your job changed",
  "login-changed": "you run on a different login now",
  "start-fresh": "the person started you fresh",
  "fresh-task": "your next task is unrelated work",
  "principal-changed": "your next task is for someone else",
  "second-rework": "your task comes back for a second rework",
  compactions: "your context was compacted too many times",
  "transcript-missing": "your previous conversation could not be resumed",
  "resume-failed": "your previous conversation could not be resumed",
  "context-overflow": "your previous conversation outgrew its context",
};

export const rotationSeed = (input: {
  readonly handle: string;
  readonly reason: RotationReason;
  readonly task: (CardTask & { readonly card: TaskCard; readonly report: string | null }) | null;
  /** `git log --oneline` of the copy since the task started, newest first. */
  readonly commits: ReadonlyArray<string>;
}): string => {
  const head =
    `This is a new conversation for @${input.handle}: ${ROTATION_WHY[input.reason]}. ` +
    "Your copy of the code and its history carry on.";
  const { task } = input;
  if (task === null) return head;
  return [
    head,
    "",
    `You are working on #${task.number} ${task.title}:`,
    task.card.brief.trim(),
    ...(input.commits.length === 0
      ? []
      : ["", "Commits in your copy since the task started:", ...input.commits]),
    ...(task.report === null ? [] : ["", `Your last report: ${task.report}`]),
  ].join("\n");
};
