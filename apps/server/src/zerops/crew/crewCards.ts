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
 *   **restart the dev server** after a landing.
 *
 * The **rotation seed** is not a card: it is what `SessionStart` adds to a new
 * stint's first session, so the crewmate carries on without the old
 * transcript (the probe-22 fallback, PRD §5.6).
 *
 * @module crewCards
 */
import type { CrewTaskSource } from "@t3tools/contracts";
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";

import type { TaskCard } from "./crewTaskData.ts";
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
