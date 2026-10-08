// @effect-diagnostics nodeBuiltinImport:off -- gate selection and Git fixture.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { chatGateTestFiles, chatGateStages, selectsChatGate } from "./chat-gate.ts";
import { expect, it } from "vite-plus/test";
import {
  scenarioFiles,
  validateSelectedFiles,
  changedPaths,
  selectScenarioAreas,
  scenarioAreas,
  touchedPackages,
  relatedTestPackages,
} from "./gate-changed.ts";

it("includes relay consumers when discovering related tests for shared changes", () => {
  const packages = [
    { directory: "apps/web", name: "web", typecheck: true },
    { directory: "infra/relay", name: "relay", typecheck: true },
    { directory: "packages/shared", name: "shared", typecheck: true },
  ];
  expect(relatedTestPackages(packages)).toEqual(packages.slice(0, 2));
});

it("selects only the owned scenario area for an area change", () => {
  expect(
    selectScenarioAreas(["apps/web/test/scenarios/areas/b-menu/liveness.scenario.ts"]),
  ).toEqual(["b-menu"]);
  expect(selectScenarioAreas(["apps/web/test/scenarios/areas/d-change/dsl.ts"])).toEqual([
    "d-change",
  ]);
  expect(selectScenarioAreas(["apps/web/src/components/chat/Composer.tsx"])).toEqual([
    "c-mate",
    "h-budget",
    "foundation",
  ]);
  expect(selectScenarioAreas(["apps/web/src/lib/terminalFocus.test.ts"])).toEqual([]);
});
it("shared data, harness and unclassified shell changes cover every area", () => {
  for (const path of [
    "packages/client-runtime/src/zerops/data/runtime.ts",
    "apps/web/test/scenarios/harness/browser.ts",
    "apps/web/src/main.tsx",
    "apps/web/src/components/SidebarZeropsTree.tsx",
    "apps/web/src/components/SidebarProductionChip.tsx",
    "apps/web/src/components/Sidebar.tsx",
  ])
    expect(selectScenarioAreas([path])).toEqual(scenarioAreas);
});
it("does not run scenarios for docs, unrelated scripts or server tooling", () => {
  expect(
    selectScenarioAreas([
      "CLAUDE.md",
      "apps/web/test/scenarios/README.md",
      "scripts/ci-local.ts",
      "apps/server/scripts/migrate-dev-db.ts",
    ]),
  ).toEqual([]);
});
it("scopes typechecks by package; toolchain changes cover all packages", () => {
  const packages = [
    { directory: "apps/web", name: "web", typecheck: true },
    { directory: "apps/mobile", name: "mobile", typecheck: true },
  ];
  expect(touchedPackages(["apps/web/src/a.ts", "CLAUDE.md"], packages)).toEqual([packages[0]]);
  expect(touchedPackages(["pnpm-lock.yaml"], packages)).toEqual(packages);
});
it("includes committed, staged, dirty, untracked and removed paths without following main", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-"));
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    for (const name of ["old.ts", "dirty.ts", "committed.ts"])
      NodeFS.writeFileSync(NodePath.join(root, name), "before");
    git("add", ".");
    git("commit", "-qm", "fixture");
    git("branch", "base");
    NodeFS.writeFileSync(NodePath.join(root, "committed.ts"), "after");
    git("commit", "-qam", "lane");
    NodeFS.renameSync(NodePath.join(root, "old.ts"), NodePath.join(root, "new.ts"));
    git("add", ".");
    NodeFS.writeFileSync(NodePath.join(root, "dirty.ts"), "dirty");
    NodeFS.writeFileSync(NodePath.join(root, "untracked.ts"), "new");
    expect(changedPaths(root, "base")).toEqual([
      "committed.ts",
      "dirty.ts",
      "new.ts",
      "old.ts",
      "untracked.ts",
    ]);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

// CI compatibility: the broad selector still schedules both-wire C coverage for these paths.
it.each([
  "apps/server/src/provider/Layers/ClaudeAdapter.ts",
  "apps/server/src/spi/toolCall.ts",
  "apps/server/src/orchestration/decider.ts",
  "apps/server/src/server.ts",
])("server chat boundary change %s selects all C journeys", (path) => {
  expect(selectsChatGate([path])).toBe(true);
  expect(chatGateTestFiles(NodePath.resolve(import.meta.dirname, ".."), chatGateStages)).toContain(
    "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts",
  );
});

it.each([{ args: [] }, { args: ["--list"] }])(
  "an unchanged lane skips checks ($args)",
  ({ args }) => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-empty-"));
    const git = (...args: string[]) => {
      const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    try {
      NodeFS.mkdirSync(NodePath.join(root, "scripts"));
      for (const name of ["gate-changed.ts", "chat-gate.ts", "gate-log.ts"])
        NodeFS.copyFileSync(
          NodePath.join(import.meta.dirname, name),
          NodePath.join(root, "scripts", name),
        );
      git("init", "-q");
      git("-c", "user.name=Gate fixture", "-c", "user.email=gate@example.test", "add", ".");
      git(
        "-c",
        "user.name=Gate fixture",
        "-c",
        "user.email=gate@example.test",
        "commit",
        "-qm",
        "fixture",
      );
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        ["scripts/gate-changed.ts", "--base", "HEAD", ...args],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("No changed files; no gates to run.");
      expect(result.stdout).not.toContain("guard ledgers");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

it.each([
  {
    areas: ["b-menu"],
    chatGate: false,
    includes: [
      "test/scenarios/areas/b-menu/access.scenario.ts",
      "test/scenarios/areas/b-menu/decode.scenario.ts",
      "test/scenarios/areas/b-menu/liveness.scenario.ts",
      "test/scenarios/areas/b-menu/placement.scenario.ts",
      "test/scenarios/fakes/b-menu/overview.test.ts",
    ],
  },
  {
    areas: ["c-mate"],
    chatGate: false,
    includes: [
      "test/scenarios/areas/c-mate/chat.scenario.ts",
      "test/scenarios/fakes/c-mate/chat.test.ts",
    ],
  },
  { areas: ["c-mate"], chatGate: true, includes: ["test/scenarios/fakes/c-mate/chat.test.ts"] },
  {
    areas: ["foundation"],
    chatGate: false,
    includes: ["test/scenarios/areas/foundation/examples.scenario.ts"],
  },
])(
  "scenario selection names existing files from the web root ($areas, $chatGate)",
  ({ areas, chatGate, includes }) => {
    const root = NodePath.resolve(import.meta.dirname, "..");
    const files = scenarioFiles(
      root,
      areas,
      chatGate ? chatGateTestFiles(root, chatGateStages) : [],
    );
    expect(files).toEqual(expect.arrayContaining(includes));
    for (const file of files)
      expect(NodeFS.statSync(NodePath.join(root, "apps/web", file)).isFile()).toBe(true);
    if (chatGate)
      expect(files.some((file) => file.startsWith("test/scenarios/areas/c-mate/"))).toBe(false);
  },
);

it.each([
  "test/scenarios/areas/C/missing.scenario.ts",
  "test/scenarios/fakes/foundation/missing.test.ts",
])("a missing selected file fails immediately with its name: %s", (file) => {
  expect(() =>
    validateSelectedFiles(NodePath.resolve(import.meta.dirname, "../apps/web"), [file]),
  ).toThrow(`Missing selected file: ${file}`);
});
it("a missing selected area fails before checks start", () => {
  expect(() => scenarioFiles(NodePath.resolve(import.meta.dirname, ".."), ["C"], [])).toThrow(
    "Missing selected scenario path: test/scenarios/areas/C",
  );
});

it.each([{ args: [] }, { args: ["--list"] }])(
  "a missing scenario selection stops before any check ($args)",
  ({ args }) => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-missing-"));
    const git = (...args: string[]) => {
      const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    try {
      NodeFS.mkdirSync(NodePath.join(root, "scripts"));
      for (const name of ["gate-changed.ts", "chat-gate.ts", "gate-log.ts"])
        NodeFS.copyFileSync(
          NodePath.join(import.meta.dirname, name),
          NodePath.join(root, "scripts", name),
        );
      git("init", "-q");
      git("config", "user.name", "Gate fixture");
      git("config", "user.email", "gate@example.test");
      git("add", ".");
      git("commit", "-qm", "fixture");
      NodeFS.mkdirSync(NodePath.join(root, "apps/web/src/components/chat"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(root, "apps/web/src/components/chat/Composer.tsx"),
        "export {};",
      );
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        ["scripts/gate-changed.ts", "--base", "HEAD", ...args],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Missing selected scenario path: test/scenarios/areas/c-mate",
      );
      expect(result.stdout).not.toContain("guard ledgers");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

// Exercise the printed commands, rather than a second implementation of the selectors.
it.each([
  { path: "apps/server/src/provider/Layers/ClaudeAdapter.ts", stages: "A", area: "" },
  { path: "apps/server/src/engine/domain/decide.ts", stages: "E", area: "" },
  { path: "packages/contracts/src/engine.ts", stages: "C,C-engine,E,types", area: "c-mate" },
  { path: "packages/contracts/src/engineCall.ts", stages: "C,C-engine,E,types", area: "c-mate" },
  {
    path: "apps/server/src/engine/wire/EngineWire.ts",
    stages: "C,C-engine,E,types",
    area: "c-mate",
  },
  {
    path: "apps/web/src/components/chat/RunChat.tsx",
    stages: "C,C-engine,types",
    area: "c-mate,h-budget,foundation",
  },
  {
    path: "packages/client-runtime/src/zerops/data/runtime.ts",
    stages: "A,C,C-engine,E,types",
    area: "a-signin,b-menu,c-mate,d-change,e-env,f-create,g-outage,h-budget,foundation,harness,lifecycle-mutations",
  },
  { path: "apps/web/test/scenarios/areas/d-change/dsl.ts", stages: "", area: "d-change" },
  { path: "apps/server/src/engine/pump/toCore.test.ts", stages: "", area: "" },
  {
    path: "apps/web/src/zerops/useZeropsAgentSignInDialog.tsx",
    stages: "C,C-engine,types",
    area: "a-signin,c-mate,h-budget,foundation",
  },
  {
    path: "apps/web/src/components/zerops/ZeropsAgentSignIn.tsx",
    stages: "C,C-engine,types",
    area: "a-signin,c-mate,h-budget,foundation",
  },
  {
    path: "apps/web/package.json",
    stages: "C,C-engine,types",
    area: "a-signin,b-menu,c-mate,d-change,e-env,f-create,g-outage,h-budget,foundation,harness,lifecycle-mutations",
  },
  {
    path: "apps/web/tsconfig.json",
    stages: "C,C-engine,types",
    area: "a-signin,b-menu,c-mate,d-change,e-env,f-create,g-outage,h-budget,foundation,harness,lifecycle-mutations",
  },
])("a lane validates only affected obligations for $path", ({ path, stages, area }) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-list-"));
  const source = NodePath.resolve(import.meta.dirname, "..");
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  try {
    NodeFS.mkdirSync(NodePath.join(root, "scripts"));
    for (const name of ["gate-changed.ts", "chat-gate.ts", "gate-log.ts"])
      NodeFS.copyFileSync(
        NodePath.join(source, "scripts", name),
        NodePath.join(root, "scripts", name),
      );
    for (const parent of ["apps", "packages", "infra"])
      NodeFS.mkdirSync(NodePath.join(root, parent));
    for (const directory of ["scripts", "apps/server", "apps/web"]) {
      NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
      NodeFS.copyFileSync(
        NodePath.join(source, directory, "package.json"),
        NodePath.join(root, directory, "package.json"),
      );
    }
    NodeFS.copyFileSync(
      NodePath.join(source, "apps/web/tsconfig.json"),
      NodePath.join(root, "apps/web/tsconfig.json"),
    );
    NodeFS.cpSync(
      NodePath.join(source, "apps/web/test/scenarios"),
      NodePath.join(root, "apps/web/test/scenarios"),
      { recursive: true },
    );
    for (const file of chatGateTestFiles(source, chatGateStages).filter((file) =>
      file.startsWith("apps/server/"),
    )) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, file)), { recursive: true });
      NodeFS.copyFileSync(NodePath.join(source, file), NodePath.join(root, file));
    }
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "fixture");
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.appendFileSync(
      NodePath.join(root, path),
      path.endsWith(".json") ? "\n" : "\n// changed\n",
    );
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    if (stages) expect(result.stdout).toContain(`scripts/chat-gate.ts --stages ${stages}`);
    else expect(result.stdout).not.toContain("scripts/chat-gate.ts");
    if (area) expect(result.stdout).toContain(`scenarios ${area}:`);
    else expect(result.stdout).not.toContain("scenarios ");
    const server = result.stdout.split("\n").find((line) => line.startsWith("related t3:"));
    if (path === "apps/web/tsconfig.json") {
      expect(result.stdout).not.toContain("related ");
    } else {
      expect(server).toBeDefined();
      expect(server?.includes("--exclude src/spi/replay/goldens.test.ts")).toBe(
        stages.includes("A"),
      );
      expect(server?.includes("--exclude src/engine/outbox/crash.test.ts")).toBe(
        stages.includes("E"),
      );
      if (area)
        expect(result.stdout).toContain("--exclude test/scenarios/fakes/browserHealth.test.ts");
    }
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("the engine wire's single journey leaves other C journeys with their scenario owner", () => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const owned = chatGateTestFiles(
    root,
    chatGateStages.filter((stage) => stage.id === "C-engine"),
  );
  const files = scenarioFiles(root, ["c-mate"], owned);
  expect(files).not.toContain("test/scenarios/areas/c-mate/chat.scenario.ts");
  expect(files).toContain("test/scenarios/areas/c-mate/opening.scenario.ts");
  expect(files).toContain("test/scenarios/fakes/c-mate/chat.test.ts");
});
