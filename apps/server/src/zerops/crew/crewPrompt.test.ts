import { describe, expect, it } from "@effect/vitest";
import { parseBrief } from "@t3tools/shared/crewHome";

import { crewLane } from "./CrewDefinition.ts";
import { crewSessionContext, type CrewPromptInput } from "./crewPrompt.ts";

const brief = parseBrief(
  "Space shooter MVP",
  "Build a browser space shooter.\n\n## Binding decisions\n- TypeScript, no framework.\n",
);
const lane = crewLane(
  { host: "appdev", mountPath: "/var/www/appdev", remotePath: "/var/www" },
  "backend",
);

const writer: CrewPromptInput = {
  member: { handle: "backend", kind: "writer", lane },
  brief,
  briefVersion: 4,
  job: "Own the game loop and the server.\n",
  jobVersion: 2,
  memory: false,
};

const sectionOrder = (text: string): ReadonlyArray<string> =>
  text.split("\n").filter((line) => line.startsWith("# "));

describe("crewSessionContext", () => {
  it("is the crew rules, then the brief at its version, then the job at its version", () => {
    const text = crewSessionContext(writer);

    expect(sectionOrder(text)).toEqual([
      "# Crew rules",
      "# Brief v4: Space shooter MVP",
      "# Your job v2",
    ]);
    expect(text).toContain("Build a browser space shooter.");
    expect(text).toContain("- TypeScript, no framework.");
    expect(text.trimEnd().endsWith("Own the game loop and the server.")).toBe(true);
  });

  it("maps the project guidance's paths to the writer's copy", () => {
    const text = crewSessionContext(writer);

    expect(text).toContain("You are @backend");
    expect(text).toContain("/var/www/appdev/.crew/backend/");
    expect(text).toContain("crew/backend");
    expect(text).toContain('ssh appdev "<command>"');
    expect(text).toContain("cd /var/www");
  });

  it.each([
    { kind: "reader" as const, says: "read-only crewmate" },
    { kind: "lead" as const, says: "the crew's lead" },
  ])("gives a $kind no copy and no path mapping", ({ kind, says }) => {
    const text = crewSessionContext({ ...writer, member: { handle: "erik", kind } });

    expect(text).toContain(says);
    expect(text).toContain("never change files");
    expect(text).not.toContain(".crew/");
    expect(text).not.toContain("ssh ");
  });

  const NO_CREW_TOOLS =
    "- You have no crew tools: your task is done when the person lands your work; say in your answer when it is ready.";
  const READER_NO_CREW_TOOLS =
    "- You have no crew tools: answer in this conversation; the person reads it.";

  it.each([
    {
      name: "a writer",
      input: writer,
      keeps: "- Your task arrives as a card in this conversation.",
      ending: NO_CREW_TOOLS,
    },
    {
      name: "a reader",
      input: { ...writer, member: { handle: "erik", kind: "reader" as const } },
      keeps: "- You read files and the crew's changes.",
      ending: READER_NO_CREW_TOOLS,
    },
    {
      name: "a writer with memory",
      input: { ...writer, memory: true },
      keeps: "The brief outranks your memory",
      ending: NO_CREW_TOOLS,
    },
  ])("names no crew tool to $name whose agent hosts none", ({ input, keeps, ending }) => {
    const text = crewSessionContext({ ...input, crewTools: false });

    expect(text).not.toMatch(/crew_[a-z]/u);
    expect(text).toContain(keeps);
    expect(text).toContain(ending);
    expect(text.split("You have no crew tools")).toHaveLength(2);
  });

  it.each([
    { name: "by default", crewTools: undefined },
    { name: "with crew tools", crewTools: true },
  ])("sends the task's outcome through crew_report $name", ({ crewTools }) => {
    const text = crewSessionContext({
      ...writer,
      ...(crewTools === undefined ? {} : { crewTools }),
    });

    expect(text).toContain("say so with crew_report");
    expect(text).not.toContain(NO_CREW_TOOLS);
  });

  it("speaks of memory only when the crew has it (phase C)", () => {
    expect(crewSessionContext(writer)).not.toContain("crew_memory");
    const withMemory = crewSessionContext({ ...writer, memory: true });
    expect(withMemory).toContain("crew_memory");
    expect(withMemory).toContain("The brief outranks your memory");
  });
});
