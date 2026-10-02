/**
 * What happens after the press, as the New Mate and New project dialogs end (board D1, the
 * owner, 2026-09-30): the steps in order, the person's own among them, each with an honest time
 * where one is worth saying, and one quiet line on whether they can leave meanwhile. In the
 * person's words: never the machinery's — no container, no zcp, no recipe deployed.
 *
 * The times:
 * - a Mate is up in about 1½–2 minutes, ready to be signed in;
 * - a Mate added to a project with code then sets up development, deploying that code, by itself:
 *   6–10 minutes for a small app, about 12 for a storefront with four runtimes (SPN's Bruno,
 *   2026-10-02: 16 with one failed deploy its agent fixed), so it says up to 15.
 *
 * Pure: the words; `WhatHappensNext.tsx` draws them.
 */
import { crewPossessive } from "@t3tools/client-runtime/zerops/crew/phrases";

import { signInPhrase, signInPhraseWords, type SignInPhrasePart } from "./ZeropsAgentSignIn.logic";
import type { NewMateRecipe } from "./ZeropsEnvironmentCreationDialog.logic";

/** One step after the press. */
export interface NextStep {
  readonly words: string;
  /** The words with the brands in them marked, where they name any (`signInPhrase`). */
  readonly phrase?: ReadonlyArray<SignInPhrasePart>;
  /** How long it takes, where that is worth saying. */
  readonly time: string | undefined;
}

/** What happens after the press: its steps, and whether the person can leave meanwhile. */
export interface WhatHappensNext {
  readonly steps: ReadonlyArray<NextStep>;
  readonly note: string;
}

const MATE_UP = "about 1½–2 min";
const DEVELOPMENT_UP = "up to 15 min";

/** The Mate as the steps name it: its name as it will be called, or the Mate until it has one. */
function named(botName: string): { readonly subject: string; readonly object: string } {
  const name = botName.replace(/\s+/g, " ").trim();
  return name.length === 0
    ? { subject: "The Mate", object: "the Mate" }
    : { subject: name, object: name };
}

/** The person's own step: what they sign the Mate in with. */
function signInStep(object: string): NextStep {
  const phrase = signInPhrase(object);
  return { words: signInPhraseWords(phrase), phrase, time: undefined };
}

/**
 * Once a Mate is added: it comes up, its person signs it in, and — where the project has code —
 * it sets up development by itself, deploying that code, so they can leave meanwhile. The
 * project's first Mate has nothing to deploy yet: its person tells it what to build. While the
 * project is still being read the steps are the likelier, with code; the dialog holds both in
 * one place, so learning otherwise moves nothing.
 */
export function newMateNext(input: {
  readonly groupName: string;
  readonly botName: string;
  readonly recipe: NewMateRecipe;
}): WhatHappensNext {
  const { subject, object } = named(input.botName);
  const up: NextStep = { words: `${subject} comes up`, time: MATE_UP };
  const signIn = signInStep(object);
  if (input.recipe === "none") {
    return {
      steps: [up, signIn, { words: `You tell ${object} what to build`, time: undefined }],
      note: `You can leave while ${object} comes up.`,
    };
  }
  return {
    steps: [
      up,
      signIn,
      {
        words: `${subject} sets up development, deploying ${crewPossessive(input.groupName)} code`,
        time: DEVELOPMENT_UP,
      },
    ],
    note: "You can leave meanwhile.",
  };
}

/** Once a project is created: the project and its first Mate, then its person signs it in, then tells it what to build. */
export function newProjectNext(input: {
  readonly projectName: string;
  readonly botName: string;
}): WhatHappensNext {
  const { object } = named(input.botName);
  const project = input.projectName.replace(/\s+/g, " ").trim();
  const subject = project.length > 0 ? project : "The project";
  return {
    steps: [
      { words: `${subject} and ${object} come up`, time: MATE_UP },
      signInStep(object),
      { words: `You tell ${object} what to build`, time: undefined },
    ],
    note: "You can leave while they come up.",
  };
}
