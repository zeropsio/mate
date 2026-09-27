/**
 * crewPrompt — a crewmate's system prompt: `ThreadToolPolicy.sessionContext`,
 * which the Claude adapter appends to `systemPrompt.append` (PRD §5.6).
 *
 * In order: the crew rules, the brief at version N, the crewmate's job at
 * version M. Nothing else — not the roster (PRD Δ7: adding or renaming a
 * crewmate would otherwise invalidate every prompt), not tasks (they arrive as
 * cards), not memory (the state packet carries it). The rules name only what
 * is fixed after Apply — the handle, the kind and the copy — so a rename or a
 * model change never touches the prompt; the brief and job text change it
 * only through their versions.
 *
 * The rules are written as facts, since the prompt stays in force after every
 * compaction while the project CLAUDE.md, re-read from disk, keeps teaching
 * `/var/www/<host>/` and `ssh <host> "cd /var/www && …"` (CONCEPT §3A.3).
 *
 * @module crewPrompt
 */
import type { CrewBrief } from "@t3tools/shared/crewHome";

import type { CrewLane } from "./CrewDefinition.ts";

export type CrewPromptMember =
  | { readonly handle: string; readonly kind: "writer"; readonly lane: CrewLane }
  | { readonly handle: string; readonly kind: "reader" | "lead" };

export interface CrewPromptInput {
  readonly member: CrewPromptMember;
  readonly brief: CrewBrief;
  readonly briefVersion: number;
  readonly job: string;
  readonly jobVersion: number;
  /** Phase C: the crewmate keeps memory through `crew_memory`. */
  readonly memory: boolean;
}

const writerRules = (handle: string, lane: CrewLane): ReadonlyArray<string> => [
  `You are @${handle}, a crewmate of this Mate. You change files only in your own copy of the code.`,
  "",
  `- Your copy is branch ${lane.branch}, checked out at ${lane.mountDir}/ (on ${lane.host}: ${lane.remoteDir}).`,
  `- Where the project guidance says ${lane.mountRoot}/, use ${lane.mountDir}/. Write and edit files only there.`,
  `- Run commands as ssh ${lane.host} "<command>". They already run in your copy: leave out any cd ${lane.remoteRoot}.`,
  "- Git is the engine's: it commits your work at the end of every turn. You may read history (git status, log, diff, show); never commit, reset, merge or push.",
  "- Your task arrives as a card in this conversation. When it is done, or when you need the person, say so with crew_report.",
];

const readerRules = (handle: string): ReadonlyArray<string> => [
  `You are @${handle}, a read-only crewmate of this Mate: you have no copy of the code and you never change files.`,
  "",
  "- You read files and the crew's changes, and you report what you find with crew_report.",
];

const leadRules = (handle: string): ReadonlyArray<string> => [
  `You are @${handle}, the crew's lead: you plan and review, you have no copy of the code and you never change files.`,
  "",
  "- Split the work into tasks, one area of the code per crewmate, each with a brief and a Done when, and propose them with crew_propose. Nothing starts until the person accepts, unless the run allows it.",
  "- Who is on the crew and what they work on is on the board (crew_board). Read a crewmate's changes with crew_diff and review them with crew_review.",
];

const commonRules = (memory: boolean): ReadonlyArray<string> => [
  "- Your context is compacted automatically; do not stop early. Files are the truth: re-read a file before you edit or judge it.",
  ...(memory
    ? [
        "- Record decisions, lessons and your handoff with crew_memory as you go.",
        "- The brief outranks your memory: when they disagree, follow the brief.",
      ]
    : []),
];

export const crewSessionContext = (input: CrewPromptInput): string => {
  const { member } = input;
  const rules =
    member.kind === "writer"
      ? writerRules(member.handle, member.lane)
      : member.kind === "reader"
        ? readerRules(member.handle)
        : leadRules(member.handle);
  return [
    "# Crew rules",
    "",
    ...rules,
    ...commonRules(input.memory),
    "",
    `# Brief v${input.briefVersion}: ${input.brief.title}`,
    "",
    input.brief.text.trim(),
    "",
    `# Your job v${input.jobVersion}`,
    "",
    input.job.trim(),
    "",
  ].join("\n");
};
