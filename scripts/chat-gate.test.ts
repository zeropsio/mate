// @effect-diagnostics nodeBuiltinImport:off -- exercises the public gate selector.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { checkSteps } from "./ci-local.ts";
import {
  chatGateStages,
  chatGateTestFiles,
  selectLaneChatStages,
  selectsChatGate,
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
      return at === -1 ? [] : [[stage.name, command.args[at + 1], areas]];
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
    "src/engine/engine.sim.test.ts",
    "src/engine/engine.pump.test.ts",
  ]);
});

it("CI runs the same named gate as local ports", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  expect(checkSteps(workflow, "chat_gate").map((step) => step.run)).toEqual([
    "node scripts/chat-gate.ts",
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
  { path: "packages/contracts/src/engine.ts", ids: ["C", "C-engine", "E"] },
  { path: "packages/contracts/src/engineCall.ts", ids: ["C", "C-engine", "E"] },
  { path: "packages/contracts/src/engineWire.ts", ids: ["C", "C-engine", "E"] },
  { path: "apps/server/src/engine/wire/EngineWire.ts", ids: ["C", "C-engine", "E"] },
  { path: "apps/server/src/wsServer.ts", ids: ["C", "C-engine"] },
  { path: "apps/web/src/components/chat/runCard.logic.ts", ids: ["C", "C-engine"] },
  { path: "apps/web/src/components/chat/MessagesTimeline.tsx", ids: ["C", "C-engine"] },
  { path: "apps/web/src/zerops/useZeropsAgentSignInDialog.tsx", ids: ["C", "C-engine"] },
  { path: "apps/web/src/components/zerops/ZeropsAgentSignIn.tsx", ids: ["C", "C-engine"] },
  {
    path: "apps/web/src/components/zerops/ZeropsAgentSignIn.logic.ts",
    ids: ["C", "C-engine"],
  },
  { path: "apps/web/package.json", ids: ["C", "C-engine"] },
  { path: "apps/web/tsconfig.json", ids: ["C", "C-engine"] },
  { path: "apps/web/test/scenarios/areas/d-change/dsl.ts", ids: [] },
  { path: "apps/server/src/engine/pump/toCore.test.ts", ids: [] },
  { path: "packages/client-runtime/src/data/projections/mateHealth.test.ts", ids: [] },
  { path: "docs/user/chat.md", ids: [] },
  { path: "apps/mobile/src/chat.tsx", ids: [] },
  {
    path: "packages/client-runtime/src/zerops/timelineFollow.ts",
    ids: ["C", "C-engine"],
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
    NodeFS.mkdirSync(NodePath.join(fixture, "node_modules/.bin"), { recursive: true });
    NodeFS.copyFileSync(
      NodePath.join(root, "scripts/chat-gate.ts"),
      NodePath.join(fixture, "scripts/chat-gate.ts"),
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
  ["--stages", "C", "--files", "[]"],
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
