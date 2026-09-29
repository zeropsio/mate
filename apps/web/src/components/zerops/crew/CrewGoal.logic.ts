/**
 * The crew's goal as its view edits it — a title, what it's for, the rules
 * every crewmate follows and when it is done — over the brief's markdown,
 * which is what every crewmate reads (`@t3tools/shared/crewHome`): the two
 * optional parts are its `## Binding decisions` and `## Done when` sections,
 * one item a line, as the template writes them. Any other section stays in
 * "What it's for", as written, so nothing the goal says is ever dropped.
 *
 * Pure: no I/O.
 */
import type { CrewBrief } from "@t3tools/shared/crewHome";
import { CREW_BRIEF_TEMPLATE } from "@t3tools/shared/crewTemplates";

export interface CrewGoalFields {
  readonly title: string;
  /** What it's for: the brief's text, its two optional sections taken out. */
  readonly body: string;
  /** Rules every crewmate follows, one a line. */
  readonly rules: string;
  /** Done when, one a line. */
  readonly doneWhen: string;
}

const RULES = "binding decisions";
const DONE_WHEN = "done when";

/** The template's placeholder title, which is no goal yet. */
const TEMPLATE_TITLE = "New brief";

const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])\s+/u;

/** A section's lines as the field shows them: one item a line, its list mark gone. */
const itemsOf = (lines: ReadonlyArray<string>): string =>
  lines
    .map((line) => line.replace(LIST_MARK, "").trim())
    .filter((line) => line !== "")
    .join("\n");

/** The goal's fields out of the brief; the template's placeholder reads as nothing written. */
export function crewGoalFields(brief: Pick<CrewBrief, "title" | "text">): CrewGoalFields {
  if (brief.text === CREW_BRIEF_TEMPLATE) {
    return { title: "", body: "", rules: "", doneWhen: "" };
  }
  const body: Array<string> = [];
  const known = new Map<string, Array<string>>();
  let into: Array<string> = body;
  for (const line of brief.text.split(/\r?\n/u)) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    const name = heading?.[1]?.toLowerCase();
    if (name === RULES || name === DONE_WHEN) {
      into = [];
      known.set(name, into);
      continue;
    }
    // Any other heading ends a known section and goes back to what it's for.
    if (heading !== null) into = body;
    into.push(line);
  }
  return {
    title: brief.title.trim() === TEMPLATE_TITLE ? "" : brief.title.trim(),
    body: body.join("\n").trim(),
    rules: itemsOf(known.get(RULES) ?? []),
    doneWhen: itemsOf(known.get(DONE_WHEN) ?? []),
  };
}

const section = (heading: string, items: string): string => {
  const lines = items
    .split(/\r?\n/u)
    .map((line) => line.replace(LIST_MARK, "").trim())
    .filter((line) => line !== "");
  return lines.length === 0
    ? ""
    : `\n\n## ${heading}\n${lines.map((line) => `- ${line}`).join("\n")}`;
};

/** The brief's title and markdown for the goal's fields. */
export function crewGoalMarkdown(fields: CrewGoalFields): {
  readonly title: string;
  readonly text: string;
} {
  const text = [
    fields.body.trim(),
    section("Binding decisions", fields.rules),
    section("Done when", fields.doneWhen),
  ].join("");
  return { title: fields.title.trim(), text: `${text.trim()}\n` };
}

/** How long a title the tab's head holds on one line. */
const TITLE_MAX = 60;

/**
 * A title for a goal written as one text (the setup's): its first sentence
 * or line, cut at a word to fit the head's line.
 */
export function crewGoalTitleOf(body: string): string {
  const first = body.trim().split(/\r?\n/u)[0] ?? "";
  const end = /[.!?](?=\s|$)/u.exec(first);
  const sentence = (end === null ? first : first.slice(0, end.index)).trim();
  if (sentence.length <= TITLE_MAX) return sentence;
  const cut = sentence.slice(0, TITLE_MAX);
  const word = cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:—-]+$/u, "");
  return `${word}…`;
}
