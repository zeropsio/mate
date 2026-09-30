import { parseBrief } from "@t3tools/shared/crewHome";
import { CREW_BRIEF_TEMPLATE } from "@t3tools/shared/crewTemplates";
import { describe, expect, it } from "vite-plus/test";

import {
  crewGoalFields,
  crewGoalMarkdown,
  crewGoalTitleOf,
  type CrewGoalFields,
} from "./CrewGoal.logic";

const LETOPIS: CrewGoalFields = {
  title: "Letopis — shared persistent world",
  body: "Letopis is a persistent, gradually expanding 3D world.\n\nSeasons come next.",
  rules:
    "The server is the only source of truth: clients never decide what happens.\nNothing in the world resets. Every change is saved.",
  doneWhen: "A player walks from one season into the next without a reload.",
};

describe("the crew's goal: four fields and the brief's markdown", () => {
  it("writes the two optional parts as the brief's own sections", () => {
    expect(crewGoalMarkdown(LETOPIS)).toEqual({
      title: "Letopis — shared persistent world",
      text: [
        "Letopis is a persistent, gradually expanding 3D world.",
        "",
        "Seasons come next.",
        "",
        "## Binding decisions",
        "- The server is the only source of truth: clients never decide what happens.",
        "- Nothing in the world resets. Every change is saved.",
        "",
        "## Done when",
        "- A player walks from one season into the next without a reload.",
        "",
      ].join("\n"),
    });
  });

  it.each<[string, CrewGoalFields]>([
    ["every field", LETOPIS],
    ["no rules", { ...LETOPIS, rules: "" }],
    ["no done-when", { ...LETOPIS, doneWhen: "" }],
    ["the body alone", { ...LETOPIS, rules: "", doneWhen: "" }],
  ])("reads back what it wrote: %s", (_, fields) => {
    const { title, text } = crewGoalMarkdown(fields);
    expect(crewGoalFields(parseBrief(title, text))).toEqual(fields);
  });

  it("reads what the engine reads out of it", () => {
    const { title, text } = crewGoalMarkdown(LETOPIS);
    expect(parseBrief(title, text)).toMatchObject({
      bindingDecisions:
        "- The server is the only source of truth: clients never decide what happens.\n- Nothing in the world resets. Every change is saved.",
      doneWhen: ["A player walks from one season into the next without a reload."],
    });
  });

  it("keeps any other section in what it's for, as written", () => {
    const brief = parseBrief(
      "Acme Docs",
      "Docs for Acme.\n\n## Audience\nDevelopers first.\n\n## Done when\n1. Search works\n",
    );
    expect(crewGoalFields(brief)).toEqual({
      title: "Acme Docs",
      body: "Docs for Acme.\n\n## Audience\nDevelopers first.",
      rules: "",
      doneWhen: "Search works",
    });
  });

  it("reads the template's placeholder as nothing written yet", () => {
    expect(crewGoalFields(parseBrief("New brief", CREW_BRIEF_TEMPLATE))).toEqual({
      title: "",
      body: "",
      rules: "",
      doneWhen: "",
    });
  });
});

describe("crewGoalTitleOf: a title from what the goal says", () => {
  it.each([
    ["its first sentence", "Docs for Acme. Search comes first.", "Docs for Acme"],
    ["its first line", "Seasons for the world\nWinter and summer.", "Seasons for the world"],
    [
      "cut at a word before 60",
      "Letopis is a persistent, gradually expanding 3D world built by players and their agents",
      "Letopis is a persistent, gradually expanding 3D world built…",
    ],
    ["nothing written", "   ", ""],
  ])("%s", (_, body, title) => {
    expect(crewGoalTitleOf(body)).toBe(title);
  });
});
