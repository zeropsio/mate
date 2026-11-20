import { expect, it } from "vite-plus/test";

import { routeCrewMessage, type CrewRoster } from "./crewRouting.ts";

const withoutLead: CrewRoster = [
  { handle: "backend", kind: "writer" },
  { handle: "frontend", kind: "writer" },
  { handle: "erik", kind: "writer" },
];
const withLead: CrewRoster = [{ handle: "lead", kind: "lead" }, ...withoutLead];

const mentions = (...handles: ReadonlyArray<string>) => handles.map((handle) => ({ handle }));

const owner = "Rework @backend to X, implement Y on @frontend; @erik writes the business plan";

// witness: apps/server/src/zerops/crew/crewRouting.ts | input.roster.find((member) => member.kind === "lead") → input.roster[0]
it("CM23: A message typed at a crew with a lead goes to the lead with its mentions as hints, the lead's chat without a lead is refused, and a crewmate's chat goes to that crewmate whatever it mentions", () => {
  expect(
    routeCrewMessage({
      place: "tell",
      roster: withLead,
      text: owner,
      mentions: mentions("backend", "frontend", "erik"),
    }),
  ).toEqual({ kind: "to-lead", lead: "lead", addressed: ["backend", "frontend", "erik"] });
  expect(
    routeCrewMessage({ place: "lead-chat", roster: withLead, text: "Plan it", mentions: [] }),
  ).toEqual({ kind: "to-lead", lead: "lead", addressed: [] });
  expect(
    routeCrewMessage({ place: "lead-chat", roster: withoutLead, text: "Plan it", mentions: [] }),
  ).toEqual({ kind: "refused", reason: "no-lead" });
  expect(
    routeCrewMessage({
      place: "crewmate-chat",
      crewmate: "backend",
      roster: withLead,
      text: "tell @frontend too",
      mentions: mentions("frontend"),
    }),
  ).toEqual({ kind: "to-crewmate", handle: "backend" });
});

// witness: apps/server/src/zerops/crew/crewRouting.ts | ...new Set(mentions.map((mention) => mention.handle)), → ...mentions.map((mention) => mention.handle),
it("CM24: Without a lead, a message to the crew opens one task for each crewmate it mentions, a repeated mention once, and a message with no mention is refused", () => {
  const tell = (text: string, ...handles: string[]) =>
    routeCrewMessage({ place: "tell", roster: withoutLead, text, mentions: mentions(...handles) });
  const taskHandles = (text: string, ...handles: string[]) => {
    const route = tell(text, ...handles);
    return route.kind === "tasks" ? route.tasks.map((task) => task.handle) : route;
  };
  expect(taskHandles("Add pagination for @backend\nUse cursors.", "backend")).toEqual(["backend"]);
  expect(taskHandles(owner, "backend", "frontend", "erik")).toEqual([
    "backend",
    "frontend",
    "erik",
  ]);
  expect(taskHandles("@backend first. Then @backend again", "backend", "backend")).toEqual([
    "backend",
  ]);
  expect(tell("Do the thing")).toEqual({ kind: "refused", reason: "no-mention" });
});

// witness: apps/server/src/zerops/crew/crewRouting.ts | if (unknown.length > 0) → if (unknown.length > 1)
it("CM25: A message that mentions somebody not on the crew is refused, naming them, and opens no task", () => {
  expect(
    routeCrewMessage({
      place: "tell",
      roster: withoutLead,
      text: "@bob do it",
      mentions: mentions("bob"),
    }),
  ).toEqual({ kind: "refused", reason: "unknown-mention", handles: ["bob"] });
});
