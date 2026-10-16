import type { ServerProvider } from "@t3tools/contracts";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";
import { describe, expect, it } from "vite-plus/test";

import {
  crewRewriteBlockers,
  crewDevHosts,
  crewServiceHint,
  crewWriterWithoutHost,
  crewEffortOptions,
  crewJobFootLine,
  crewLoginLabel,
  crewLoginNote,
  crewLoginOptions,
  crewModelOptions,
  crewRunsOn,
  crewWaitingMembers,
  crewmateSaveCommand,
  freeTints,
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
  displayName: "Claude",
  threadProfile: { tools: true, reportsSpend: true },
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
  displayName: "Codex",
  threadProfile: { tools: false, reportsSpend: false },
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
  displayName: "Cursor",
});
const grok = provider({
  instanceId: "grok" as ServerProvider["instanceId"],
  driver: "grok" as ServerProvider["driver"],
  displayName: "Grok",
  threadProfile: { tools: true, reportsSpend: true },
});
const claudeWork = provider({
  instanceId: "claudeAgent_work" as ServerProvider["instanceId"],
  driver: "claudeAgent" as ServerProvider["driver"],
  displayName: "Claude Code · work",
  threadProfile: { tools: true, reportsSpend: true },
});
const uninstalledGrok = {
  ...grok,
  instanceId: "grok_off" as ServerProvider["instanceId"],
  installed: false,
};
const disabledClaude = {
  ...claudeWork,
  instanceId: "claudeAgent_off" as ServerProvider["instanceId"],
  enabled: false,
};

describe("Runs on", () => {
  const catalog = [cursor, codex, claude, claudeWork, grok, uninstalledGrok, disabledClaude];

  it("offers every installed, enabled login whose agent carries the crew's rules", () => {
    expect(crewLoginOptions(catalog, false)).toEqual([
      { id: "codex", label: "Codex", agent: "codex", tools: false },
      { id: "claudeAgent", label: "Claude", agent: "claude-code", tools: true },
      { id: "claudeAgent_work", label: "Claude Code · work", agent: "claude-code", tools: true },
      { id: "grok", label: "Grok", tools: true },
    ]);
  });

  it("offers no login whose agent names no crew capability, whatever it is called", () => {
    const unnamed = [cursor, codex, claude].map(
      ({ threadProfile: _profile, ...provider }) => provider,
    );
    expect(crewLoginOptions(unnamed, false)).toEqual([]);
  });

  it("offers the lead only the logins whose agent hosts the crew tools", () => {
    expect(crewLoginOptions(catalog, true).map((login) => login.id)).toEqual([
      "claudeAgent",
      "claudeAgent_work",
      "grok",
    ]);
  });

  it.each<{
    readonly name: string;
    readonly model: string | null;
    readonly effort: string | null;
    readonly runsOn: ReturnType<typeof crewRunsOn>;
  }>([
    {
      name: "names a crewmate's login, model and effort as the catalog does",
      model: "claude-opus-5-5",
      effort: "high",
      runsOn: { login: "Claude", model: "Opus 5.5", effort: "High" },
    },
    {
      name: "leaves out what runs on the login's defaults",
      model: null,
      effort: null,
      runsOn: { login: "Claude", model: null, effort: null },
    },
    {
      name: "keeps a model or effort the catalog does not list as written",
      model: "claude-next",
      effort: "max",
      runsOn: { login: "Claude", model: "claude-next", effort: "max" },
    },
  ])("$name", ({ model, effort, runsOn }) => {
    expect(
      crewRunsOn(
        { login: { id: "claudeAgent", label: "Claude", agent: "claude-code" }, model, effort },
        [claude, codex],
      ),
    ).toEqual(runsOn);
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
    const cursorWithReasoning = provider({
      instanceId: "cursor" as ServerProvider["instanceId"],
      driver: "cursor" as ServerProvider["driver"],
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoning",
                label: "Reasoning",
                type: "select",
                options: [{ id: "high", label: "High" }],
              },
            ],
          },
        },
      ],
    });
    expect(crewEffortOptions([cursorWithReasoning], "cursor", "gpt-5.4")).toEqual([
      { id: "high", label: "High" },
    ]);
  });

  it.each([
    [
      "codex",
      "On Codex, a crewmate works on code only, with no Zerops tools. Its task is done when you land it.",
    ],
    ["claudeAgent", undefined],
    ["grok", undefined],
    ["gone", undefined],
  ] as const)("says what the %s login means for the crewmate", (loginId, note) => {
    expect(crewLoginNote(crewLoginOptions(catalog, false), loginId)).toBe(note);
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
    expect(crewServiceHint(devHosts, host, crewPort, "Fen")).toBe(hint);
  });

  it("says why there is nothing to pick before the Mate mounted a dev service", () => {
    expect(crewServiceHint([], "", null, "Fen")).toBe(
      "No dev service is mounted yet — ask Fen to start development first.",
    );
  });
});

describe("crewWriterWithoutHost", () => {
  it.each([
    { name: "a writer with a service", writes: true, host: "appdev", blocked: false },
    { name: "a writer without one", writes: true, host: "", blocked: true },
    { name: "a read-only crewmate needs none", writes: false, host: "", blocked: false },
  ])("$name", ({ writes, host, blocked }) => {
    expect(crewWriterWithoutHost(writes, host)).toBe(blocked);
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

describe("crewLoginLabel", () => {
  it.each([
    [
      "the catalog's name",
      [{ id: "claudeAgent-work", label: "Work", agent: "claude-code", tools: true }],
      "claudeAgent-work",
      "Work",
    ],
    ["the id, for a login the catalog doesn't offer", [], "someone-else", "someone-else"],
  ] as const)("%s", (_, logins, id, label) => {
    expect(crewLoginLabel(logins, id)).toBe(label);
  });
});

describe("crewmateSaveCommand", () => {
  it.each([
    {
      name: "the first crewmate added to an empty crew joins it",
      input: { handle: "pip", onRoster: false, crewApplied: true, loginChanged: false },
      command: { _tag: "apply" },
    },
    {
      name: "a standing crewmate's job reaches it at its next message",
      input: { handle: "pip", onRoster: true, crewApplied: true, loginChanged: false },
      command: { _tag: "jobSave", handle: "pip", apply: "nextTurn" },
    },
    {
      name: "a standing crewmate moved to another login starts fresh",
      input: { handle: "pip", onRoster: true, crewApplied: true, loginChanged: true },
      command: { _tag: "jobSave", handle: "pip", apply: "fresh" },
    },
    {
      name: "a crew still being set up waits for Start the crew",
      input: { handle: "pip", onRoster: false, crewApplied: false, loginChanged: false },
      command: null,
    },
  ])("$name", ({ input, command }) => {
    expect(crewmateSaveCommand(input)).toEqual(command);
  });
});

describe("crewWaitingMembers", () => {
  const definition = (...members: ReadonlyArray<CrewMemberSpec>): CrewDefinition => ({
    crew: "crew",
    name: "Crew",
    brief: parseBrief("Goal", "Build it."),
    members,
  });
  it.each([
    {
      name: "a crew file listing a crewmate the crew doesn't have shows it, to add or remove",
      file: definition(member({ handle: "pip" })),
      roster: [],
      waiting: ["pip"],
    },
    {
      name: "every crewmate the file lists is in the crew",
      file: definition(member({ handle: "pip" })),
      roster: [{ handle: "pip" }],
      waiting: [],
    },
    { name: "the file not read yet", file: null, roster: [], waiting: [] },
  ])("$name", ({ file, roster, waiting }) => {
    expect(crewWaitingMembers(file, roster).map((each) => each.handle)).toEqual(waiting);
  });
});

// Run 2: a draft crewmate's editor said "It picks up its new job with its next message, in a fresh
// conversation. Its work stays." of a crewmate that had never run.
describe("what a crewmate's Save does, under its job", () => {
  it.each([
    {
      name: "a crewmate of a crew not started yet starts with it",
      input: { applied: false, crewApplied: false, loginChanged: false },
      line: "It starts with this job when you start the crew.",
    },
    {
      name: "a draft crewmate's changed login changes nothing live",
      input: { applied: false, crewApplied: false, loginChanged: true },
      line: "It starts with this job when you start the crew.",
    },
    {
      name: "a crewmate added to a running crew joins it now",
      input: { applied: false, crewApplied: true, loginChanged: false },
      line: "It joins the crew now, with this job.",
    },
    {
      name: "a running crewmate picks it up with its next message",
      input: { applied: true, crewApplied: true, loginChanged: false },
      line: "It picks up its new job with its next message, in a fresh conversation. Its work stays.",
    },
    {
      name: "a running crewmate on another login starts afresh now",
      input: { applied: true, crewApplied: true, loginChanged: true },
      line: "It starts a fresh conversation now.",
    },
  ])("$name", ({ input, line }) => {
    expect(crewJobFootLine(input)).toBe(line);
  });
});
