import { describe, expect, it } from "@effect/vitest";

import {
  parseCrewHome,
  renderCrewHome,
  validateCrewTopology,
  type CrewDefinition,
  type CrewHomeFile,
} from "./CrewDefinition.ts";

const CREW_YAML = `name: Game team
briefTitle: Space shooter MVP
members:
  - handle: lead
    displayName: Lead
    kind: lead
    tint: violet
  - handle: backend
    displayName: Backend
    tint: sky
    host: appdev
    setup: npm ci
    check: npm test
    run: npm run dev -- --host 0.0.0.0 --port $CREW_PORT
    restartAfterMerge: true
    afterLandRestart: true
    login: claudeAgent
    model: claude-opus-5-5
    effort: high
    env:
      DATABASE_URL: postgres://db/backend
    migrations:
      - migrations/**
    context: 300000
    rotateAfter: 2
  - handle: erik
    displayName: Erik
    readOnly: true
`;

const BRIEF_MD = `Build a small space shooter that runs in the browser.

## Binding decisions
- TypeScript, no framework.

## Done when
- The ship moves with the arrow keys.
- \`npm test\` passes.
`;

const home = (overrides: Record<string, string | undefined> = {}): ReadonlyArray<CrewHomeFile> =>
  Object.entries({
    "crew.yaml": CREW_YAML,
    "brief.md": BRIEF_MD,
    "jobs/lead.md": "Plan the work and review it.\n",
    "jobs/backend.md": "Own the game loop and the server.\n",
    "jobs/erik.md": "Write the business plan.\n",
    ...overrides,
  }).flatMap(([path, content]) => (content === undefined ? [] : [{ path, content }]));

describe("parseCrewHome", () => {
  it("reads a complete crew home into one definition", () => {
    const result = parseCrewHome("game", home());

    expect(result.issues).toEqual([]);
    expect(result.definition).toEqual({
      crew: "game",
      name: "Game team",
      brief: {
        title: "Space shooter MVP",
        text: BRIEF_MD,
        bindingDecisions: "- TypeScript, no framework.",
        doneWhen: ["The ship moves with the arrow keys.", "`npm test` passes."],
      },
      members: [
        {
          handle: "lead",
          displayName: "Lead",
          kind: "lead",
          readOnly: true,
          tint: "violet",
          restartAfterMerge: false,
          afterLandRestart: false,
          env: {},
          migrations: [],
          job: "Plan the work and review it.\n",
        },
        {
          handle: "backend",
          displayName: "Backend",
          kind: "writer",
          readOnly: false,
          tint: "sky",
          host: "appdev",
          setup: "npm ci",
          check: "npm test",
          run: "npm run dev -- --host 0.0.0.0 --port $CREW_PORT",
          restartAfterMerge: true,
          afterLandRestart: true,
          login: "claudeAgent",
          model: "claude-opus-5-5",
          effort: "high",
          env: { DATABASE_URL: "postgres://db/backend" },
          migrations: ["migrations/**"],
          context: 300000,
          rotateAfter: 2,
          job: "Own the game loop and the server.\n",
        },
        {
          handle: "erik",
          displayName: "Erik",
          kind: "reader",
          readOnly: true,
          restartAfterMerge: false,
          afterLandRestart: false,
          env: {},
          migrations: [],
          job: "Write the business plan.\n",
        },
      ],
    });
  });

  const yaml = (members: string): string => `name: Team\nbriefTitle: Title\nmembers:\n${members}`;
  const writer = (handle: string, extra = ""): string =>
    `  - handle: ${handle}\n    displayName: ${handle}\n    host: appdev\n${extra}`;

  it.each([
    {
      name: "a handle outside the pattern",
      files: { "crew.yaml": yaml(writer("Back_End")), "jobs/Back_End.md": "x" },
      issue: { code: "handle-pattern", handle: "Back_End" },
    },
    {
      name: "two crewmates on one handle",
      files: { "crew.yaml": yaml(writer("backend") + writer("backend")), "jobs/backend.md": "x" },
      issue: { code: "handle-duplicate", handle: "backend" },
    },
    {
      name: "a second lead",
      files: {
        "crew.yaml": yaml(
          "  - handle: a\n    displayName: A\n    kind: lead\n" +
            "  - handle: b\n    displayName: B\n    kind: lead\n",
        ),
        "jobs/a.md": "x",
        "jobs/b.md": "x",
      },
      issue: { code: "lead-multiple" },
    },
    {
      name: "a lead with a host",
      files: {
        "crew.yaml": yaml(
          "  - handle: lead\n    displayName: Lead\n    kind: lead\n    host: appdev\n",
        ),
        "jobs/lead.md": "x",
      },
      issue: { code: "host-on-read-only", handle: "lead" },
    },
    {
      name: "a reader with a host",
      files: {
        "crew.yaml": yaml(
          "  - handle: qa\n    displayName: QA\n    readOnly: true\n    host: appdev\n",
        ),
        "jobs/qa.md": "x",
      },
      issue: { code: "host-on-read-only", handle: "qa" },
    },
    {
      name: "a writer without a host",
      files: { "crew.yaml": yaml("  - handle: be\n    displayName: BE\n"), "jobs/be.md": "x" },
      issue: { code: "host-missing", handle: "be" },
    },
    {
      name: "a writer that says it is read-only",
      files: {
        "crew.yaml": yaml(writer("be", "    kind: writer\n    readOnly: true\n")),
        "jobs/be.md": "x",
      },
      issue: { code: "kind-conflict", handle: "be" },
    },
    {
      name: "a brief over 16,000 characters",
      files: { "brief.md": "x".repeat(16_001) },
      issue: { code: "brief-too-long" },
    },
    {
      name: "a crewmate without a job file",
      files: { "jobs/backend.md": undefined },
      issue: { code: "file-missing", handle: "backend" },
    },
    {
      name: "a misspelled field",
      files: { "crew.yaml": yaml(writer("be", "    setUp: npm ci\n")), "jobs/be.md": "x" },
      issue: { code: "field-unknown", handle: "be" },
    },
    {
      name: "a tint that is not a Mate tint",
      files: { "crew.yaml": yaml(writer("be", "    tint: teal\n")), "jobs/be.md": "x" },
      issue: { code: "field-type", handle: "be" },
    },
    {
      name: "an env name a shell cannot carry",
      files: { "crew.yaml": yaml(writer("be", "    env:\n      'A B': x\n")), "jobs/be.md": "x" },
      issue: { code: "field-type", handle: "be" },
    },
    {
      name: "both env and a shared database",
      files: {
        "crew.yaml": yaml(writer("be", "    database: shared\n    env:\n      DB: x\n")),
        "jobs/be.md": "x",
      },
      issue: { code: "database-and-env", handle: "be" },
    },
    {
      name: "a context window out of range",
      files: { "crew.yaml": yaml(writer("be", "    context: 50000\n")), "jobs/be.md": "x" },
      issue: { code: "context-range", handle: "be" },
    },
    {
      name: "crew.yaml that is not YAML",
      files: { "crew.yaml": "name: [unclosed" },
      issue: { code: "yaml" },
    },
  ])("names the issue for $name", ({ files, issue }) => {
    const result = parseCrewHome("game", home(files));
    expect(result.issues).toContainEqual(expect.objectContaining(issue));
  });

  it("refuses a crew id that cannot name a ref", () => {
    expect(parseCrewHome("Game Team", home()).issues).toContainEqual(
      expect.objectContaining({ code: "crew-id" }),
    );
  });
});

describe("renderCrewHome", () => {
  it("writes files that parse back into the same definition", () => {
    const { definition } = parseCrewHome("game", home());
    if (!definition) throw new Error("fixture must parse");

    const files = renderCrewHome(definition);

    expect(files.map((file) => file.path)).toEqual([
      "crew.yaml",
      "brief.md",
      "jobs/lead.md",
      "jobs/backend.md",
      "jobs/erik.md",
    ]);
    expect(parseCrewHome("game", files)).toEqual({ definition, issues: [] });
  });
});

describe("validateCrewTopology", () => {
  const definitionWith = (backendExtra: string): CrewDefinition => {
    const yamlText = CREW_YAML.replace(
      /    env:\n      DATABASE_URL: postgres:\/\/db\/backend\n/u,
      backendExtra,
    );
    const { definition } = parseCrewHome("game", home({ "crew.yaml": yamlText }));
    if (!definition) throw new Error("fixture must parse");
    return definition;
  };

  it.each([
    {
      name: "a writer on a dev service with its own env",
      extra: "    env:\n      DATABASE_URL: x\n",
      topology: { devHosts: ["appdev"], databaseHosts: ["appdev"] },
      codes: [],
    },
    {
      name: "a writer that shares the database",
      extra: "    database: shared\n",
      topology: { devHosts: ["appdev"], databaseHosts: ["appdev"] },
      codes: [],
    },
    {
      name: "a writer on a service without a database, declaring nothing",
      extra: "",
      topology: { devHosts: ["appdev"], databaseHosts: [] },
      codes: [],
    },
    {
      name: "a writer on a service with a database, declaring nothing",
      extra: "",
      topology: { devHosts: ["appdev"], databaseHosts: ["appdev"] },
      codes: ["database-undeclared"],
    },
    {
      name: "a writer on a host that is not a dev service",
      extra: "    database: shared\n",
      topology: { devHosts: ["apidev"], databaseHosts: [] },
      codes: ["host-unknown"],
    },
  ])("$name", ({ extra, topology, codes }) => {
    const issues = validateCrewTopology(definitionWith(extra), topology);
    expect(issues.map((issue) => [issue.code, issue.handle])).toEqual(
      codes.map((code) => [code, "backend"]),
    );
  });
});
