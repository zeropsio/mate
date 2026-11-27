/**
 * Work a Mate gives the crew it has, as a `crew-run` fence: a goal, written as a crew ask's
 * (`crewAsk.logic.ts`), that its card's press saves as the crew's brief and starts the crew on.
 * The crew's latest run names the card whose press started it (`CrewRun.ask`), so the card reads
 * what became of its press from the crew, never from the press.
 */
import type { CrewCommand, CrewRun, CrewStatus } from "@t3tools/contracts";

import { crewGoalTitleOf } from "../zerops/crew/CrewGoal.logic";
import { type AskState, askKeyOf } from "./ask.logic";
import { crewAskGoalLead } from "./crewAsk.logic";

const LONGEST_TITLE = 240;
const LONGEST_TEXT = 4000;

export interface CrewRunAsk {
  /** The ask's name in its conversation: the same fence is the same ask. */
  readonly key: string;
  /** A verb and its subject: "Run the crew on the entry count". */
  readonly title: string;
  readonly why: string | undefined;
  /** The crew's new brief: what it builds and why, then its binding decisions and when it is done. */
  readonly goal: string;
}

function text(value: unknown, longest: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, longest);
}

/** The work a `crew-run` fence gives the crew, or `null` for words that give it none. */
export function parseCrewRunAsk(source: string): CrewRunAsk | null {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const title = text(
    typeof fields.title === "string" ? fields.title.replace(/\s+/gu, " ") : fields.title,
    LONGEST_TITLE,
  );
  const goal = text(fields.goal, LONGEST_TEXT);
  if (title === undefined || goal === undefined) return null;
  return { key: askKeyOf(source.trim()), title, why: text(fields.why, LONGEST_TEXT), goal };
}

/** The brief the press saves: titled, as the goal's editor titles one, by its first sentence. */
export function crewRunBrief(ask: Pick<CrewRunAsk, "goal">): {
  readonly title: string;
  readonly text: string;
} {
  return { title: crewGoalTitleOf(crewAskGoalLead(ask.goal)), text: `${ask.goal}\n` };
}

/**
 * What Start tells the crew once its run is on: the goal, for its lead to plan. A run's start
 * wakes a lead only for the reviews and questions already waiting, so without it the crew's run
 * is on and nobody works.
 */
export function crewRunTell(ask: Pick<CrewRunAsk, "goal">): CrewCommand {
  return {
    _tag: "tell",
    text: `Plan and run the crew's new goal: ${crewRunBrief(ask).title}`,
    mentions: [],
  };
}

/**
 * The card's state, read off the Mate's crew: set up only once a crew stands; done once the
 * crew's latest run is the one this card's press started, saying what became of it; any other
 * run under way (on, paused or finishing) took its place, since a crew runs one at a time; a crew
 * with no lead has nobody to plan the goal (`crewRunTell`). While the crew is unread it waits as
 * it would with no run.
 */
export function crewRunAskState(
  crew: {
    readonly status: CrewStatus | null;
    readonly run: CrewRun | null;
    /** `null` while the crew is unread. */
    readonly hasLead: boolean | null;
  },
  key: string,
  mate: string | undefined,
): AskState {
  const name = mate ?? "This Mate";
  if (crew.status === "off") return { kind: "failed", words: `Crews are turned off for ${name}.` };
  if (crew.status === "none") return { kind: "failed", words: `${name} has no crew yet.` };
  const run = crew.run;
  if (run?.ask === key) {
    const words =
      run.state === "running"
        ? "The crew is on it"
        : run.state === "paused"
          ? "The crew's run is paused"
          : run.state === "finishing"
            ? "The crew is finishing"
            : "The crew's run is over";
    return { kind: "done", words, told: null };
  }
  if (
    run !== null &&
    (run.state === "running" || run.state === "paused" || run.state === "finishing")
  ) {
    return { kind: "replaced", words: "The crew is already at work" };
  }
  if (crew.hasLead === false) {
    return { kind: "failed", words: `${name}'s crew has no lead to plan it.` };
  }
  return { kind: "waiting" };
}
