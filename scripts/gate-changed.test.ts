// @effect-diagnostics nodeBuiltinImport:off -- gate selection and Git fixture.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { chatGateTestFiles, chatGateStages, selectsChatGate } from "./chat-gate.ts";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import {
  scenarioFiles,
  validateSelectedFiles,
  changedPaths,
  scenarioAreas,
  touchedPackages,
  relatedTestPackages,
  relatedFiles,
  meaningfulChanges,
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

// A real repository snapshot retains the bundle/harness boundary; expectations never create imports.
let repositoryFixture: string;
const sourceRoot = NodePath.resolve(import.meta.dirname, "..");
const fixtureGit = (...args: string[]) => {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: repositoryFixture,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
beforeAll(() => {
  repositoryFixture = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-real-"));
  const archivePath = NodePath.join(repositoryFixture, "source.tar");
  const archive = NodeChildProcess.spawnSync(
    "git",
    [
      "archive",
      "--output",
      archivePath,
      "HEAD",
      "apps/web/src",
      "apps/web/test",
      "apps/web/index.html",
      "apps/web/vite.config.ts",
      "apps/web/tsconfig.json",
      "apps/web/package.json",
      "apps/server/src",
      "apps/server/package.json",
      "apps/hq/src",
      "apps/hq/test",
      "apps/hq/package.json",
      "packages",
      "scripts",
      "infra/relay/package.json",
      "apps/mobile/package.json",
      "apps/desktop/package.json",
      "package.json",
      "tsconfig.base.json",
      "pnpm-lock.yaml",
    ],
    { cwd: sourceRoot },
  );
  if (archive.status !== 0) throw new Error(String(archive.stderr));
  const extracted = NodeChildProcess.spawnSync("tar", [
    "-xf",
    archivePath,
    "-C",
    repositoryFixture,
  ]);
  if (extracted.status !== 0) throw new Error(String(extracted.stderr));
  NodeFS.rmSync(archivePath);
  for (const file of ["gate-changed.ts", "chat-gate.ts"])
    NodeFS.copyFileSync(
      NodePath.join(import.meta.dirname, file),
      NodePath.join(repositoryFixture, "scripts", file),
    );
  NodeFS.symlinkSync(
    NodePath.join(import.meta.dirname, "node_modules"),
    NodePath.join(repositoryFixture, "scripts/node_modules"),
  );
  fixtureGit("init", "-q");
  fixtureGit("config", "user.name", "Gate fixture");
  fixtureGit("config", "user.email", "gate@example.test");
  fixtureGit("add", ".");
  fixtureGit("commit", "-qm", "real repository fixture");
}, 30_000);
afterAll(() => {
  if (repositoryFixture) NodeFS.rmSync(repositoryFixture, { recursive: true, force: true });
});

it.each([
  { path: "apps/server/src/provider/Layers/ClaudeAdapter.ts", stages: "A" },
  { path: "apps/server/src/engine/domain/decide.ts", stages: "E" },
  { path: "packages/contracts/src/engine.ts", stages: "C,C-engine,E,types" },
  { path: "packages/contracts/src/engineCall.ts", stages: "C,C-engine,E,types" },
  { path: "apps/server/src/engine/wire/EngineWire.ts", stages: "E" },
  { path: "apps/web/src/components/chat/RunChat.tsx", stages: "C,C-engine,types" },
  {
    path: "packages/client-runtime/src/data/projections/agentAdmission.ts",
    stages: "C,C-engine,types",
  },
  { path: "apps/web/test/scenarios/areas/d-change/dsl.ts", stages: "" },
  { path: "apps/server/src/engine/pump/toCore.test.ts", stages: "" },
  { path: "apps/web/src/zerops/useZeropsAgentSignInDialog.tsx", stages: "C,C-engine,types" },
  { path: "apps/web/src/components/zerops/ZeropsAgentSignIn.tsx", stages: "C,C-engine,types" },
  { path: "apps/web/package.json", stages: "C,C-engine,types" },
  { path: "apps/web/tsconfig.json", stages: "C,C-engine,types" },
])("a lane validates only affected obligations for $path", ({ path, stages }) => {
  const file = NodePath.join(repositoryFixture, path);
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(
      file,
      path.endsWith(".json")
        ? original.replace(/\}\s*$/u, ', "laneGateFixture": true\n}\n')
        : original + "\nexport const laneGateFixture = true;\n",
    );
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    if (stages) expect(result.stdout).toContain(`scripts/chat-gate.ts --stages ${stages}`);
    else expect(result.stdout).not.toContain("scripts/chat-gate.ts --stages");
    if (stages.includes("C")) {
      expect(result.stdout).toContain(
        '"apps/web/test/scenarios/areas/c-mate/admission.scenario.ts"',
      );
      expect(result.stdout).toContain('"apps/web/test/scenarios/areas/c-mate/opening.scenario.ts"');
      expect(result.stdout).not.toContain("test/scenarios/areas/c-mate --");
      expect(result.stdout).toContain("changed:");
    }
    if (stages.includes("A"))
      expect(result.stdout).toContain("--exclude src/spi/replay/goldens.test.ts");
    if (stages.includes("E"))
      expect(result.stdout).toContain(
        path.endsWith("/wire/EngineWire.ts")
          ? "--exclude src/engine/history/historyImport.test.ts"
          : "--exclude src/engine/outbox/crash.test.ts",
      );
    if (stages.includes("types")) {
      expect(result.stdout).not.toContain("typecheck @t3tools/contracts:");
      expect(result.stdout).not.toContain("typecheck @t3tools/web:");
    }
    if (path.endsWith("/d-change/dsl.ts")) {
      expect(result.stdout).toContain("test/scenarios/areas/d-change/review.scenario.ts");
      expect(result.stdout).not.toContain(
        '"apps/web/test/scenarios/areas/c-mate/admission.scenario.ts"',
      );
    }
    expect(result.stdout).toContain("Selection A:");
    expect(result.stdout).toContain("Selection C-engine:");
  } finally {
    NodeFS.writeFileSync(file, original);
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

it.each([
  {
    path: "apps/web/src/components/ChatView.tsx",
    consumer: "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts",
  },
  {
    path: "packages/client-runtime/src/data/projections/agentAdmission.ts",
    consumer: "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts",
  },
  {
    path: "apps/web/test/scenarios/harness/build.ts",
    consumer: "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts",
  },
  {
    path: "apps/web/src/fonts.css",
    consumer: "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts",
  },
  {
    path: "apps/web/src/components/zerops/primitives/MateFaceMoments.css",
    consumer: "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts",
  },
  {
    path: "apps/server/src/spi/fixtures/claude/plain-text-turn.expected.json",
    consumer: "apps/server/src/spi/replay/goldens.test.ts",
  },
])("execution dependency $path retains its real consumer $consumer", ({ path, consumer }) => {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const candidates = [consumer, "apps/web/test/scenarios/fakes/c-mate/chat.test.ts"];
  const selected = relatedFiles(root, [path], candidates);
  expect(selected).toContain(consumer);
  expect(selected).not.toContain("apps/web/test/scenarios/fakes/c-mate/chat.test.ts");
});

it("a comments-only stylesheet edit schedules no browser scenarios or chat stages", () => {
  const file = NodePath.join(repositoryFixture, "apps/web/src/index.css");
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(file, original + "\n/* Updated stylesheet explanation. */\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Scenario files: 0; reason: documentation/comments only");
    expect(result.stdout).not.toContain("scripts/chat-gate.ts --stages");
    expect(result.stdout).not.toContain(".scenario.ts");
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

it("a comments-only HTML edit schedules no browser scenarios or chat stages", () => {
  const file = NodePath.join(repositoryFixture, "apps/web/index.html");
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(file, original + "\n<!-- Updated browser entry explanation. -->\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Scenario files: 0; reason: documentation/comments only");
    expect(result.stdout).not.toContain("scripts/chat-gate.ts --stages");
    expect(result.stdout).not.toContain(".scenario.ts");
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

it("HTML comments preserve markup, inline code, literal content and visible whitespace", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-html-"));
  const path = "apps/web/index.html";
  const file = NodePath.join(root, path);
  const original = `<!doctype html><html><head>
<script>const message = "<!-- script literal -->"; // script explanation
</script><style>a::after { content: "<!-- style literal -->"; /* style explanation */ }</style>
</head><body><span title="<!-- attribute literal -->">one</span> <span>two</span>
<template><!-- template explanation --></template></body></html>`;
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  try {
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, original);
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "HTML fixture");
    for (const [before, after, meaningful] of [
      ["template explanation", "updated explanation", false],
      ["script explanation", "updated explanation", false],
      ["style explanation", "updated explanation", false],
      ["script literal", "changed script literal", true],
      ["style literal", "changed style literal", true],
      ["attribute literal", "changed attribute literal", true],
      ["const message", "window.message", true],
      ["<span>two", "<span hidden>two", true],
      ["</span> <span>", "</span><span>", true],
    ] as const) {
      NodeFS.writeFileSync(file, original.replace(before, after));
      expect(meaningfulChanges(root, "HEAD", [path]).paths, before).toEqual(
        meaningful ? [path] : [],
      );
    }
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("stylesheet strings containing comment delimiters remain meaningful changes", () => {
  const path = "apps/web/src/index.css";
  const file = NodePath.join(repositoryFixture, path);
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(
      file,
      original + '\n.example::after { content: "/* actual content */"; }\n',
    );
    expect(meaningfulChanges(repositoryFixture, "HEAD", [path]).paths).toEqual([path]);
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

it("stylesheet syntax ignores inline and license comments without hiding invalid edits", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-css-"));
  const path = "style.css";
  const file = NodePath.join(root, path);
  const original = 'a/**/.b { content: "/* literal */"; color: red; }';
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  try {
    NodeFS.writeFileSync(file, original);
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "stylesheet fixture");
    NodeFS.writeFileSync(file, "/*! license */" + original.replace("/**/", "/* explanation */"));
    expect(meaningfulChanges(root, "HEAD", [path]).paths).toEqual([]);
    NodeFS.writeFileSync(file, original + "\n@import ;");
    expect(meaningfulChanges(root, "HEAD", [path]).paths).toEqual([path]);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("stylesheet imports retain nested url inputs and removed imports", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-css-imports-"));
  const test = "journey.test.ts";
  try {
    for (const [file, source] of [
      [test, 'import "./index.css";'],
      ["index.css", '@import /* explanation */ url("./nested.css") screen;'],
      ["nested.css", '@import "./fonts.css";'],
      ["fonts.css", "a { color: red; }"],
      ["unrelated.test.ts", "export {};"],
    ] as const)
      NodeFS.writeFileSync(NodePath.join(root, file), source);
    expect(relatedFiles(root, ["fonts.css"], [test, "unrelated.test.ts"])).toEqual([test]);
    NodeFS.writeFileSync(NodePath.join(root, "nested.css"), "");
    NodeFS.rmSync(NodePath.join(root, "fonts.css"));
    expect(
      relatedFiles(
        root,
        ["fonts.css"],
        [test, "unrelated.test.ts"],
        new Map([
          ["nested.css", '@import "./fonts.css";'],
          ["fonts.css", "a { color: red; }"],
        ]),
      ),
    ).toEqual([test]);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
