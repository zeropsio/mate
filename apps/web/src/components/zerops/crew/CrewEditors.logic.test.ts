import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { Crewmate, CrewLaneSummary, ServerProvider } from "@t3tools/contracts";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";
import { describe, expect, it } from "vite-plus/test";

import {
  CREW_SAVE_CHOICES,
  crewApplyProgress,
  crewRewriteBlockers,
  crewDevHosts,
  crewServiceHint,
  crewEffortOptions,
  crewLoginNote,
  crewLoginOptions,
  crewModelOptions,
  freeTints,
  jobChangedMostly,
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
    expect(crewLoginOptions([cursor, codex, claude], false)).toEqual([
      { id: "claudeAgent", label: "Claude Code", agent: "claude-code" },
      { id: "codex", label: "Codex", agent: "codex" },
    ]);
  });

  it("offers the lead no Codex login: it needs the crew tools, which only Claude hosts", () => {
    expect(crewLoginOptions([cursor, codex, claude], true)).toEqual([
      { id: "claudeAgent", label: "Claude Code", agent: "claude-code" },
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

  it.each([
    [
      "codex",
      "A Codex crewmate works on code only, with no Zerops tools. Its task is done when you land it.",
    ],
    ["claudeAgent", undefined],
    ["gone", undefined],
  ] as const)("says what the %s login means for the crewmate", (loginId, note) => {
    expect(crewLoginNote(crewLoginOptions([claude, codex], false), loginId)).toBe(note);
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
  it("offers the dev services the engine names, and every host the crew already names", () => {
    expect(
      crewDevHosts({
        devHosts: [
          { host: "appdev", database: true },
          { host: "webdev", database: null },
        ],
        hosts: [{ host: "apidev" }, { host: "appdev" }],
      }),
    ).toEqual([
      { host: "appdev", database: true },
      { host: "webdev", database: null },
      { host: "apidev", database: null },
    ]);
  });
});

describe("crewServiceHint", () => {
  const devHosts = [
    { host: "appdev", database: true },
    { host: "webdev", database: false },
    { host: "apidev", database: null },
  ] as const;

  it.each<{
    readonly name: string;
    readonly host: string;
    readonly crewPort: number | null;
    readonly hint: string | undefined;
  }>([
    {
      name: "a service with a database",
      host: "appdev",
      crewPort: 3001,
      hint: "Crew port 3001 · Has a database",
    },
    { name: "a service without one", host: "webdev", crewPort: null, hint: "No database" },
    {
      name: "a service not read yet is unknown, never no",
      host: "apidev",
      crewPort: null,
      hint: "Database unknown",
    },
    {
      name: "a host the engine does not name is unknown too",
      host: "olddev",
      crewPort: null,
      hint: "Database unknown",
    },
    { name: "no service picked yet", host: "", crewPort: null, hint: undefined },
  ])("says $name", ({ host, crewPort, hint }) => {
    expect(crewServiceHint(devHosts, host, crewPort)).toBe(hint);
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
