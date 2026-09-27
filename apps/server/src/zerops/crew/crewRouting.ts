/**
 * crewRouting — where a message typed at the crew goes (PRD §5.3), and the
 * titles of the tasks it opens (PRD §5.3 fan-out, §6.2 implicit tasks).
 *
 * | Where typed        | With a lead                           | Without a lead                          |
 * |--------------------|---------------------------------------|-----------------------------------------|
 * | Tell the crew      | the lead's chat; mentions as hints    | 1 mention: a task · N: N tasks · 0: refused |
 * | The lead's chat    | as above                              | —                                       |
 * | A crewmate's chat  | that crewmate; mentions are not offered                                         |
 *
 * A person chat never routes to the crew in phases B and C: its composer
 * offers no crewmates, so it never reaches this module.
 *
 * Fan-out is deliberately dumb: every task carries the whole message, and
 * each crewmate reads its own part. The one cosmetic exception is the title:
 * each fan-out task is titled with the clause holding that crewmate's first
 * mention — clauses end at `.`, `;` or `,` followed by a space, or at a line
 * break (a dot inside `api.ts` ends nothing) — cut at 80 characters, falling
 * back to the message's first line.
 *
 * @module crewRouting
 */
import type { CrewMemberKind } from "@t3tools/contracts";

export const CREW_TASK_TITLE_MAX = 80;

export type CrewRoster = ReadonlyArray<{ readonly handle: string; readonly kind: CrewMemberKind }>;

export type CrewRoutingInput =
  | {
      readonly place: "tell" | "lead-chat";
      readonly roster: CrewRoster;
      readonly text: string;
      readonly mentions: ReadonlyArray<{ readonly handle: string }>;
    }
  | {
      readonly place: "crewmate-chat";
      readonly crewmate: string;
      readonly roster: CrewRoster;
      readonly text: string;
      readonly mentions: ReadonlyArray<{ readonly handle: string }>;
    };

export interface CrewRoutedTask {
  readonly handle: string;
  readonly title: string;
  /** The other crewmates the same message went to, in mention order. */
  readonly alsoSentTo: ReadonlyArray<string>;
  /** The card's line naming them, on fan-out only. */
  readonly note?: string;
}

export type CrewRoute =
  | { readonly kind: "to-lead"; readonly lead: string; readonly addressed: ReadonlyArray<string> }
  | { readonly kind: "tasks"; readonly tasks: ReadonlyArray<CrewRoutedTask> }
  | { readonly kind: "to-crewmate"; readonly handle: string }
  | {
      readonly kind: "refused";
      readonly reason: "no-mention" | "no-lead" | "unknown-mention";
      readonly handles?: ReadonlyArray<string>;
    };

const cut = (text: string): string => text.slice(0, CREW_TASK_TITLE_MAX).trim();

/** An implicit task's title: the message's first non-empty line, cut at 80 characters. */
export const implicitTaskTitle = (text: string): string =>
  cut(
    text
      .split(/\r?\n/u)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? "",
  );

const CLAUSE_END = /[.;,](?=\s|$)|\r?\n/gu;

/** The clause holding the first `@handle` in `text`, or undefined when the text has none. */
const clauseOf = (text: string, handle: string): string | undefined => {
  const at = new RegExp(`@${handle}(?![a-z0-9-])`, "u").exec(text)?.index;
  if (at === undefined) return undefined;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(CLAUSE_END)) {
    if (match.index < at) start = match.index + match[0].length;
    else {
      end = match.index;
      break;
    }
  }
  return cut(text.slice(start, end).trim());
};

const uniqueHandles = (mentions: ReadonlyArray<{ readonly handle: string }>): Array<string> => [
  ...new Set(mentions.map((mention) => mention.handle)),
];

export const routeCrewMessage = (input: CrewRoutingInput): CrewRoute => {
  if (input.place === "crewmate-chat") return { kind: "to-crewmate", handle: input.crewmate };

  const handles = uniqueHandles(input.mentions);
  const known = new Set(input.roster.map((member) => member.handle));
  const unknown = handles.filter((handle) => !known.has(handle));
  if (unknown.length > 0) return { kind: "refused", reason: "unknown-mention", handles: unknown };

  const lead = input.roster.find((member) => member.kind === "lead");
  if (lead) {
    return {
      kind: "to-lead",
      lead: lead.handle,
      addressed: handles.filter((handle) => handle !== lead.handle),
    };
  }
  if (input.place === "lead-chat") return { kind: "refused", reason: "no-lead" };
  if (handles.length === 0) return { kind: "refused", reason: "no-mention" };
  if (handles.length === 1) {
    return {
      kind: "tasks",
      tasks: [{ handle: handles[0]!, title: implicitTaskTitle(input.text), alsoSentTo: [] }],
    };
  }
  return {
    kind: "tasks",
    tasks: handles.map((handle) => {
      const others = handles.filter((other) => other !== handle);
      return {
        handle,
        title: clauseOf(input.text, handle) ?? implicitTaskTitle(input.text),
        alsoSentTo: others,
        note:
          `Also sent to ${others.map((other) => `@${other}`).join(", ")}. ` +
          `Your part is what is addressed to @${handle}.`,
      };
    }),
  };
};
