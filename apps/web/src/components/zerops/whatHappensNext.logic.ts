/**
 * What happens after the press, as the New Mate and New project dialogs end (board D1, the
 * owner, 2026-09-30): the steps in order, the person's own among them, each with an honest time
 * where one is worth saying, and one quiet line on when they can leave: the press's own steps run
 * in this tab for its first half minute, and the page it lands on says the same line until they
 * are through (`KEEP_TAB_OPEN_LINE`). In the person's words: never the machinery's — no container, no zcp, no recipe deployed.
 *
 * The times:
 * - a Mate is up in about 2–4 minutes, ready to be signed in (measured +160 s 2026-09-22, +202 s
 *   2026-10-15);
 * - a Mate added to a project with code then sets up development, deploying that code, by itself:
 *   6–10 minutes for a small app, about 12 for a storefront with four runtimes (SPN's Bruno,
 *   2026-10-02: 16 with one failed deploy its agent fixed), so it says up to 15.
 *
 * Pure: the words; `WhatHappensNext.tsx` draws them.
 */
import { crewPossessive } from "@t3tools/client-runtime/zerops/crew/phrases";

import { signInPhrase, signInPhraseWords, type SignInPhrasePart } from "./ZeropsAgentSignIn.logic";
import type { NewMateRecipe } from "./ZeropsEnvironmentCreationDialog.logic";
import { KEEP_TAB_OPEN_LINE } from "~/zerops/mateArrival";

/** One step after the press. */
export interface NextStep {
  readonly words: string;
  /** The words with the brands in them marked, where they name any (`signInPhrase`). */
  readonly phrase?: ReadonlyArray<SignInPhrasePart>;
  /** How long it takes, where that is worth saying. */
  readonly time: string | undefined;
}

/** What happens after the press: its steps, and when the person can leave. */
export interface WhatHappensNext {
  readonly steps: ReadonlyArray<NextStep>;
  readonly note: string;
}

const MATE_UP = "about 2–4 min";
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
 * it sets up development by itself, deploying that code. The
 * project's first Mate has nothing to deploy yet: its person tells it what to build. While the
 * project is still being read the steps are the likelier, with code; the dialog holds both in
 * one place, so learning otherwise moves nothing.
 */
export function newMateNext(input: {
  readonly groupName: string;
  readonly botName: string;
  readonly recipe: NewMateRecipe;
  /** Made automated: nobody signs it in, and its work comes from GitHub issues. */
  readonly automated?: boolean;
}): WhatHappensNext {
  const { subject, object } = named(input.botName);
  const up: NextStep = { words: `${subject} comes up`, time: MATE_UP };
  const signIn = signInStep(object);
  if (input.automated === true) {
    const tasks: NextStep = {
      words: `${subject} takes tasks from your GitHub issues`,
      time: undefined,
    };
    const develops: NextStep = {
      words: `${subject} sets up development, deploying ${crewPossessive(input.groupName)} code`,
      time: DEVELOPMENT_UP,
    };
    return {
      steps: input.recipe === "none" ? [up, tasks] : [up, develops, tasks],
      note: KEEP_TAB_OPEN_LINE,
    };
  }
  if (input.recipe === "none") {
    return {
      steps: [up, signIn, { words: `You tell ${object} what to build`, time: undefined }],
      note: KEEP_TAB_OPEN_LINE,
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
    note: KEEP_TAB_OPEN_LINE,
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
    note: KEEP_TAB_OPEN_LINE,
  };
}

/**
 * What a new Mate costs, as far as anything here knows it: no read the client makes prices a
 * Mate's computer (the platform's only price read is a project's IPv4 addon), so the line says
 * what is true — it runs on its own computer, billed by Zerops by use — and links Zerops's prices
 * rather than inventing a number.
 */
export const ZEROPS_PRICING_URL = "https://zerops.io/pricing";

export function newMateCost(botName: string): string {
  const name = botName.trim();
  return `${name === "" ? "It" : name} runs on its own computer, which Zerops bills by use while it runs.`;
}
