import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { Crewmate, CrewLaneSummary, ServerProvider } from "@t3tools/contracts";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";
import { describe, expect, it } from "vite-plus/test";

import {
  CREW_SAVE_CHOICES,
  crewApplyProgress,
  crewRewriteBlockers,
  crewDevHosts,
  crewEffortOptions,
  crewLoginOptions,
  crewModelOptions,
  freeTints,
  jobChangedMostly,
  withBrief,
  withMember,
} from "./CrewEditors.logic";

const member = (
  fields: Partial<CrewMemberSpec> & Pick<CrewMemberSpec, "handle">,
): CrewMemberSpec => ({
  displayName: fields.handle,
  kind: "writer",
  readOnly: false,
  restartAfterMerge: false,
  afterLandRestart: false,
  env: {},
  migrations: [],
  job: "Builds things.\n",
  ...fields,
});

const definition: CrewDefinition = {
  crew: "crew",
  name: "Game team",
  brief: parseBrief("Space shooter", "Build it.\n"),
  members: [
    member({ handle: "backend", tint: "sky", host: "appdev" }),
    member({ handle: "erik", tint: "amber" }),
  ],
};

describe("jobChangedMostly", () => {
  it.each([
    { name: "unchanged", before: "a\nb\nc\nd", after: "a\nb\nc\nd", mostly: false },
    { name: "one line of four", before: "a\nb\nc\nd", after: "a\nb\nc\nX", mostly: false },
    { name: "half", before: "a\nb\nc\nd", after: "a\nb\nX\nY", mostly: false },
    { name: "three of four", before: "a\nb\nc\nd", after: "a\nX\nY\nZ", mostly: true },
    { name: "a new job", before: "", after: "Writes the plan.", mostly: false },
  ])("$name", ({ before, after, mostly }) => {
    expect(jobChangedMostly(before, after)).toBe(mostly);
  });
});

describe("withMember and withBrief", () => {
  it("replaces a crewmate by handle, keeping the others in order", () => {
    const next = withMember(
      definition,
      "backend",
      member({ handle: "backend", displayName: "API" }),
    );
    expect(next.members.map((mate) => [mate.handle, mate.displayName])).toEqual([
      ["backend", "API"],
      ["erik", "erik"],
    ]);
  });

  it("adds a crewmate at the end", () => {
    const next = withMember(definition, null, member({ handle: "qa" }));
    expect(next.members.map((mate) => mate.handle)).toEqual(["backend", "erik", "qa"]);
  });

  it("sets the brief's title and text, reading its sections again", () => {
    const next = withBrief(definition, "Shop", "Sell things.\n\n## Done when\n- a guest pays\n");
    expect(next.brief).toEqual({
      title: "Shop",
      text: "Sell things.\n\n## Done when\n- a guest pays\n",
      doneWhen: ["a guest pays"],
    });
  });
});

describe("freeTints", () => {
  it("offers the tints nobody else wears, never the Mate's own, keeping the crewmate's", () => {
    expect(freeTints(definition, "backend", "coral")).toEqual([
      "olive",
      "sky",
      "violet",
      "rose",
      "sand",
      "slate",
    ]);
    expect(freeTints(definition, null, "coral")).toEqual([
      "olive",
      "violet",
      "rose",
      "sand",
      "slate",
    ]);
  });
});

const provider = (
  fields: Partial<ServerProvider> & Pick<ServerProvider, "instanceId" | "driver">,
): ServerProvider =>
  ({
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-27T09:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...fields,
  }) as ServerProvider;

const claude = provider({
  instanceId: "claudeAgent" as ServerProvider["instanceId"],
  driver: "claudeAgent" as ServerProvider["driver"],
  displayName: "Claude Code",
  models: [
    {
      slug: "claude-opus-5-5",
      name: "Opus 5.5",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: [
              { id: "low", label: "Low" },
              { id: "high", label: "High", isDefault: true },
            ],
          },
        ],
      },
    },
    { slug: "claude-haiku", name: "Haiku", isCustom: false, capabilities: null },
  ],
});
const codex = provider({
  instanceId: "codex" as ServerProvider["instanceId"],
  driver: "codex" as ServerProvider["driver"],
  models: [
    {
      slug: "gpt-5",
      name: "GPT-5",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [{ id: "medium", label: "Medium" }],
          },
        ],
      },
    },
  ],
});
const cursor = provider({
  instanceId: "cursor" as ServerProvider["instanceId"],
  driver: "cursor" as ServerProvider["driver"],
});

describe("Runs on", () => {
  it("offers the two default logins this Mate has", () => {
    expect(crewLoginOptions([cursor, codex, claude])).toEqual([
      { id: "claudeAgent", label: "Claude Code", agent: "claude-code" },
      { id: "codex", label: "Codex", agent: "codex" },
    ]);
  });

  it("offers a login's models and a model's effort levels", () => {
    expect(crewModelOptions([claude, codex], "claudeAgent")).toEqual([
      { slug: "claude-opus-5-5", name: "Opus 5.5" },
      { slug: "claude-haiku", name: "Haiku" },
    ]);
    expect(crewEffortOptions([claude, codex], "claudeAgent", "claude-opus-5-5")).toEqual([
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ]);
    expect(crewEffortOptions([claude, codex], "codex", "gpt-5")).toEqual([
      { id: "medium", label: "Medium" },
    ]);
    expect(crewEffortOptions([claude, codex], "claudeAgent", "claude-haiku")).toEqual([]);
    expect(crewEffortOptions([claude, codex], "claudeAgent", null)).toEqual([]);
  });
});

describe("CREW_SAVE_CHOICES", () => {
  it("reads the next-turn save as a fresh conversation (probe 22 failed)", () => {
    expect(CREW_SAVE_CHOICES.map((choice) => [choice.apply, choice.label])).toEqual([
      ["nextTurn", "Save — the next turn starts a fresh conversation"],
      ["now", "Save and apply now"],
      ["fresh", "Save and start fresh"],
    ]);
  });
});

describe("crewDevHosts", () => {
  it("offers the dev halves of the runtimes, and every host the crew already names", () => {
    const services = [
      { hostname: "appdev", group: "runtimes" as const },
      { hostname: "appstage", group: "runtimes" as const },
      { hostname: "db", group: "data" as const },
      { hostname: "zcp", group: "infrastructure" as const },
    ];
    expect(crewDevHosts(services, ["apidev", "appdev"])).toEqual(["appdev", "apidev"]);
    expect(crewDevHosts(undefined, ["apidev"])).toEqual(["apidev"]);
  });
});

describe("crewApplyProgress", () => {
  const { crewmates } = crewSnapshotFixture();
  const withLane = (handle: string, lane: Partial<CrewLaneSummary>): Crewmate => {
    const mate = crewmates.find((candidate) => candidate.handle === handle)!;
    return { ...mate, lane: { ...mate.lane!, ...lane } };
  };

  it("reads each crewmate's copy as a step of Apply", () => {
    expect(
      crewApplyProgress([
        crewmates[0]!,
        withLane("backend", { state: "creating" }),
        withLane("frontend", { state: "setting-up", detail: "npm ci" }),
        withLane("erik", { state: "failed", detail: "No free disk on appdev" }),
      ]),
    ).toEqual([
      { id: "lead", label: "Lead", state: "done", stateLabel: "Ready" },
      {
        id: "backend",
        label: "Backend",
        state: "running",
        stateLabel: "Creating Backend's copy of the code",
      },
      { id: "frontend", label: "Frontend", state: "running", stateLabel: "Running npm ci" },
      { id: "erik", label: "Erik", state: "failed", stateLabel: "No free disk on appdev" },
    ]);
  });
});

describe("crewRewriteBlockers", () => {
  it("keeps an editor from rewriting crew.yaml over what it could not read", () => {
    const issue = (code: "field-unknown" | "field-type" | "host-missing") => ({
      code,
      path: "crew.yaml",
      message: code,
    });
    expect(
      crewRewriteBlockers([issue("host-missing"), issue("field-unknown"), issue("field-type")]).map(
        (blocker) => blocker.code,
      ),
    ).toEqual(["field-unknown", "field-type"]);
  });
});
