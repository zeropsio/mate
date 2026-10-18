/**
 * Slack's words in and out (`slack.ts`): an ask as a person wrote it, read as plain text without
 * Mate's own mention and Slack's markup; and what HQ says in a task's thread, escaped as Slack
 * reads a message.
 *
 * @module slackText
 */
import { MATE_TASK_BODY_MAX, MATE_TASK_TITLE_MAX } from "@t3tools/contracts";

import { BUDGET_WAIT, type TaskEnd, type TaskStatus, taskEndWords } from "./taskSources.ts";

/** Slack's markup of what a message names: `<@U1|name>`, `<#C1|name>`, `<!here>`, `<url|label>`. */
const MARKUP = /<([^<>]*)>/gu;

/** One piece of Slack's markup, as a person reads it; Mate's own mention reads as nothing. */
const plainOf = (inner: string, botUserId: string) => {
  const [target = "", label] = inner.split("|", 2);
  if (target.startsWith("@"))
    return target.slice(1) === botUserId ? "" : `@${label ?? target.slice(1)}`;
  if (target.startsWith("#")) return `#${label ?? target.slice(1)}`;
  if (target.startsWith("!")) {
    if (label !== undefined) return label;
    const special = target.slice(1).split("^", 1)[0] ?? "";
    return `@${special}`;
  }
  if (label === undefined || label === target) return target;
  if (`mailto:${label}` === target) return label;
  return `${label} (${target})`;
};

/** Slack's escapes of `&`, `<` and `>` in a message's text, undone. */
const unescape = (text: string) =>
  text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/**
 * The ask a message carries, as plain text: Mate's mention (`<@botUserId>`) taken out, every other
 * mention, channel and link spelled as a person reads it, cut to what a task carries.
 */
export const askOf = (text: string, botUserId: string) =>
  unescape(text.replaceAll(MARKUP, (_, inner: string) => plainOf(inner, botUserId)))
    .replaceAll(/[ \t]+\n/gu, "\n")
    .trim()
    .slice(0, MATE_TASK_BODY_MAX);

/** An ask's title: its first line that says something, cut to a task's title. */
export const titleOf = (ask: string) =>
  (ask.split("\n").find((line) => line.trim() !== "") ?? "").trim().slice(0, MATE_TASK_TITLE_MAX);

/** `text` as Slack shows it literally: `&`, `<` and `>` escaped. */
export const escaped = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A link Slack shows as one, its address kept out of the markup it closes. */
const link = (url: string) => `<${url.replaceAll(">", "%3E").replaceAll("|", "%7C")}>`;

/** The one status message HQ keeps in a task's thread, as the task moves. */
export const statusText = (status: TaskStatus): string => {
  switch (status.kind) {
    case "queued":
      return `Queued (#${String(status.position)} in line for a free Mate).`;
    case "budget":
      return BUDGET_WAIT;
    case "picked":
      return `${escaped(status.mate)} picked this up.`;
    case "waiting":
      return `${escaped(status.mate)} is waiting for an answer. Reply in this thread.`;
    case "change":
      return `${escaped(status.mate)} opened a change for review: ${link(status.link)}`;
    case "done":
      return status.link === null
        ? `${escaped(status.mate)} finished this.`
        : `${escaped(status.mate)} finished this: ${link(status.link)}`;
    case "failed":
      return status.mate === null
        ? `This couldn't be finished: ${escaped(status.why)}`
        : `${escaped(status.mate)} couldn't finish this: ${escaped(status.why)}`;
    case "stopped":
      return `Stopped: ${escaped(status.why)}`;
    case "merged":
      return status.pullRequest !== undefined
        ? `Merged: ${link(status.pullRequest.url)}`
        : status.change == null
          ? "Merged."
          : `Merged into main: ${link(status.change)}`;
  }
};

/** A task's question, put to the person who asked, where Slack tells them of it. */
export const questionText = (asker: string, mate: string, question: string) =>
  `<@${asker}> ${escaped(mate)} asks: ${escaped(question)}`;

/** What HQ answers in a thread it takes no task from, and why. */
export const REPLIES = {
  notMember: "Only members of this Slack workspace can ask Mate.",
  unchecked: "Mate couldn't check who you are just now. Try again in a minute.",
  unmapped: "This channel isn't connected to an application in Mate.",
  empty: "Say what you need after @Mate.",
  unavailable: "Mate couldn't take this in just now. Ask again in a minute.",
} as const;

/** A reply after its task ended: how it ended, and that a new mention asks again. */
export const endedText = (end: TaskEnd) =>
  escaped(taskEndWords(end, "Mention @Mate in a new message"));
