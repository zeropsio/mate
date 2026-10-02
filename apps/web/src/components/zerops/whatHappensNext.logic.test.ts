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
        ["You sign Wren in with your Claude or ChatGPT subscription", undefined],
        ["Wren sets up development, deploying Beviro's code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "its code still being read: as with code, the likelier",
      input: { groupName: "Beviro", botName: "Wren", recipe: "reading" },
      steps: [
        ["Wren comes up", "about 1½–2 min"],
        ["You sign Wren in with your Claude or ChatGPT subscription", undefined],
        ["Wren sets up development, deploying Beviro's code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "a name ending in s takes the bare apostrophe",
      input: { groupName: "Acme Docs", botName: "Quinn", recipe: "recipe" },
      steps: [
        ["Quinn comes up", "about 1½–2 min"],
        ["You sign Quinn in with your Claude or ChatGPT subscription", undefined],
        ["Quinn sets up development, deploying Acme Docs' code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "the project's first Mate, nothing to deploy: told what to build",
      input: { groupName: "Beviro", botName: "Wren", recipe: "none" },
      steps: [
        ["Wren comes up", "about 1½–2 min"],
        ["You sign Wren in with your Claude or ChatGPT subscription", undefined],
        ["You tell Wren what to build", undefined],
      ],
      note: "You can leave while Wren comes up.",
    },
    {
      case: "a name cleared: the Mate, until it has one",
      input: { groupName: "Beviro", botName: "   ", recipe: "recipe" },
      steps: [
        ["The Mate comes up", "about 1½–2 min"],
        ["You sign the Mate in with your Claude or ChatGPT subscription", undefined],
        ["The Mate sets up development, deploying Beviro's code", "about 6–10 min"],
      ],
      note: "You can leave meanwhile.",
    },
    {
      case: "a name typed with stray spaces reads as the Mate will be called",
      input: { groupName: "Beviro", botName: "  Mira   Lin ", recipe: "none" },
      steps: [
        ["Mira Lin comes up", "about 1½–2 min"],
        ["You sign Mira Lin in with your Claude or ChatGPT subscription", undefined],
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

// A new project: the project and its first Mate, then the person signs it in and tells it what to
// build.
describe("newProjectNext — what happens once a project is created", () => {
  it.each([
    {
      case: "the project and its Mate",
      input: { projectName: "Acme Shop", botName: "Vera" },
      steps: [
        ["Acme Shop and Vera come up", "about 1½–2 min"],
        ["You sign Vera in with your Claude or ChatGPT subscription", undefined],
        ["You tell Vera what to build", undefined],
      ],
    },
    {
      case: "nothing named yet: the project and the Mate",
      input: { projectName: " ", botName: "" },
      steps: [
        ["The project and the Mate come up", "about 1½–2 min"],
        ["You sign the Mate in with your Claude or ChatGPT subscription", undefined],
        ["You tell the Mate what to build", undefined],
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
    newProjectNext({ projectName: "Acme Shop", botName: "Vera" }),
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

// The person's own step wears the brands it names (`signInPhrase`), in both dialogs.
describe("what happens next — the sign-in step", () => {
  it.each([
    newMateNext({ groupName: "Beviro", botName: "Wren", recipe: "recipe" }),
    newProjectNext({ projectName: "Acme Shop", botName: "Wren" }),
  ])("names the subscriptions it offers", (next) => {
    const step = next.steps.find((each) => each.phrase !== undefined);
    expect(step?.phrase?.map((part) => part.text).join("")).toBe(step?.words);
    expect(step?.words).toBe("You sign Wren in with your Claude or ChatGPT subscription");
  });
});
