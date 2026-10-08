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
  scenarioAreas,
  touchedPackages,
  relatedTestPackages,
  relatedFiles,
} from "./gate-changed.ts";

it("includes relay consumers when discovering related tests for shared changes", () => {
  const packages = [
    { directory: "apps/web", name: "web", typecheck: true },
    { directory: "infra/relay", name: "relay", typecheck: true },
    { directory: "packages/shared", name: "shared", typecheck: true },
  ];
  expect(relatedTestPackages(packages)).toEqual(packages.slice(0, 2));
});

function areaFixture(
  imports: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
  assertion: (root: string) => void,
) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-graph-"));
  try {
    for (const area of scenarioAreas) {
      const directory = NodePath.join(root, "apps/web/test/scenarios/areas", area);
      NodeFS.mkdirSync(directory, { recursive: true });
      const file = NodePath.join(directory, "journey.scenario.ts");
      NodeFS.writeFileSync(
        file,
        imports
          .filter(([, areas]) => areas.includes(area))
          .map(
            ([path]) =>
              `import ${JSON.stringify("./" + NodePath.relative(directory, NodePath.join(root, path)))};`,
          )
          .join("\n"),
      );
    }
    NodeFS.mkdirSync(NodePath.join(root, "apps/web/test/scenarios/fakes"));
    for (const [path] of imports) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, path), "export {};");
    }
    assertion(root);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
}

it("selects only the owned scenario area for an area change", () => {
  const path = "apps/web/test/scenarios/areas/d-change/dsl.ts";
  areaFixture([[path, ["d-change"]]], (root) => {
    expect(
      relatedFiles(
        root,
        [path],
        [
          "apps/web/test/scenarios/areas/d-change/journey.scenario.ts",
          "apps/web/test/scenarios/areas/b-menu/journey.scenario.ts",
        ],
      ),
    ).toEqual(["apps/web/test/scenarios/areas/d-change/journey.scenario.ts"]);
    expect(
      relatedFiles(
        root,
        ["apps/web/test/scenarios/areas/b-menu/journey.scenario.ts"],
        ["apps/web/test/scenarios/areas/b-menu/journey.scenario.ts"],
      ),
    ).toEqual(["apps/web/test/scenarios/areas/b-menu/journey.scenario.ts"]);
    expect(
      relatedFiles(
        root,
        ["apps/web/src/lib/terminalFocus.test.ts"],
        ["apps/web/test/scenarios/areas/b-menu/journey.scenario.ts"],
      ),
    ).toEqual([]);
  });
});
it("shared data, harness and unclassified shell changes cover every area", () => {
  for (const path of [
    "packages/client-runtime/src/data/runtime.ts",
    "apps/web/test/scenarios/harness/browser.ts",
    "apps/web/src/main.tsx",
    "apps/web/src/components/SidebarZeropsTree.tsx",
  ]) {
    areaFixture([[path, scenarioAreas]], (root) =>
      expect(
        relatedFiles(
          root,
          [path],
          scenarioAreas.map((area) => `apps/web/test/scenarios/areas/${area}/journey.scenario.ts`),
        ),
      ).toEqual(
        scenarioAreas
          .map((area) => `apps/web/test/scenarios/areas/${area}/journey.scenario.ts`)
          .sort(),
      ),
    );
  }
});
it("does not run scenarios for docs, unrelated scripts or server tooling", () => {
  expect(
    relatedFiles(
      NodePath.resolve(import.meta.dirname, ".."),
      [
        "CLAUDE.md",
        "apps/web/test/scenarios/README.md",
        "scripts/ci-local.ts",
        "apps/server/scripts/migrate-dev-db.ts",
      ],
      ["apps/web/test/scenarios/areas/c-mate/chat.scenario.ts"],
    ),
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
      NodeFS.symlinkSync(
        NodePath.join(import.meta.dirname, "node_modules"),
        NodePath.join(root, "scripts/node_modules"),
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
      NodeFS.symlinkSync(
        NodePath.join(import.meta.dirname, "node_modules"),
        NodePath.join(root, "scripts/node_modules"),
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
        "Missing selected scenario path: test/scenarios/areas/a-signin",
      );
      expect(result.stdout).not.toContain("guard ledgers");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

// Exercise printed commands through exact imports, with unrelated siblings in every area.
it.each([
  { path: "apps/server/src/provider/Layers/ClaudeAdapter.ts", stages: "A", area: "" },
  { path: "apps/server/src/engine/domain/decide.ts", stages: "E", area: "" },
  { path: "packages/contracts/src/engine.ts", stages: "C,C-engine,E", area: "c-mate" },
  { path: "packages/contracts/src/engineCall.ts", stages: "C,C-engine,E", area: "c-mate" },
  { path: "apps/server/src/engine/wire/EngineWire.ts", stages: "C,C-engine,E", area: "c-mate" },
  { path: "apps/web/src/components/chat/RunChat.tsx", stages: "C,C-engine", area: "c-mate" },
  { path: "packages/client-runtime/src/data/runtime.ts", stages: "C,C-engine", area: "c-mate" },
  { path: "apps/web/test/scenarios/areas/d-change/dsl.ts", stages: "", area: "d-change" },
  { path: "apps/server/src/engine/pump/toCore.test.ts", stages: "", area: "" },
  {
    path: "apps/web/src/zerops/useZeropsAgentSignInDialog.tsx",
    stages: "C,C-engine",
    area: "c-mate",
  },
  {
    path: "apps/web/src/components/zerops/ZeropsAgentSignIn.tsx",
    stages: "C,C-engine",
    area: "c-mate",
  },
  { path: "apps/web/package.json", stages: "", area: "" },
  { path: "apps/web/tsconfig.json", stages: "", area: "" },
])("a lane validates only affected obligations for $path", ({ path, stages, area }) => {
  areaFixture([], (root) => {
    const git = (...args: string[]) => {
      const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    NodeFS.mkdirSync(NodePath.join(root, "scripts"));
    NodeFS.mkdirSync(NodePath.join(root, "packages"));
    NodeFS.mkdirSync(NodePath.join(root, "infra"));
    NodeFS.symlinkSync(
      NodePath.join(import.meta.dirname, "node_modules"),
      NodePath.join(root, "scripts/node_modules"),
    );
    for (const name of ["gate-changed.ts", "chat-gate.ts", "gate-log.ts"])
      NodeFS.copyFileSync(
        NodePath.join(import.meta.dirname, name),
        NodePath.join(root, "scripts", name),
      );
    for (const directory of ["scripts", "apps/server", "apps/web"]) {
      NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
      NodeFS.copyFileSync(
        NodePath.resolve(import.meta.dirname, "..", directory, "package.json"),
        NodePath.join(root, directory, "package.json"),
      );
    }
    const c = "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts";
    const inventory = chatGateTestFiles(
      NodePath.resolve(import.meta.dirname, ".."),
      chatGateStages.filter((stage) => stage.id === "A" || stage.id === "E"),
    );
    for (const file of [...inventory, c]) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, file)), { recursive: true });
      const imported = stages.split(",").some((id) =>
        chatGateTestFiles(
          NodePath.resolve(import.meta.dirname, ".."),
          chatGateStages.filter((stage) => stage.id === id),
        ).includes(file),
      );
      NodeFS.writeFileSync(
        NodePath.join(root, file),
        imported
          ? `import ${JSON.stringify(NodePath.relative(NodePath.dirname(file), path))};`
          : "export {};",
      );
    }
    if (area === "d-change")
      NodeFS.writeFileSync(
        NodePath.join(root, "apps/web/test/scenarios/areas/d-change/journey.scenario.ts"),
        'import "./dsl.ts";',
      );
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    if (!path.endsWith(".json"))
      NodeFS.writeFileSync(NodePath.join(root, path), "export const changed = 1;\n");
    else if (!NodeFS.existsSync(NodePath.join(root, path)))
      NodeFS.writeFileSync(NodePath.join(root, path), "{}");
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "fixture");
    NodeFS.writeFileSync(
      NodePath.join(root, path),
      path.endsWith(".json") ? '{"changed": true}' : "export const changed = 2;\n",
    );
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    if (stages) expect(result.stdout).toContain(`scripts/chat-gate.ts --stages ${stages} --files`);
    else expect(result.stdout).not.toContain("scripts/chat-gate.ts --stages");
    expect(result.stdout).toContain(`Scenario files: ${area ? 1 : 0};`);
    expect(result.stdout).not.toContain("--exclude test/scenarios/fakes/");
    expect(result.stdout).not.toContain(
      "--exclude test/scenarios/areas/b-menu/journey.scenario.ts",
    );
    if (stages.includes("A"))
      expect(result.stdout).toContain("--exclude src/spi/replay/goldens.test.ts");
    if (stages.includes("E"))
      expect(result.stdout).toContain("--exclude src/engine/outbox/crash.test.ts");
    if (area === "d-change")
      expect(result.stdout).toContain(
        "related scenario files: vp test run --config test/scenarios/vitest.config.ts test/scenarios/areas/d-change/journey.scenario.ts",
      );
    expect(result.stdout).toContain("Selection A:");
    expect(result.stdout).toContain("Selection C-engine:");
  });
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

// Decision: no test deleted or weakened; only lane selection changes; main CI runs everything.
it("a comments-only chat edit schedules no browser scenarios or chat stages", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-comments-"));
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
    NodeFS.symlinkSync(
      NodePath.resolve(import.meta.dirname, "node_modules"),
      NodePath.join(root, "scripts/node_modules"),
    );
    for (const directory of [
      "packages",
      "infra",
      "apps/web/src",
      "apps/web/test/scenarios/areas/c-mate",
      "apps/web/test/scenarios/fakes",
    ])
      NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
    for (const area of [
      "a-signin",
      "b-menu",
      "d-change",
      "e-env",
      "f-create",
      "g-outage",
      "h-budget",
      "foundation",
      "harness",
      "lifecycle-mutations",
    ]) {
      const directory = NodePath.join(root, "apps/web/test/scenarios/areas", area);
      NodeFS.mkdirSync(directory, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(directory, "other.scenario.ts"), "export {};");
    }
    const file = NodePath.join(root, "apps/web/src/ChatView.tsx");
    NodeFS.writeFileSync(file, "export const view = 1; // documentation\n");
    NodeFS.writeFileSync(
      NodePath.join(root, "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts"),
      'import "../../../../src/ChatView.tsx";',
    );
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "fixture");
    NodeFS.writeFileSync(file, "export const view = 1; // better documentation\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("scripts/chat-gate.ts --stages");
    expect(result.stdout).not.toContain("vp test run --config test/scenarios/vitest.config.ts");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("the related file graph follows reexports, cycles, lazy imports, aliases and old imports after a rename", () => {
  areaFixture([], (root) => {
    const write = (path: string, text: string) => {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(root, path), text);
    };
    write(
      "packages/fixture/package.json",
      JSON.stringify({
        name: "@fixture/runtime",
        exports: { "./owner": { types: "./src/owner.ts", import: "./src/owner.ts" } },
      }),
    );
    write("packages/fixture/src/owner.ts", "export const owner = 1;");
    write("apps/web/src/boundary.ts", 'export * from "@fixture/runtime/owner"; import "./cycle";');
    write("apps/web/src/cycle.ts", 'import "./boundary";');
    write("apps/web/src/removed.ts", "export const removed = 1;");
    const related = "apps/web/test/scenarios/areas/c-mate/journey.scenario.ts";
    const unrelated = "apps/web/test/scenarios/areas/c-mate/sibling.scenario.ts";
    write(related, 'import("~/boundary"); import "./renamed.ts";');
    write(unrelated, "export {};");
    const previous = new Map([
      [related, 'import("~/boundary"); import "~/removed";'],
      ["apps/web/src/deleted.ts", "export const old = 1;"],
    ]);
    expect(relatedFiles(root, ["packages/fixture/src/owner.ts"], [related, unrelated])).toEqual([
      related,
    ]);
    expect(relatedFiles(root, ["apps/web/src/removed.ts"], [related, unrelated], previous)).toEqual(
      [related],
    );
    write(related, 'import "~/deleted";');
    expect(relatedFiles(root, ["apps/web/src/deleted.ts"], [related, unrelated], previous)).toEqual(
      [related],
    );
    expect(
      relatedFiles(root, ["docs/runtime.json", ".plans/owner.ts"], [related, unrelated], previous),
    ).toEqual([]);
  });
});
