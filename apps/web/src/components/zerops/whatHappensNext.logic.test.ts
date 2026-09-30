import { describe, expect, it } from "vite-plus/test";

import { newMateNext, newProjectNext, type WhatHappensNext } from "./whatHappensNext.logic";

/** The steps as rows: the words, then the time where one is said. */
const rows = (next: WhatHappensNext) => next.steps.map((step) => [step.words, step.time]);

// Board D1 (2026-09-30): both dialogs end with what happens after the press, with honest times.
// A Mate added to a project with code is up in about 1½–2 minutes and signed in by its person,
// then sets up development, deploying the project's code, in about 6–10 minutes; they can leave
// meanwhile. The project's first Mate, with nothing to deploy yet, is told what to build.
describe("newMateNext — what happens once a Mate is added", () => {
  it.each([
    {
      case: "a project with code: up, signed in, development set up",
      input: { groupName: "Beviro", botName: "Wren", recipe: "recipe" },
      steps: [
        ["Wren comes up", "about 1½–2 min"],
        ["You sign Wren in", undefined],
        ["Wren sets up development, deploying Beviro's code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "its code still being read: as with code, the likelier",
      input: { groupName: "Beviro", botName: "Wren", recipe: "reading" },
      steps: [
        ["Wren comes up", "about 1½–2 min"],
        ["You sign Wren in", undefined],
        ["Wren sets up development, deploying Beviro's code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "a name ending in s takes the bare apostrophe",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "recipe" },
      steps: [
        ["Quinn comes up", "about 1½–2 min"],
        ["You sign Quinn in", undefined],
        ["Quinn sets up development, deploying Acme Docs' code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "the project's first Mate, nothing to deploy: told what to build",
      input: { groupName: "Beviro", botName: "Wren", recipe: "none" },
      steps: [
        ["Wren comes up", "about 1½–2 min"],
        ["You sign Wren in", undefined],
        ["You tell Wren what to build", undefined],
      ],
      note: "You can leave while Wren comes up.",
    },
    {
      case: "a name cleared: the Mate, until it has one",
      input: { groupName: "Beviro", botName: "   ", recipe: "recipe" },
      steps: [
        ["The Mate comes up", "about 1½–2 min"],
        ["You sign the Mate in", undefined],
        ["The Mate sets up development, deploying Beviro's code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "a name typed with stray spaces reads as the Mate will be called",
      input: { groupName: "Beviro", botName: "  Mira   Lin ", recipe: "none" },
      steps: [
        ["Mira Lin comes up", "about 1½–2 min"],
        ["You sign Mira Lin in", undefined],
        ["You tell Mira Lin what to build", undefined],
      ],
      note: "You can leave while Mira Lin comes up.",
    },
  ] as const)("$case", ({ input, steps, note }) => {
    const next = newMateNext(input);
    expect(rows(next)).toEqual(steps);
    expect(next.note).toBe(note);
  });
});

// A new project: Git hosting first where the account has none — it comes up alongside, for all
// the team's projects — then the project and its first Mate, then the person signs it in and
// tells it what to build.
describe("newProjectNext — what happens once a project is created", () => {
  it.each([
    {
      case: "the account's first project: Git hosting alongside",
      input: {
        projectName: "Acme Shop",
        botName: "Vera",
        organizationName: "Mate s.r.o.",
        withGitHosting: true,
      },
      steps: [
        ["Mate s.r.o. gets Git hosting, for all its projects", "about 3 min"],
        ["Acme Shop and Vera come up meanwhile", "about 1½–2 min"],
        ["You sign Vera in and tell it what to build", undefined],
      ],
    },
    {
      case: "Git hosting there already: the project and its Mate",
      input: {
        projectName: "Acme Shop",
        botName: "Vera",
        organizationName: "Mate s.r.o.",
        withGitHosting: false,
      },
      steps: [
        ["Acme Shop and Vera come up", "about 1½–2 min"],
        ["You sign Vera in and tell it what to build", undefined],
      ],
    },
    {
      case: "nothing named yet: the project and the Mate",
      input: { projectName: " ", botName: "", organizationName: undefined, withGitHosting: true },
      steps: [
        ["Your team gets Git hosting, for all its projects", "about 3 min"],
        ["The project and the Mate come up meanwhile", "about 1½–2 min"],
        ["You sign the Mate in and tell it what to build", undefined],
      ],
    },
  ] as const)("$case", ({ input, steps }) => {
    const next = newProjectNext(input);
    expect(rows(next)).toEqual(steps);
    expect(next.note).toBe("You can leave while they come up.");
  });
});

// The owner reads these as a person would: never the machinery's words.
describe("what happens next — in the person's words", () => {
  const all: ReadonlyArray<WhatHappensNext> = [
    ...(["recipe", "reading", "none"] as const).map((recipe) =>
      newMateNext({ groupName: "Beviro", botName: "Wren", recipe }),
    ),
    ...[true, false].map((withGitHosting) =>
      newProjectNext({
        projectName: "Acme Shop",
        botName: "Vera",
        organizationName: "Mate s.r.o.",
        withGitHosting,
      }),
    ),
  ];
  it.each(["container", "zcp", "recipe", "deployed", "import", "service"])(
    "never says '%s'",
    (word) => {
      for (const next of all) {
        for (const said of [...next.steps.map((step) => step.words), next.note]) {
          expect(said.toLowerCase()).not.toContain(word);
        }
      }
    },
  );
});
