/**
 * What the New project dialog says — decided without React. The rest it shares with New Mate:
 * the Mate's name and face (`newMateSubmit`, `newMateFace`) and what happens next
 * (`newProjectNext`).
 */
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";

import { newMateSubmit } from "./ZeropsEnvironmentCreationDialog.logic";

/** A name as it will be called: its spaces collapsed, its ends trimmed. */
const called = (name: string) => name.replace(/\s+/g, " ").trim();

/**
 * What Create makes, by name, as Add a Mate's button names its Mate and project — "Create Acme
 * Shop with Vera" — and as much of it as is named while the names are still being typed.
 */
export function newProjectButton(input: {
  readonly projectName: string;
  readonly botName: string;
}): string {
  const project = called(input.projectName);
  const bot = called(input.botName);
  const what = project.length === 0 ? "a project" : project;
  return bot.length === 0 ? `Create ${what}` : `Create ${what} with ${bot}`;
}

/**
 * The first Mate's name and what Create does with it. A proposal is offered only as the refusal
 * judges it against the names read now: none until every name is read, another once it is taken.
 * What the person typed is theirs, and judged the same way.
 */
export function newProjectBotName(input: {
  readonly typed: string | null;
  readonly proposal: string;
  readonly taken: TakenBotNames;
  readonly another: (current: string) => string;
}): {
  readonly proposal: string;
  readonly botName: string;
  readonly submit: ReturnType<typeof newMateSubmit>;
} {
  const { typed, proposal, taken, another } = input;
  const judge = (botName: string) =>
    newMateSubmit({ botName, takenBotNames: taken, tier: undefined, tierLoading: false });
  if (typed !== null) return { proposal, botName: typed, submit: judge(typed) };
  if (!taken.complete) return { proposal, botName: "", submit: { kind: "wait", on: "names" } };
  const vouched = judge(proposal).kind === "create" ? proposal : another(proposal);
  return { proposal: vouched, botName: vouched, submit: judge(vouched) };
}
