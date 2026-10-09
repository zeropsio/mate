// @effect-diagnostics nodeBuiltinImport:off -- exercises the public gate selector.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import { parse } from "yaml";
import { expect, it } from "vite-plus/test";
import { checkSteps } from "./ci-local.ts";
import {
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

it("the gate runs the chat journeys against both wires a Mate can speak", () => {
  const projects = chatGateStages.flatMap((stage) =>
    stage.commands.flatMap((command) => {
      const at = command.args.indexOf("--project");
      const areas = command.args.find((arg) => arg.startsWith("test/scenarios/areas"));
      return at === -1 || areas === undefined ? [] : [[stage.name, command.args[at + 1], areas]];
    }),
  );
  expect(projects).toEqual([
    ["B: client wire journeys (C)", "scenarios", "test/scenarios/areas/c-mate"],
    [
      "B: client wire journeys on the engine (C)",
      "scenarios-engine",
      "test/scenarios/areas/c-mate/chat.scenario.ts",
    ],
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

it("the gate runs the crew's journeys on the engine's world, beside the unit suite's V1 run", () => {
  const commands = chatGateStages.flatMap((stage) =>
    stage.commands.flatMap((command: ChatGateCommand) =>
      command.args.some((arg) => arg.startsWith("src/zerops/crew/CrewEngine"))
        ? [
            [
              stage.name,
              command.env?.CREW_WORLD,
              command.args.filter((arg) => arg.startsWith("src/")),
            ],
          ]
        : [],
    ),
  );
  expect(commands).toEqual([
    [
      "F: crew journeys on the engine",
      "engine",
      [
        ...["attachments", "endings", "lead", "memory", "midway", "operations", "runs"].map(
          (part) => `src/zerops/crew/CrewEngine.${part}.test.ts`,
        ),
        "src/zerops/crew/CrewEngine.test.ts",
        "src/zerops/crew/registerCrewRpc.test.ts",
      ],
    ],
  ]);
});

it("CI runs the same named gate as local ports", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  expect(checkSteps(workflow, "chat_gate").map((step) => step.run)).toEqual([
    "node scripts/chat-gate.ts --stages A,E,F,types",
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
  expect(result.stdout.trim()).toBe("true");
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

it.each([
  { path: "apps/server/src/provider/Layers/ClaudeAdapter.ts", ids: ["A"] },
  { path: "apps/server/src/spi/replay/goldens.test.ts", ids: ["A"] },
  { path: "apps/server/src/engine/outbox/crash.ts", ids: ["E"] },
  { path: "packages/contracts/src/engine.ts", ids: ["C", "C-engine", "E", "types"] },
  { path: "packages/contracts/src/engineCall.ts", ids: ["C", "C-engine", "E", "types"] },
  { path: "packages/contracts/src/engineWire.ts", ids: ["C", "C-engine", "E", "types"] },
  { path: "apps/server/src/engine/wire/EngineWire.ts", ids: ["C", "C-engine", "E", "types"] },
  { path: "apps/server/src/wsServer.ts", ids: ["C", "C-engine", "types"] },
  { path: "apps/web/src/components/chat/runCard.logic.ts", ids: ["C", "C-engine", "types"] },
  { path: "apps/web/src/components/chat/MessagesTimeline.tsx", ids: ["C", "C-engine", "types"] },
  { path: "apps/web/src/zerops/useZeropsAgentSignInDialog.tsx", ids: ["C", "C-engine", "types"] },
  { path: "apps/web/src/components/zerops/ZeropsAgentSignIn.tsx", ids: ["C", "C-engine", "types"] },
  {
    path: "apps/web/src/components/zerops/ZeropsAgentSignIn.logic.ts",
    ids: ["C", "C-engine", "types"],
  },
  { path: "apps/web/package.json", ids: ["C", "C-engine", "types"] },
  { path: "apps/web/tsconfig.json", ids: ["C", "C-engine", "types"] },
  { path: "apps/web/test/scenarios/areas/d-change/dsl.ts", ids: [] },
  { path: "apps/server/src/engine/pump/toCore.test.ts", ids: [] },
  // The engine crew's own code runs its journeys on the engine too.
  { path: "apps/server/src/zerops/crew/engine/decide.ts", ids: ["C", "C-engine", "F", "types"] },
  { path: "packages/client-runtime/src/data/projections/mateHealth.test.ts", ids: [] },
  { path: "docs/user/chat.md", ids: [] },
  { path: "apps/mobile/src/chat.tsx", ids: [] },
  {
    path: "packages/client-runtime/src/zerops/timelineFollow.ts",
    ids: ["C", "C-engine", "types"],
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

it("each wire stage owns only the journeys its project runs", () => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  expect(
    chatGateTestFiles(
      root,
      chatGateStages.filter((stage) => stage.id === "C-engine"),
    ),
  ).toEqual(["apps/web/test/scenarios/areas/c-mate/chat.scenario.ts"]);
  expect(
    chatGateTestFiles(
      root,
      chatGateStages.filter((stage) => stage.id === "C"),
    ),
  ).toContain("apps/web/test/scenarios/areas/c-mate/opening.scenario.ts");
  expect(chatGateTestFiles(root, [])).toEqual([]);
});

it.each([
  { args: ["--list", "--stages", "A"], labels: ["A: provider goldens"] },
  { args: ["--stages", "E", "--list"], labels: ["E: engine proof"] },
  {
    args: ["--list", "--stages", "C,C-engine"],
    labels: ["B: client wire journeys (C)", "B: client wire journeys on the engine (C)"],
  },
  {
    args: ["--list"],
    labels: [
      "A: provider goldens",
      "B: client wire journeys (C)",
      "B: client wire journeys on the engine (C)",
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

it("lane file selection keeps the affected C journey on both wires without expanding siblings", () => {
  const file = "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts";
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/chat-gate.ts", "--stages", "C,C-engine", "--files", JSON.stringify([file]), "--list"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.split(file.slice("apps/web/".length))).toHaveLength(3);
  expect(result.stdout).not.toContain("opening.scenario.ts");
  expect(result.stdout).toContain("--project scenarios ");
  expect(result.stdout).toContain("--project scenarios-engine ");
  expect(result.stdout).toContain("reason: explicit related files");
});

it.each([
  ["--stages", "C", "--files", "[null]"],
  [
    "--stages",
    "C-engine",
    "--files",
    JSON.stringify(["apps/web/test/scenarios/areas/c-mate/opening.scenario.ts"]),
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
    ["scripts/chat-gate.ts", "--verbose", "--stages", "A,C,C-engine,E", "--files", "[]"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  for (const id of ["A", "C", "C-engine", "E"])
    expect(result.stdout).toContain(`Selection ${id}: skip: no selected case files`);
  expect(result.stdout).not.toContain("no cases ran");
});

it("a selected client journey skips the engine stage when that project has no matching case", () => {
  const file = "apps/web/test/scenarios/areas/c-mate/opening.scenario.ts";
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/chat-gate.ts", "--stages", "C,C-engine", "--files", JSON.stringify([file]), "--list"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Selection C-engine: skip: no selected case files");
  expect(result.stdout).toContain("--project scenarios ");
  expect(result.stdout).not.toContain("--project scenarios-engine");
  expect(result.stdout).toContain(file.slice("apps/web/".length));
});

it("Decision: no test deleted or weakened; only lane selection changes; main CI runs everything", () => {
  const result = NodeChildProcess.spawnSync(process.execPath, ["scripts/chat-gate.ts", "--list"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("test/scenarios/areas/c-mate --allowOnly=false");
  expect(result.stdout).toContain(
    "--project scenarios-engine test/scenarios/areas/c-mate/chat.scenario.ts",
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
  const shards = ["1/2", "2/2"].map((shard) => {
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
  expect(shards[0]?.map((file) => NodePath.basename(file, ".scenario.ts")).sort()).toEqual(
    ["opening", "recovery", "admission", "providerLimits", "image-layout", "rewind"].sort(),
  );
  expect(shards.flat().sort()).toEqual([...inventory].sort());
  expect(new Set(shards.flat()).size).toBe(inventory.length);
});

it("CI builds once and certifies both complete C shards and C-engine from that artifact", () => {
  const { jobs } = parse(
    NodeFS.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ) as {
    jobs: Record<
      string,
      {
        needs: string;
        strategy?: { "fail-fast": boolean; matrix: { include: { args: string }[] } };
        steps: {
          uses?: string;
          run?: string;
          with?: Record<string, unknown>;
          env?: Record<string, string>;
        }[];
      }
    >;
  };
  const build = jobs.chat_bundle!;
  const journeys = jobs.chat_scenarios!;
  expect(build.needs).toBe("changes");
  expect(jobs.chat_gate!.needs).toBe("changes");
  expect(build.steps.filter((step) => step.run).map((step) => step.run)).toEqual([
    "vp exec node apps/web/test/scenarios/harness/build.ts",
  ]);
  expect(journeys.needs).toBe("chat_bundle");
  expect(journeys.strategy?.["fail-fast"]).toBe(false);
  expect(journeys.strategy?.matrix.include.map((row) => row.args)).toEqual([
    "--stages C --shard 1/2",
    "--stages C --shard 2/2",
    "--stages C-engine",
  ]);
  const uploaded = build.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;
  const downloaded = journeys.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  )!;
  expect(uploaded.with).toMatchObject({
    "include-hidden-files": true,
    "if-no-files-found": "error",
  });
  expect(downloaded.with).toEqual({ name: uploaded.with!.name, path: uploaded.with!.path });
  expect(journeys.steps.filter((step) => step.run)).toEqual([
    expect.objectContaining({
      run: "node scripts/chat-gate.ts ${{ matrix.args }}",
      env: { MATE_SCENARIO_REQUIRE_BUNDLE: "1" },
    }),
  ]);
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
