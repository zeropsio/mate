// @effect-diagnostics nodeBuiltinImport:off -- exercises the public gate selector.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { parse } from "yaml";
import { blameSelection } from "./ci-blame.ts";
import { expect, it } from "vite-plus/test";
import {
  SCENARIO_PROJECT_FILES,
  chatGateStages,
  chatGateTestFiles,
  selectLaneChatStages,
  selectsChatGate,
  type ChatGateCommand,
} from "./chat-gate.ts";

it.each([
  "apps/server/src/provider/Layers/ClaudeAdapter.ts",
  "apps/server/src/spi/fixtures/claude/plain-text-turn.expected.json",
  "apps/server/src/orchestration/decider.ts",
  "apps/server/src/wsServer.ts",
  "packages/contracts/src/provider.ts",
  "packages/effect-acp/src/Client.ts",
  "packages/effect-codex-app-server/src/Client.ts",
  "packages/client-runtime/src/store.ts",
  "apps/web/src/components/chat/Composer.tsx",
  "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts",
  "apps/web/test/scenarios/harness/build.ts",
  "scripts/chat-gate.ts",
  "scripts/gate-changed.ts",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
])("%s requires the complete chat contract gate", (path) => {
  expect(selectsChatGate([path])).toBe(true);
});

it.each([
  "docs/user/chat.md",
  "apps/mobile/src/chat.tsx",
  "apps/server/scripts/migrate-dev-db.ts",
  "apps/web/test/scenarios/areas/d-change/dsl.ts",
  "apps/web/test/scenarios/fakes/d-change/review.test.ts",
  "apps/web/src/lib/terminalFocus.test.ts",
])("%s alone does not require the chat contract gate", (path) => {
  expect(selectsChatGate([path])).toBe(false);
});

it("the gate runs every Mate journey on the engine's wire", () => {
  const projects = chatGateStages.flatMap((stage) =>
    stage.commands.flatMap((command) => {
      const at = command.args.indexOf("--project");
      const areas = command.args.find((arg) => arg.startsWith("test/scenarios/areas"));
      return at === -1 || areas === undefined ? [] : [[stage.name, command.args[at + 1], areas]];
    }),
  );
  expect(projects).toEqual([
    ["B: client wire journeys (C)", "scenarios", "test/scenarios/areas/c-mate"],
  ]);
});

it("the gate proves the Mate engine on the proof harness's fixed seeds and the running engine", () => {
  const stage = chatGateStages.find((candidate) => candidate.name === "E: engine proof");
  const files = stage?.commands.flatMap((command) =>
    command.args.filter((arg) => arg.endsWith(".test.ts")),
  );
  expect(files).toEqual([
    "src/engine/domain/decide.model.test.ts",
    "src/engine/outbox/crash.test.ts",
    "src/engine/history/historyImport.test.ts",
    "src/zerops/crew/engine/importV1Crew.test.ts",
    "src/engine/engine.sim.test.ts",
    "src/engine/engine.pump.test.ts",
    "test/engine-oracle/runCard.oracle.test.ts",
  ]);
});

it("the gate runs the crew's journeys on the engine, every case certified", () => {
  const commands = chatGateStages.flatMap((stage) =>
    stage.commands.flatMap((command: ChatGateCommand) =>
      command.args.some((arg) => arg.startsWith("src/zerops/crew/CrewEngine"))
        ? [
            [
              stage.name,
              command.args.filter((arg) => arg.startsWith("src/")),
              command.args.includes("--reporter=../../scripts/chat-gate-reporter.ts"),
            ],
          ]
        : [],
    ),
  );
  expect(commands).toEqual([
    [
      "F: crew journeys on the engine",
      [
        ...["attachments", "endings", "lead", "memory", "midway", "operations", "runs"].map(
          (part) => `src/zerops/crew/CrewEngine.${part}.test.ts`,
        ),
        "src/zerops/crew/CrewEngine.test.ts",
        "src/zerops/crew/registerCrewRpc.test.ts",
      ],
      true,
    ],
  ]);
});

it("CI's Test job runs scenario-driver units after provisioning their browser", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const { jobs } = parse(workflow) as {
    jobs: { test_packages: { steps: { run?: string; if?: string }[] } };
  };
  const driver = jobs.test_packages.steps.find((step) =>
    step.run?.includes("--project scenario-drivers"),
  );
  expect(driver, "ASSERTION: scenario-driver units are covered by CI's Test job").toBeDefined();
  expect(driver?.run?.split("\n").filter(Boolean)).toEqual([
    "vp run test:browser",
    "vp -C apps/web test run --config test/scenarios/vitest.config.ts --project scenario-drivers --allowOnly=false",
  ]);
});

it("CI's stdin selector considers every changed path, including the old side of renames", () => {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/chat-gate.ts", "--select"],
    {
      cwd: new URL("../", import.meta.url),
      input: "docs/user/chat.md\napps/server/src/provider/ClaudeAdapter.ts\n",
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(NodeUtil.stripVTControlCharacters(result.stdout).trim()).toBe("true");
});

it.each([
  { declaration: "it", assertion: "expect(1).toBe(1)", passes: true },
  { declaration: "it.fails", assertion: "expect(1).toBe(2)", passes: false },
  { declaration: "it.skip", assertion: "expect(1).toBe(1)", passes: false },
  { declaration: "it.todo", assertion: "expect(1).toBe(1)", passes: false },
  { declaration: "it.only", assertion: "expect(1).toBe(1)", passes: false },
])(
  "the gate accepts $declaration only when it certifies passing behavior",
  ({ declaration, assertion, passes }) => {
    const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
    const cache = NodePath.join(root, "node_modules/.cache");
    NodeFS.mkdirSync(cache, { recursive: true });
    const fixture = NodeFS.mkdtempSync(NodePath.join(cache, "chat-gate-proof-"));
    try {
      NodeFS.writeFileSync(
        NodePath.join(fixture, "vitest.config.ts"),
        'export default { test: { include: ["proof.test.ts"] } };',
      );
      NodeFS.writeFileSync(
        NodePath.join(fixture, "proof.test.ts"),
        `import { it, expect } from "vite-plus/test"; ${declaration}("boundary behavior", () => { ${assertion}; });`,
      );
      const result = NodeChildProcess.spawnSync(
        NodePath.join(root, "node_modules/.bin/vp"),
        [
          "test",
          "run",
          "--config",
          "vitest.config.ts",
          "--allowOnly=false",
          "--reporter",
          NodePath.join(root, "scripts/chat-gate-reporter.ts"),
        ],
        { cwd: fixture, encoding: "utf8" },
      );
      expect(result.status === 0, result.stdout + result.stderr).toBe(passes);
    } finally {
      NodeFS.rmSync(fixture, { recursive: true, force: true });
    }
  },
);

it.each(["startup failure", "empty collection"])(
  "the strict gate preserves %s diagnostics and fails even when no tests are allowed",
  (kind) => {
    const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
    const cache = NodePath.join(root, "node_modules/.cache");
    NodeFS.mkdirSync(cache, { recursive: true });
    const fixture = NodeFS.mkdtempSync(NodePath.join(cache, "chat-gate-startup-"));
    const startupError = "The scenario bundle artifact is missing or does not match this checkout";
    try {
      NodeFS.writeFileSync(
        NodePath.join(fixture, "vitest.config.ts"),
        `export default { test: { passWithNoTests: true, include: ["${kind === "startup failure" ? "proof" : "missing"}.test.ts"], ${kind === "startup failure" ? 'globalSetup: ["./setup.ts"],' : ""} } };`,
      );
      NodeFS.writeFileSync(
        NodePath.join(fixture, "setup.ts"),
        `export default () => { throw new Error(${JSON.stringify(startupError)}); };`,
      );
      NodeFS.writeFileSync(
        NodePath.join(fixture, "proof.test.ts"),
        'import { it } from "vite-plus/test"; it("boundary behavior", () => {});',
      );
      const result = NodeChildProcess.spawnSync(
        NodePath.join(root, "node_modules/.bin/vp"),
        [
          "test",
          "run",
          "--config",
          "vitest.config.ts",
          "--allowOnly=false",
          "--reporter=default",
          "--reporter",
          NodePath.join(root, "scripts/chat-gate-reporter.ts"),
        ],
        { cwd: fixture, encoding: "utf8" },
      );
      const output = NodeUtil.stripVTControlCharacters(result.stdout + result.stderr);
      expect(result.error).toBeUndefined();
      expect(result.status, output).toBe(1);
      if (kind === "startup failure") {
        expect(output).toContain(`Error: ${startupError}`);
        expect(output).not.toContain("Error: Chat contract gate requires passing cases");
      }
    } finally {
      NodeFS.rmSync(fixture, { recursive: true, force: true });
    }
  },
);

it.each([
  { path: "apps/server/src/provider/Layers/ClaudeAdapter.ts", ids: ["A"] },
  { path: "apps/server/src/spi/replay/goldens.test.ts", ids: ["A"] },
  { path: "apps/server/src/engine/outbox/crash.ts", ids: ["E"] },
  { path: "packages/contracts/src/engine.ts", ids: ["C", "E", "types"] },
  { path: "packages/contracts/src/engineCall.ts", ids: ["C", "E", "types"] },
  { path: "packages/contracts/src/engineWire.ts", ids: ["C", "E", "types"] },
  { path: "apps/server/src/engine/wire/EngineWire.ts", ids: ["C", "E", "types"] },
  { path: "apps/server/src/wsServer.ts", ids: ["C", "types"] },
  { path: "apps/web/src/components/chat/runCard.logic.ts", ids: ["C", "types"] },
  { path: "apps/web/src/components/chat/MessagesTimeline.tsx", ids: ["C", "types"] },
  { path: "apps/web/src/zerops/useZeropsAgentSignInDialog.tsx", ids: ["C", "types"] },
  { path: "apps/web/src/components/zerops/ZeropsAgentSignIn.tsx", ids: ["C", "types"] },
  {
    path: "apps/web/src/components/zerops/ZeropsAgentSignIn.logic.ts",
    ids: ["C", "types"],
  },
  { path: "apps/web/package.json", ids: ["C", "types"] },
  { path: "apps/web/tsconfig.json", ids: ["C", "types"] },
  { path: "apps/web/test/scenarios/areas/d-change/dsl.ts", ids: [] },
  { path: "apps/server/src/engine/pump/toCore.test.ts", ids: [] },
  // The engine crew's own code runs its journeys on the engine too.
  { path: "apps/server/src/zerops/crew/engine/decide.ts", ids: ["C", "F", "types"] },
  { path: "packages/client-runtime/src/data/projections/mateHealth.test.ts", ids: [] },
  { path: "docs/user/chat.md", ids: [] },
  { path: "apps/mobile/src/chat.tsx", ids: [] },
  {
    path: "packages/client-runtime/src/zerops/timelineFollow.ts",
    ids: ["C", "types"],
  },
])("a lane selects the affected contract layers for $path", ({ path, ids }) => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  // Related files are the graph's input here; the CLI test verifies that derivation separately.
  const related = chatGateTestFiles(
    root,
    chatGateStages.filter((stage) => ids.includes(stage.id)),
  );
  expect(selectLaneChatStages([path], related, root).map((stage) => stage.id)).toEqual(ids);
});

it("the C stage owns every Mate journey, the engine's own among them", () => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  // The rule, not a list: a new journey joins the stage without editing this test.
  const area = "apps/web/test/scenarios/areas/c-mate";
  const journeys = NodeFS.readdirSync(NodePath.join(root, area))
    .filter((name) => name.endsWith(".scenario.ts"))
    .map((name) => `${area}/${name}`);
  expect(journeys.some((journey) => /\/engine-.+\.scenario\.ts$/u.test(journey))).toBe(true);
  expect(
    chatGateTestFiles(
      root,
      chatGateStages.filter((stage) => stage.id === "C"),
    ).toSorted(),
  ).toEqual(journeys.toSorted());
  expect(chatGateTestFiles(root, [])).toEqual([]);
});

it("the gate reads each scenario project's journeys as the scenario config runs them", async () => {
  // Read at run time: the config belongs to the web package, outside this project's typecheck.
  const config = (await import(
    NodeURL.pathToFileURL(
      NodePath.resolve(import.meta.dirname, "../apps/web/test/scenarios/vitest.config.ts"),
    ).href
  )) as {
    readonly default: {
      readonly test: {
        readonly projects: ReadonlyArray<{
          readonly test: {
            readonly name: string;
            readonly include?: ReadonlyArray<string>;
            readonly exclude?: ReadonlyArray<string>;
          };
        }>;
      };
    };
  };
  for (const [name, files] of Object.entries(SCENARIO_PROJECT_FILES)) {
    const project = config.default.test.projects.find((candidate) => candidate.test.name === name);
    expect(project?.test.include, name).toEqual(files.include);
    expect(project?.test.exclude ?? [], name).toEqual(files.exclude);
  }
});

// A lane that changed a journey must run it under a project that holds it, never one that
// excludes it: "no cases ran", and the lane's gate failed on a file it never ran.
it.each([
  { path: "apps/web/test/scenarios/areas/c-mate/engine-page.scenario.ts", ids: ["C", "types"] },
  { path: "apps/web/test/scenarios/areas/c-mate/engine-secret.scenario.ts", ids: ["C", "types"] },
  { path: "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts", ids: ["C", "types"] },
])("a changed scenario runs under the project that runs it: $path", ({ path, ids }) => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const stages = selectLaneChatStages([path], [path], root);
  expect(stages.map((stage) => stage.id)).toEqual(ids);
  const run = stages.find((stage) => stage.id !== "types")!.commands[0]!.args;
  expect(run[run.indexOf("--project") + 1]).toBe("scenarios");
  expect(run).toContain(NodePath.posix.relative("apps/web", path));
});

it.each([
  { args: ["--list", "--stages", "A"], labels: ["A: provider goldens"] },
  { args: ["--stages", "E", "--list"], labels: ["E: engine proof"] },
  { args: ["--list", "--stages", "C"], labels: ["B: client wire journeys (C)"] },
  {
    args: ["--list"],
    labels: [
      "A: provider goldens",
      "B: client wire journeys (C)",
      "E: engine proof",
      "F: crew journeys on the engine",
      "Typecheck: wire consumers",
    ],
  },
])(
  "the chat CLI carries the selected stages through its command list ($args)",
  ({ args, labels }) => {
    const result = NodeChildProcess.spawnSync(process.execPath, ["scripts/chat-gate.ts", ...args], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect([
      ...new Set(
        result.stdout
          .trim()
          .split("\n")
          .map((line) => line.split(": (")[0]),
      ),
    ]).toEqual(labels);
  },
);

it("the pinned test runner excludes a contract-owned file while running general units", () => {
  const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
  const fixture = NodeFS.mkdtempSync(NodePath.join(root, "node_modules/.cache/gate-exclude-"));
  try {
    NodeFS.writeFileSync(
      NodePath.join(fixture, "vitest.config.ts"),
      'export default { test: { include: ["*.test.ts"] } };',
    );
    NodeFS.writeFileSync(
      NodePath.join(fixture, "contract.test.ts"),
      'import { it, expect } from "vite-plus/test"; it("contract owner", () => expect(1).toBe(2));',
    );
    NodeFS.writeFileSync(
      NodePath.join(fixture, "unit.test.ts"),
      'import { it, expect } from "vite-plus/test"; it("general unit", () => expect(1).toBe(1));',
    );
    const result = NodeChildProcess.spawnSync(
      NodePath.join(root, "node_modules/.bin/vp"),
      ["test", "run", "--config", "vitest.config.ts", "--exclude", "contract.test.ts"],
      { cwd: fixture, encoding: "utf8" },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("1 passed");
    expect(result.stdout).not.toContain("contract.test.ts");
  } finally {
    NodeFS.rmSync(fixture, { recursive: true, force: true });
  }
});

it.each(["A", "E"])("a %s-only gate runs without installing a scenario browser", (stage) => {
  const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
  const fixture = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gate-browser-"));
  try {
    NodeFS.mkdirSync(NodePath.join(fixture, "scripts"));
    NodeFS.mkdirSync(NodePath.join(fixture, "apps/server"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(fixture, "apps/web"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(fixture, "node_modules/.bin"), { recursive: true });
    NodeFS.copyFileSync(
      NodePath.join(root, "scripts/chat-gate.ts"),
      NodePath.join(fixture, "scripts/chat-gate.ts"),
    );
    NodeFS.copyFileSync(
      NodePath.join(root, "scripts/gate-log.ts"),
      NodePath.join(fixture, "scripts/gate-log.ts"),
    );
    // This fixture owns only command routing; no browser installer exists in it.
    NodeFS.writeFileSync(NodePath.join(fixture, "node_modules/.bin/vp"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/chat-gate.ts", "--stages", stage],
      { cwd: fixture, encoding: "utf8" },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      stage === "A" ? "ok A: provider goldens" : "ok E: engine proof",
    );
  } finally {
    NodeFS.rmSync(fixture, { recursive: true, force: true });
  }
});

it("lane file selection keeps the affected C journey without expanding siblings", () => {
  const file = "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts";
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/chat-gate.ts", "--stages", "C", "--files", JSON.stringify([file]), "--list"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.split(file.slice("apps/web/".length))).toHaveLength(2);
  expect(result.stdout).not.toContain("admission.scenario.ts");
  expect(result.stdout).toContain("--project scenarios ");
  expect(result.stdout).toContain("reason: explicit related files");
});

it.each([
  ["--stages", "C", "--files", "[null]"],
  [
    "--stages",
    "E",
    "--files",
    JSON.stringify(["apps/web/test/scenarios/areas/c-mate/admission.scenario.ts"]),
  ],
  ["--stages", "A", "--files", JSON.stringify(["apps/server/src/spi/replay/missing.test.ts"])],
])("invalid lane file selection fails before running a command (%s)", (...args) => {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/chat-gate.ts", ...args, "--list"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
});

it("a contract-only edit retains wire consumer typechecks even without a selected journey", () => {
  const stages = selectLaneChatStages(["packages/contracts/src/engineWire.ts"], []);
  const commands = stages.find((stage) => stage.id === "types")?.commands;
  expect(commands?.map((command) => command.cwd)).toEqual([
    "apps/server",
    "packages/contracts",
    "packages/client-runtime",
    "apps/web",
    ".",
    ".",
  ]);
  expect(commands?.at(-2)?.args).toContain("apps/web/test/scenarios/areas/c-mate/tsconfig.json");
  expect(commands?.at(-1)?.args).toContain("apps/web/test/engine-oracle/tsconfig.json");
});

it("an empty lane chat selection skips before starting any command", () => {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/chat-gate.ts", "--verbose", "--stages", "A,C,E", "--files", "[]"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  for (const id of ["A", "C", "E"])
    expect(result.stdout).toContain(`Selection ${id}: skip: no selected case files`);
  expect(result.stdout).not.toContain("no cases ran");
});

it("Decision: no test deleted or weakened; only lane selection changes; main CI runs everything", () => {
  const result = NodeChildProcess.spawnSync(process.execPath, ["scripts/chat-gate.ts", "--list"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(
    "--project scenarios test/scenarios/areas/c-mate --allowOnly=false",
  );
  for (const file of [
    "src/spi/replay/goldens.test.ts",
    "src/engine/domain/decide.model.test.ts",
    "src/engine/outbox/crash.test.ts",
    "src/engine/history/historyImport.test.ts",
    "src/engine/engine.sim.test.ts",
    "src/engine/engine.pump.test.ts",
  ])
    expect(result.stdout).toContain(file);
  expect(result.stdout).not.toContain("skip:");
});

it("Decision: no test deleted or weakened; titles unchanged; crew/actor's crew stage is out of scope (separate backlog card)", () => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const inventory = chatGateTestFiles(
    root,
    chatGateStages.filter((stage) => stage.id === "C"),
  );
  const shards = ["1/4", "2/4", "3/4", "4/4"].map((shard) => {
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/chat-gate.ts", "--list", "--stages", "C", "--shard", shard],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--reporter=../../scripts/chat-gate-reporter.ts");
    return [
      ...result.stdout.matchAll(/test\/scenarios\/areas\/c-mate\/[\w-]+\.scenario\.ts/gu),
    ].map(([file]) => `apps/web/${file}`);
  });
  expect(
    shards.every((files) => files.length > 0),
    "ASSERTION: every configured C shard contains live scenario files",
  ).toBe(true);
  const sizes = shards.map((files) => files.length);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  expect(shards.flat().sort()).toEqual([...inventory].sort());
  expect(new Set(shards.flat()).size).toBe(inventory.length);
});

it("Decision: L3 runs everything on every main push; no test is skipped, deleted or weakened", () => {
  const { jobs } = parse(
    NodeFS.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ) as {
    jobs: Record<
      string,
      {
        if?: string;
        name: string;
        strategy: { matrix: { include: { command: string }[] } };
      }
    >;
  };
  // A false chat verdict must not prevent the shared scenario graph from selecting affected journeys.
  expect(jobs.state_smoke!.if).toBe(
    "${{ !cancelled() && needs.prepare.result == 'success' && needs.prepare.outputs.skip != 'true' && contains(fromJSON(needs.prepare.outputs.jobs), 'state_smoke') }}",
  );
  expect(blameSelection("refs/heads/main", undefined).selected).toContain("state_smoke");
  const signal = parse(
    NodeFS.readFileSync(new URL("../.github/workflows/signal.yml", import.meta.url), "utf8"),
  );
  expect(signal.jobs.chat_scenarios.if).toBeUndefined();
  expect(signal.jobs.chat_scenarios.name).toMatch(/^Test Web /u);
  const commands = signal.jobs.chat_scenarios.strategy.matrix.include.map(
    (row: { command: string }) => row.command,
  );
  expect(commands.filter((command: string) => command.includes("shard non-c"))).toEqual([
    "node scripts/signal.ts shard non-c 1/3",
    "node scripts/signal.ts shard non-c 2/3",
    "node scripts/signal.ts shard non-c 3/3",
  ]);
  const allNonC =
    "vp -C apps/web test run --config test/scenarios/vitest.config.ts --project scenarios test/scenarios/areas --exclude 'test/scenarios/areas/c-mate/**'";
  const certification = "--allowOnly=false";
  // Vitest owns the partition; its complete input is every non-C file on disk.
  const listed = NodeChildProcess.spawnSync(
    `${allNonC.replace("test run", "test list --filesOnly")} ${certification}`,
    { cwd: new URL("../", import.meta.url), shell: true, encoding: "utf8" },
  );
  expect(listed.status, listed.stderr).toBe(0);
  const actual = [...listed.stdout.matchAll(/test\/scenarios\/areas\/[\w/-]+\.scenario\.ts/gu)]
    .map(([file]) => file)
    .sort();
  const root = new URL("../apps/web/test/scenarios/areas/", import.meta.url);
  const expected = NodeFS.readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".scenario.ts") && !file.startsWith("c-mate/"))
    .map((file) => `test/scenarios/areas/${file}`)
    .sort();
  expect(actual).toEqual(expected);
  expect(actual.length).toBeGreaterThan(0);
});

it.each([
  ["--stages", "C", "--shard", "3/2"],
  ["--stages", "C", "--shard"],
  ["--stages", "E", "--shard", "1/2"],
  ["--shard", "1/2"],
  ["--stages", "C", "--shard", "1/2", "--files", "[]"],
])("refuses a shard that could omit certification: %j", (...args) => {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/chat-gate.ts", "--list", ...args],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Usage:");
});

// Decision: output only; selection and pass/fail semantics unchanged; no test weakened.
it.each([0, 7])(
  "Decision: output only; selection and pass/fail semantics unchanged; no test weakened. (exit %s)",
  (status) => {
    const fixture = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gate-quiet-"));
    try {
      for (const dir of ["scripts", "apps/server", "node_modules/.bin"])
        NodeFS.mkdirSync(NodePath.join(fixture, dir), { recursive: true });
      for (const file of ["chat-gate.ts", "gate-log.ts"])
        NodeFS.copyFileSync(
          NodePath.join(import.meta.dirname, file),
          NodePath.join(fixture, "scripts", file),
        );
      NodeFS.writeFileSync(
        NodePath.join(fixture, "node_modules/.bin/vp"),
        `#!/bin/sh
 echo 'runner banner'
 echo 'Tests  3 passed (3)'
 if [ ${status} -ne 0 ]; then
 echo ' FAIL src/proof.test.ts > preserves the verdict'
 echo 'AssertionError: expected 2 to be 1'
 echo ' ❯ src/proof.test.ts:12:3'
 fi
 exit ${status}
`,
        { mode: 0o755 },
      );
      const run = (...args: string[]) =>
        NodeChildProcess.spawnSync(
          process.execPath,
          ["scripts/chat-gate.ts", "--stages", "A", ...args],
          { cwd: fixture, encoding: "utf8" },
        );
      const result = run();
      const output = result.stdout + result.stderr;
      expect(result.status).toBe(status === 0 ? 0 : 1);
      expect(output).not.toContain("runner banner");
      expect(output).not.toContain("Selection ");
      if (status === 0) {
        expect(output.trim().split("\n").length).toBeLessThanOrEqual(15);
        expect(output).toMatch(/A: provider goldens.*3 cases.*[\d.]+s/u);
      } else {
        expect(output).toContain("preserves the verdict");
        expect(output).toContain("AssertionError: expected 2 to be 1");
        expect(output).toContain("src/proof.test.ts:12:3");
        const path = output.match(/Full log: (.+)/u)?.[1];
        expect(path).toBeDefined();
        expect(NodeFS.readFileSync(path!, "utf8")).toContain("runner banner");
      }
      const verbose = run("--verbose");
      expect(verbose.status).toBe(result.status);
      expect(verbose.stdout).toContain("runner banner");
      expect(verbose.stdout).toContain("Selection A:");
      const list = run("--list");
      expect(list.status).toBe(0);
      expect(list.stdout).toContain("goldens.test.ts");
      expect(list.stdout).not.toContain("runner banner");
    } finally {
      NodeFS.rmSync(fixture, { recursive: true, force: true });
    }
  },
);
