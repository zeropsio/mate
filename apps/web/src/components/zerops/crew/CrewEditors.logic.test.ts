import type { ServerProvider } from "@t3tools/contracts";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";
import { describe, expect, it } from "vite-plus/test";

import {
  crewRewriteBlockers,
  crewDevHosts,
  crewServiceHint,
  crewWriterWithoutHost,
  crewEffortOptions,
  crewLoginLabel,
  crewLoginNote,
  crewLoginOptions,
  crewModelOptions,
  crewRunsOn,
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
      runsOn: { login: "Claude Code", model: "Opus 5.5", effort: "High" },
    },
    {
      name: "leaves out what runs on the login's defaults",
      model: null,
      effort: null,
      runsOn: { login: "Claude Code", model: null, effort: null },
    },
    {
      name: "keeps a model or effort the catalog does not list as written",
      model: "claude-next",
      effort: "max",
      runsOn: { login: "Claude Code", model: "claude-next", effort: "max" },
    },
  ])("$name", ({ model, effort, runsOn }) => {
    expect(
      crewRunsOn(
        { login: { id: "claudeAgent", label: "Claude Code", agent: "claude-code" }, model, effort },
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
      [{ id: "claudeAgent-work", label: "Work", agent: "claude-code" }],
      "claudeAgent-work",
      "Work",
    ],
    ["a default's own, before the catalog is read", [], "claudeAgent", "Claude Code"],
    ["the id, for a login nobody names", [], "someone-else", "someone-else"],
  ] as const)("%s", (_, logins, id, label) => {
    expect(crewLoginLabel(logins, id)).toBe(label);
  });
});
