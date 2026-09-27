import { describe, expect, it } from "@effect/vitest";

import { implicitTaskTitle, routeCrewMessage, type CrewRoster } from "./crewRouting.ts";

const withoutLead: CrewRoster = [
  { handle: "backend", kind: "writer" },
  { handle: "frontend", kind: "writer" },
  { handle: "erik", kind: "writer" },
];
const withLead: CrewRoster = [{ handle: "lead", kind: "lead" }, ...withoutLead];

const mentions = (...handles: ReadonlyArray<string>) => handles.map((handle) => ({ handle }));

describe("implicitTaskTitle", () => {
  it.each([
    { text: "Add pagination to /api/items", title: "Add pagination to /api/items" },
    { text: "\n\n  Fix the login bug  \nIt fails on Safari.", title: "Fix the login bug" },
    { text: "x".repeat(120), title: "x".repeat(80) },
    { text: "   ", title: "" },
  ])("$title", ({ text, title }) => {
    expect(implicitTaskTitle(text)).toBe(title);
  });
});

describe("routeCrewMessage", () => {
  const owner = "Rework @backend to X, implement Y on @frontend; @erik writes the business plan";

  it.each([
    {
      name: "Tell the crew with a lead goes to the lead with the mentions as hints",
      input: {
        place: "tell",
        roster: withLead,
        text: owner,
        mentions: mentions("backend", "frontend", "erik"),
      },
      route: { kind: "to-lead", lead: "lead", addressed: ["backend", "frontend", "erik"] },
    },
    {
      name: "the lead's chat routes like Tell the crew with a lead",
      input: { place: "lead-chat", roster: withLead, text: "Plan it", mentions: [] },
      route: { kind: "to-lead", lead: "lead", addressed: [] },
    },
    {
      name: "one mention without a lead is one task titled by the first line",
      input: {
        place: "tell",
        roster: withoutLead,
        text: "Add pagination for @backend\nUse cursors.",
        mentions: mentions("backend"),
      },
      route: {
        kind: "tasks",
        tasks: [{ handle: "backend", title: "Add pagination for @backend", alsoSentTo: [] }],
      },
    },
    {
      name: "N mentions without a lead are N tasks, each titled by its own clause",
      input: {
        place: "tell",
        roster: withoutLead,
        text: owner,
        mentions: mentions("backend", "frontend", "erik"),
      },
      route: {
        kind: "tasks",
        tasks: [
          {
            handle: "backend",
            title: "Rework @backend to X",
            alsoSentTo: ["frontend", "erik"],
            note: "Also sent to @frontend, @erik. Your part is what is addressed to @backend.",
          },
          {
            handle: "frontend",
            title: "implement Y on @frontend",
            alsoSentTo: ["backend", "erik"],
            note: "Also sent to @backend, @erik. Your part is what is addressed to @frontend.",
          },
          {
            handle: "erik",
            title: "@erik writes the business plan",
            alsoSentTo: ["backend", "frontend"],
            note: "Also sent to @backend, @frontend. Your part is what is addressed to @erik.",
          },
        ],
      },
    },
    {
      name: "a repeated mention is one task",
      input: {
        place: "tell",
        roster: withoutLead,
        text: "@backend first. Then @backend again",
        mentions: mentions("backend", "backend"),
      },
      route: {
        kind: "tasks",
        tasks: [
          { handle: "backend", title: "@backend first. Then @backend again", alsoSentTo: [] },
        ],
      },
    },
    {
      name: "a mention node missing from the text falls back to the first line",
      input: {
        place: "tell",
        roster: withoutLead,
        text: "Ship the release\nsee @frontend",
        mentions: mentions("backend", "frontend"),
      },
      route: {
        kind: "tasks",
        tasks: [
          {
            handle: "backend",
            title: "Ship the release",
            alsoSentTo: ["frontend"],
            note: "Also sent to @frontend. Your part is what is addressed to @backend.",
          },
          {
            handle: "frontend",
            title: "see @frontend",
            alsoSentTo: ["backend"],
            note: "Also sent to @backend. Your part is what is addressed to @frontend.",
          },
        ],
      },
    },
    {
      name: "a file name's dot does not end a clause",
      input: {
        place: "tell",
        roster: withoutLead,
        text: "@backend fixes api.ts, @frontend styles it",
        mentions: mentions("backend", "frontend"),
      },
      route: {
        kind: "tasks",
        tasks: [
          expect.objectContaining({ handle: "backend", title: "@backend fixes api.ts" }),
          expect.objectContaining({ handle: "frontend", title: "@frontend styles it" }),
        ],
      },
    },
    {
      name: "no mention and no lead is refused",
      input: { place: "tell", roster: withoutLead, text: "Do the thing", mentions: [] },
      route: { kind: "refused", reason: "no-mention" },
    },
    {
      name: "a mention of somebody not on the crew is refused, naming them",
      input: { place: "tell", roster: withoutLead, text: "@bob do it", mentions: mentions("bob") },
      route: { kind: "refused", reason: "unknown-mention", handles: ["bob"] },
    },
    {
      name: "a crewmate's chat is for that crewmate, whatever it mentions",
      input: {
        place: "crewmate-chat",
        crewmate: "backend",
        roster: withLead,
        text: "tell @frontend too",
        mentions: mentions("frontend"),
      },
      route: { kind: "to-crewmate", handle: "backend" },
    },
    {
      name: "the lead's chat without a lead is refused",
      input: { place: "lead-chat", roster: withoutLead, text: "Plan it", mentions: [] },
      route: { kind: "refused", reason: "no-lead" },
    },
  ] as const)("$name", ({ input, route }) => {
    expect(routeCrewMessage(input)).toEqual(route);
  });

  it("cuts a fan-out title at 80 characters", () => {
    const long = `@backend ${"a".repeat(100)}, @frontend b`;
    const route = routeCrewMessage({
      place: "tell",
      roster: withoutLead,
      text: long,
      mentions: mentions("backend", "frontend"),
    });
    expect(route.kind === "tasks" ? route.tasks[0]!.title : undefined).toBe(
      `@backend ${"a".repeat(71)}`,
    );
  });
});
