// @effect-diagnostics nodeBuiltinImport:off -- exercises the public gate selector.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { checkSteps } from "./ci-local.ts";
import { chatGateStages, selectsChatGate } from "./chat-gate.ts";

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
      "test/scenarios/areas/c-mate",
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
  ]);
});

it("the gate runs the crew's journeys on the engine's world, beside the unit suite's V1 run", () => {
  const commands = chatGateStages.flatMap((stage) =>
    stage.commands.flatMap((command) =>
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
    ["F: crew journeys on the engine", "engine", ["src/zerops/crew/CrewEngine"]],
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
