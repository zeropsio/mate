// @effect-diagnostics nodeBuiltinImport:off -- gate selection and Git fixture.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { chatGateTestFiles, chatGateStages, selectsChatGate } from "./chat-gate.ts";
import { gateSlotCount } from "./gate-slots.ts";
import { afterAll, beforeAll, expect, it, vi } from "vite-plus/test";
import {
  scenarioFiles,
  affectedScenarioFiles,
  validateSelectedFiles,
  changedPaths,
  scenarioAreas,
  touchedPackages,
  relatedTestPackages,
  relatedFiles,
  meaningfulChanges,
  buildRelatedFileGraph,
  buildGateGraph,
  selectGateSteps,
  stateOnlySmoke,
} from "./gate-changed.ts";

const gateRunnerFiles = [
  "gate-changed.ts",
  "gate-input-scopes.ts",
  "gate-installed-dependencies.ts",
  "state-smoke-cases.ts",
  "gate-file-inputs.ts",
  "chat-gate.ts",
  "gate-log.ts",
  "gate-slots.ts",
  "test-process-lock.ts",
  "test-process-lock-holder.ts",
];

it("new-branch selection includes every path when Git output exceeds one mebibyte", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-large-diff-"));
  try {
    const scenario = "apps/web/test/scenarios/areas/c-mate/large-selection.scenario.ts";
    for (const directory of ["scripts", "packages", "infra", NodePath.dirname(scenario)])
      NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
    const paths = [
      ...Array.from({ length: 6000 }, (_, index) => `${"x".repeat(180)}-${index}.md`),
      scenario,
    ].sort();
    for (const path of paths) NodeFS.writeFileSync(NodePath.join(root, path), "");
    expect(NodeChildProcess.spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
    expect(NodeChildProcess.spawnSync("git", ["add", "."], { cwd: root }).status).toBe(0);
    expect(Buffer.byteLength(paths.join("\0"))).toBeGreaterThan(1024 * 1024);
    let selected: string[] | undefined;
    expect(() => {
      selected = changedPaths(root, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    }, "ASSERTION: a new branch must retain its complete file selection beyond the default subprocess buffer").not.toThrow();
    expect(selected).toEqual(paths);
    expect(
      () => affectedScenarioFiles(root, "4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
      "ASSERTION: the State Smoke selector must consume the entire new-branch diff",
    ).not.toThrow();
    expect(affectedScenarioFiles(root, "4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toEqual([
      scenario,
    ]);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("includes relay consumers when discovering related tests for shared changes", () => {
  const packages = [
    { directory: "apps/web", name: "web", typecheck: true },
    { directory: "infra/relay", name: "relay", typecheck: true },
    { directory: "packages/shared", name: "shared", typecheck: true },
  ];
  expect(relatedTestPackages(packages)).toEqual(packages.slice(0, 2));
});

// What `vp i` leaves behind: pnpm's copy of the lockfile it installed from.
function installLockfile(root: string) {
  NodeFS.mkdirSync(NodePath.join(root, "node_modules/.pnpm"), { recursive: true });
  NodeFS.copyFileSync(
    NodePath.join(root, "pnpm-lock.yaml"),
    NodePath.join(root, "node_modules/.pnpm/lock.yaml"),
  );
}

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
      for (const name of gateRunnerFiles)
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
      "test/scenarios/areas/b-menu/usage.scenario.ts",
      "test/scenarios/areas/b-menu/decode.scenario.ts",
      "test/scenarios/areas/b-menu/liveness.scenario.ts",
      "test/scenarios/areas/b-menu/drafts.scenario.ts",
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
      for (const name of gateRunnerFiles)
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
        "Missing selected file: apps/web/test/scenarios/areas/c-mate/chat.scenario.ts",
      );
      expect(result.stdout).not.toContain("guard ledgers");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

// A real repository snapshot retains the bundle/harness boundary; expectations never create imports.
let repositoryFixture: string;
let repositoryGraph: ReturnType<typeof buildGateGraph>;
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
      "oxlint-plugin-t3code/rules",
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
  for (const file of gateRunnerFiles)
    NodeFS.copyFileSync(
      NodePath.join(import.meta.dirname, file),
      NodePath.join(repositoryFixture, "scripts", file),
    );
  NodeFS.symlinkSync(
    NodePath.join(import.meta.dirname, "node_modules"),
    NodePath.join(repositoryFixture, "scripts/node_modules"),
  );
  installLockfile(repositoryFixture);
  fixtureGit("init", "-q");
  fixtureGit("config", "user.name", "Gate fixture");
  fixtureGit("config", "user.email", "gate@example.test");
  fixtureGit("add", ".");
  fixtureGit("commit", "-qm", "real repository fixture");
  repositoryGraph = buildGateGraph(repositoryFixture);
}, 30_000);
afterAll(() => {
  if (repositoryFixture) NodeFS.rmSync(repositoryFixture, { recursive: true, force: true });
});

it.each([
  {
    title: "a change to a mobile source runs its mobile unit test",
    source: "apps/mobile/src/gateSelectionFixture.ts",
    clients: ["mobile"],
  },
  {
    title: "a change to a desktop source runs its desktop unit test",
    source: "apps/desktop/src/gateSelectionFixture.ts",
    clients: ["desktop"],
  },
  {
    title: "a change to a shared package runs the mobile and desktop tests that import it",
    source: "packages/client-runtime/src/delayedStatus.ts",
    clients: ["mobile", "desktop"],
  },
])("$title", ({ source, clients }) => {
  const file = NodePath.join(repositoryFixture, source);
  const original = NodeFS.existsSync(file) ? NodeFS.readFileSync(file, "utf8") : undefined;
  const units = clients.map((client) => `apps/${client}/src/gateSelectionFixture.test.ts`);
  try {
    for (const unit of units) {
      const path = NodePath.join(repositoryFixture, unit);
      NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
      NodeFS.writeFileSync(
        path,
        source.startsWith("packages/")
          ? 'import "@t3tools/client-runtime/delayed-status";\n'
          : "export {};\n",
      );
    }
    NodeFS.writeFileSync(file, (original ?? "") + "\nexport const gateSelectionFixture = true;\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const stages = result.stdout.split("\n");
    for (const client of clients) {
      expect(stages, "ASSERTION: every affected app keeps its typecheck").toContain(
        `typecheck @t3tools/${client}: vp exec tsc --noEmit --incremental`,
      );
      expect(stages, "ASSERTION: the gate runs each affected app's selected unit test").toContain(
        `related @t3tools/${client}: vp test run src/gateSelectionFixture.test.ts`,
      );
    }
  } finally {
    for (const unit of units)
      NodeFS.rmSync(NodePath.join(repositoryFixture, unit), { force: true });
    if (original === undefined) NodeFS.rmSync(file, { force: true });
    else NodeFS.writeFileSync(file, original);
  }
});

it.each(["mobile", "desktop"])(
  "Decision: no app is outside the gate; a change only in apps/%s runs its typecheck and unit tests without browser scenarios",
  (client) => {
    const files = [
      "src/nativeGateFixture.ts",
      "src/nativeGateFixture.test.ts",
      "test/nativeGateFixture.scenario.ts",
    ].map((file) => NodePath.join(repositoryFixture, "apps", client, file));
    try {
      for (const file of files) {
        NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
        NodeFS.writeFileSync(file, "export const hostedWebScopeFixture = true;\n");
      }
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
        { cwd: repositoryFixture, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      const stages = result.stdout.split("\n");
      expect(
        stages.filter(
          (line) =>
            line.startsWith(`typecheck @t3tools/${client}:`) ||
            line.startsWith(`related @t3tools/${client}:`),
        ),
        "ASSERTION: native-only edits run their typecheck and unit test",
      ).toEqual([
        `typecheck @t3tools/${client}: vp exec tsc --noEmit --incremental`,
        `related @t3tools/${client}: vp test run src/nativeGateFixture.test.ts`,
      ]);
      expect(
        stages.filter((line) => /^(?:edited scenario files:|state-only smoke:)/u.test(line)),
        "ASSERTION: native-only edits run no browser scenarios",
      ).toEqual([]);
    } finally {
      for (const file of files) NodeFS.rmSync(file, { force: true });
    }
  },
);

it.each([
  { path: "apps/server/src/provider/Layers/ClaudeAdapter.ts", stages: "A" },
  { path: "apps/server/src/engine/domain/decide.ts", stages: "E" },
  { path: "packages/contracts/src/engine.ts", stages: "C,E,types" },
  { path: "packages/contracts/src/engineCall.ts", stages: "C,E,types" },
  { path: "apps/server/src/engine/wire/EngineWire.ts", stages: "E" },
  { path: "apps/web/src/components/chat/RunChat.tsx", stages: "C,types" },
  {
    path: "packages/client-runtime/src/data/projections/agentAdmission.ts",
    stages: "C,types",
  },
  { path: "apps/web/test/scenarios/areas/d-change/dsl.ts", stages: "" },
  { path: "apps/server/src/engine/pump/toCore.test.ts", stages: "" },
  { path: "apps/web/src/zerops/useZeropsAgentSignInDialog.tsx", stages: "C,types" },
  { path: "apps/web/src/components/zerops/ZeropsAgentSignIn.tsx", stages: "C,types" },
  { path: "apps/web/package.json", stages: "C,types" },
  { path: "apps/web/tsconfig.json", stages: "C,types" },
])("a lane validates only affected obligations for $path", ({ path, stages }) => {
  let steps: ReturnType<typeof selectGateSteps>["steps"] = [];
  expect(() => {
    steps = selectGateSteps(repositoryGraph, {
      withScenarios: true,
      comparison: "HEAD",
      existing: [path],
      paths: [path],
      // Rendering coverage is the builder's declaration; the app bundle is not a lane edge.
      inventory: stages.includes("C")
        ? [
            "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts",
            "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts",
            "apps/web/test/scenarios/areas/c-mate/projects-opening.scenario.ts",
          ]
        : [],
      smokeFiles: Object.keys(stateOnlySmoke),
      slots: 3,
    }).steps;
  }).not.toThrow();
  const output = steps
    .map((step) => `${step.name}: ${step.command} ${step.args.join(" ")}`)
    .join("\n");
  const lines = output.split("\n");
  const owner = path.split("/").slice(0, 2).join("/");
  const typechecks = lines.filter(
    (line) => line.startsWith("typecheck ") && !line.startsWith("typecheck scenarios:"),
  );
  const ownerName = owner === "apps/server" ? "t3" : `@t3tools/${owner.split("/")[1]}`;
  const dependents =
    owner === "packages/contracts"
      ? [
          "@t3tools/scripts",
          "@t3tools/shared",
          "@t3tools/client-runtime",
          "@t3tools/hq",
          "@t3tools/web",
          "@t3tools/desktop",
          "@t3tools/mobile",
          "t3",
          "t3code-relay",
        ]
      : owner === "packages/client-runtime"
        ? ["@t3tools/web", "@t3tools/desktop", "@t3tools/mobile", "t3", "t3code-relay"]
        : owner === "apps/web"
          ? ["t3"]
          : [];
  expect(typechecks.map((line) => line.split(":")[0]!.slice("typecheck ".length)).sort()).toEqual(
    [ownerName, ...dependents].sort(),
  );
  expect(output).not.toContain("scripts/chat-gate.ts --stages");
  const edited = lines.find((line) => line.startsWith("edited scenario files:"));
  if (stages.includes("C")) {
    expect(edited).toBe(
      "edited scenario files: vp test run --config test/scenarios/vitest.config.ts test/scenarios/areas/c-mate/admission.scenario.ts test/scenarios/areas/c-mate/chat.scenario.ts test/scenarios/areas/c-mate/projects-opening.scenario.ts",
    );
  } else expect(edited).toBeUndefined();
  if (stages.includes("A")) {
    expect(output).toContain("src/provider/Layers/ClaudeAdapter.test.ts");
    expect(
      chatGateTestFiles(
        sourceRoot,
        chatGateStages.filter((stage) => stage.id === "A"),
      ),
    ).toContain("apps/server/src/spi/replay/goldens.test.ts");
  }
  if (stages.includes("E")) {
    const directOwner = path.endsWith("/domain/decide.ts")
      ? "src/engine/domain/decide.test.ts"
      : path.endsWith("/engineCall.ts")
        ? "src/engine/bridge/calls.test.ts"
        : path.endsWith("/wire/EngineWire.ts")
          ? "src/engine/history/historyImport.test.ts"
          : "src/engine/outbox/crash.test.ts";
    expect(output).toContain(directOwner);
    expect(
      chatGateTestFiles(
        sourceRoot,
        chatGateStages.filter((stage) => stage.id === "E"),
      ),
    ).toContain(
      path.endsWith("/wire/EngineWire.ts")
        ? "apps/server/src/engine/history/historyImport.test.ts"
        : "apps/server/src/engine/outbox/crash.test.ts",
    );
  }
  if (path.endsWith("/d-change/dsl.ts")) {
    expect(output).not.toContain("test/scenarios/areas/d-change/review.scenario.ts");
    expect(edited).toBeUndefined();
  }
  const smoke = lines.find((line) => line.startsWith("state-only smoke:"));
  expect(smoke).toContain("engine-secret.scenario.ts");
  expect(smoke).toContain("engine-page.scenario.ts");
  expect(output).toContain("repository invariants:");
});

it("the CLI and immutable gate graph select identical obligations for a real source edit", () => {
  const path = "apps/web/src/components/chat/RunChat.tsx";
  const file = NodePath.join(repositoryFixture, path);
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(file, original + "\nexport const gateGraphWitness = true;\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const selection = selectGateSteps(repositoryGraph, {
      comparison: fixtureGit("rev-parse", "HEAD"),
      existing: [path],
      paths: [path],
      inventory: [],
      smokeFiles: Object.keys(stateOnlySmoke),
      slots: gateSlotCount(),
    });
    expect(
      result.stdout
        .split("\n")
        .filter(
          (line) =>
            line &&
            !/^(?:Scenario files:|Scenario |Related scenario cap:|Deferred scenario |Diff from )/u.test(
              line,
            ),
        ),
      "ASSERTION: the real CLI uses the same owning selection as the immutable graph",
    ).toEqual(
      selection.steps.map((step) => `${step.name}: ${step.command} ${step.args.join(" ")}`),
    );
  } finally {
    NodeFS.writeFileSync(file, original);
  }
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
    for (const name of gateRunnerFiles)
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
  if (path.startsWith("apps/web/test/") || path.startsWith("apps/server/")) {
    const selected = relatedFiles(root, [path], candidates);
    expect(selected).toContain(consumer);
    expect(selected).not.toContain("apps/web/test/scenarios/fakes/c-mate/chat.test.ts");
  } else {
    // The builder names the journey that renders this bundle input.
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list", "--scenarios", consumer],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Scenario ${consumer}; reason: explicit --scenarios`);
    expect(result.stdout).toContain("Scenario files: 1;");
    expect(result.stdout).not.toContain("apps/web/test/scenarios/fakes/c-mate/chat.test.ts");
    expect(relatedFiles(root, [path], candidates)).toEqual([]);
  }
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

// Decision: no test deleted or weakened; only lane selection changes; main CI runs everything.
it("environment row helpers select their rendered group surface through the scenario graph", () => {
  const scenario = "apps/web/test/scenarios/areas/b-menu/environmentIdentity.scenario.ts";
  const unrelated = "apps/web/test/scenarios/areas/a-signin/account.scenario.ts";
  expect(
    relatedFiles(
      repositoryFixture,
      ["apps/web/src/components/zerops/ZeropsGroupDetail.tsx"],
      [scenario, unrelated],
    ),
  ).toEqual([scenario]);
});

it("Decision: no app-bundle fallback; edges are declared or imported, never inferred from locators at runtime.", () => {
  const scenario = "apps/web/test/scenarios/areas/b-menu/environmentIdentity.scenario.ts";
  const graph = buildRelatedFileGraph(repositoryFixture, [scenario]);
  expect(graph.select(["apps/web/src/main.tsx", "apps/web/index.html"])).toEqual([]);
  expect(graph.select(["apps/web/src/components/chat/RunChat.tsx"])).toEqual([]);
});

it('Decision: no "run everything" fallback; selection stays graph-based.', () => {
  expect(
    relatedFiles(
      repositoryFixture,
      ["apps/web/src/components/zerops/ZeropsGroupDetail.tsx"],
      ["apps/web/test/scenarios/areas/a-signin/account.scenario.ts"],
    ),
  ).toEqual([]);
});

it("lane scenarios follow their own imports without the bundled app entry", () => {
  const file = NodePath.join(repositoryFixture, "apps/web/src/components/chat/RunChat.tsx");
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(file, original + "\nexport const gateSelect3Fixture = true;\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Scenario files: 0;");
    expect(result.stdout).not.toContain("edited scenario files:");
    expect(
      relatedFiles(
        repositoryFixture,
        ["apps/web/test/scenarios/areas/c-mate/dsl.ts"],
        ["apps/web/test/scenarios/areas/c-mate/chat.scenario.ts"],
      ),
    ).toEqual(["apps/web/test/scenarios/areas/c-mate/chat.scenario.ts"]);
    expect(
      relatedFiles(
        repositoryFixture,
        ["apps/web/src/main.tsx"],
        ["apps/web/test/scenarios/areas/c-mate/chat.scenario.ts"],
      ),
    ).toEqual([]);
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

it("builders name rendering scenarios without expanding their siblings", () => {
  const named = "apps/web/test/scenarios/areas/c-mate/projects-opening.scenario.ts";
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/gate-changed.ts", "--base", "HEAD", "--scenarios", named, "--list"],
    { cwd: repositoryFixture, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Scenario files: 1;");
  expect(result.stdout).toContain(named);
  expect(result.stdout).toContain("explicit --scenarios");
  expect(result.stdout).not.toContain("chat.scenario.ts");
});

it.each([
  [],
  ["scripts/gate-changed.test.ts"],
  ["apps/web/test/scenarios/areas/c-mate/missing.scenario.ts"],
  ["apps/web/test/scenarios/areas/../areas/c-mate/chat.scenario.ts"],
])("invalid explicit scenario files fail before any gate command ($0)", (...files) => {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["scripts/gate-changed.ts", "--base", "HEAD", "--list", "--scenarios", ...files],
    { cwd: repositoryFixture, encoding: "utf8" },
  );
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
});

it("named rendering scenarios join changed scenarios once and keep their owning stages", () => {
  const changed = "apps/web/test/scenarios/areas/d-change/review.scenario.ts";
  const named = "apps/web/test/scenarios/areas/c-mate/projects-opening.scenario.ts";
  const file = NodePath.join(repositoryFixture, changed);
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(file, original + "\nexport const gateSelect3Fixture = true;\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--scenarios", named, changed, named, "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Scenario files: 2;");
    expect(result.stdout).toContain(
      `Scenario ${changed}; reason: changed file; explicit --scenarios`,
    );
    expect(result.stdout).toContain(`Scenario ${named}; reason: explicit --scenarios`);
    expect(result.stdout).toContain("typecheck @t3tools/web:");
    expect(result.stdout).toContain("typecheck scenarios:");
    expect(result.stdout).toContain(
      "edited scenario files: vp test run --config test/scenarios/vitest.config.ts test/scenarios/areas/c-mate/projects-opening.scenario.ts test/scenarios/areas/d-change/review.scenario.ts",
    );
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

// Exercise the gate CLI with observable check commands, rather than testing its cache helpers.
it("Decision: no check is skipped for changed code; a passing receipt is reused only for an identical diff hash.", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-receipt-"));
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  try {
    for (const directory of ["scripts", "apps", "packages", "infra", "node_modules/.bin"])
      NodeFS.mkdirSync(NodePath.join(root, directory), { recursive: true });
    for (const name of gateRunnerFiles)
      NodeFS.copyFileSync(
        NodePath.join(import.meta.dirname, name),
        NodePath.join(root, "scripts", name),
      );
    NodeFS.symlinkSync(
      NodePath.resolve(import.meta.dirname, "node_modules"),
      NodePath.join(root, "scripts/node_modules"),
    );
    for (const name of [
      "check-guard-exceptions.ts",
      "check-runtime-cycles.ts",
      "check-test-sentences.ts",
    ])
      NodeFS.writeFileSync(
        NodePath.join(root, "scripts", name),
        'throw new Error("Receipt fixtures must stub guard commands without starting Node");',
      );
    // Keep the real CLI/receipt path, but do not boot a runtime for each observable guard.
    NodeFS.writeFileSync(
      NodePath.join(root, "node_modules/.bin/node"),
      `#!/bin/sh
case "$1" in
  scripts/check-guard-exceptions.ts|scripts/check-runtime-cycles.ts|scripts/check-test-sentences.ts)
    echo "\${1##*/}" >> checks.log ;;
  *) echo "Unexpected fixture command: node $*" >&2; exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    NodeFS.writeFileSync(
      NodePath.join(root, "node_modules/.bin/vp"),
      `#!/bin/sh
echo vp >> checks.log
case "$*" in
  *test/scenarios/vitest.config.ts*) printf '%s' "\${MATE_HQ_TEST_COMMAND-<unset>}" > "$GATE_FIXTURE_HQ_COMMAND_LOG" ;;
esac
exit "\${GATE_FIXTURE_FAIL:-0}"
`,
      { mode: 0o755 },
    );
    NodeFS.writeFileSync(NodePath.join(root, ".gitignore"), "node_modules/\nchecks.log\n");
    NodeFS.writeFileSync(NodePath.join(root, "README.md"), "before");
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "base");
    git("branch", "base");
    NodeFS.writeFileSync(NodePath.join(root, "README.md"), "after");
    const run = (args: string[] = [], fail = false, hqCommand?: string) =>
      NodeChildProcess.spawnSync(
        process.execPath,
        ["scripts/gate-changed.ts", "--base", "base", ...args],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            GATE_FIXTURE_FAIL: fail ? "9" : "0",
            GATE_FIXTURE_HQ_COMMAND_LOG: NodePath.join(root, "node_modules/hq-command.log"),
            MATE_HQ_TEST_COMMAND: hqCommand,
            // Dozens of real CLI launches share compilation, never gate results or Git state.
            NODE_COMPILE_CACHE: NodePath.join(root, "node_modules/.cache/node"),
          },
        },
      );
    const checks = () => NodeFS.readFileSync(NodePath.join(root, "checks.log"), "utf8");
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout.trim().split("\n").length).toBeLessThanOrEqual(15);
    expect(first.stdout).not.toContain("Selection ");
    const checked = checks();
    expect(checked.split("\n").filter(Boolean)).toEqual([
      "check-guard-exceptions.ts",
      "check-runtime-cycles.ts",
      "check-test-sentences.ts",
      "vp",
    ]);
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("reused receipt");
    expect(checks()).toBe(checked);
    const receiptPath = NodePath.join(root, ".gate-receipt.json");
    const receipt = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8"));
    expect(receipt.selectedStages.map((stage: { name: string }) => stage.name)).toEqual([
      "guard ledgers",
      "runtime cycle ratchet",
      "test sentence retention",
      "check touched files",
    ]);
    expect(receipt.results.map((result: { status: number }) => result.status)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0);
    expect(receipt.queueWaitMs).toBe(0);
    expect(changedPaths(root, "base")).toEqual(["README.md"]);
    git("add", "README.md");
    git("commit", "-qm", "lane");
    expect(run().stdout).toContain("reused receipt");
    expect(checks()).toBe(checked);
    // --list is a preview; --force must execute and replace an old passing receipt even on failure.
    expect(run(["--list"]).stdout).toContain("guard ledgers:");
    expect(checks()).toBe(checked);
    const verbose = run(["--verbose", "--force"]);
    expect(verbose.status).toBe(0);
    expect(verbose.stdout).toContain("Scenario files: 0; reason: documentation/comments only");
    const failed = run(["--force"], true);
    expect(failed.status).toBe(9);
    expect(failed.stderr).toContain("Full log:");
    expect(JSON.parse(NodeFS.readFileSync(receiptPath, "utf8")).results.at(-1).status).toBe(9);
    const checksBeforeRetry = checks();
    const retried = run();
    expect(retried.status, retried.stderr).toBe(0);
    expect(retried.stdout).not.toContain("reused receipt");
    expect(
      checks().slice(checksBeforeRetry.length),
      "ASSERTION: a gate re-run never repeats stages that passed on unchanged files",
    ).toBe("vp\n");
    const checksBeforeFull = checks();
    const full = run(["--full"]);
    expect(full.status, full.stderr).toBe(0);
    expect(checks().slice(checksBeforeFull.length).split("\n").filter(Boolean)).toEqual([
      "check-guard-exceptions.ts",
      "check-runtime-cycles.ts",
      "check-test-sentences.ts",
      "vp",
    ]);
    expect(run().stdout).toContain("reused receipt");
    // A corrupt or incomplete receipt is evidence to run, never evidence to skip.
    for (const content of [
      "{",
      JSON.stringify({ ...receipt, results: [] }),
      JSON.stringify({ ...receipt, selectedStages: [] }),
    ]) {
      NodeFS.writeFileSync(receiptPath, content);
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("reused receipt");
    }
    for (const mutate of [
      () => NodeFS.writeFileSync(NodePath.join(root, "README.md"), "dirty"),
      () => {
        NodeFS.writeFileSync(NodePath.join(root, "README.md"), "staged");
        git("add", "README.md");
      },
      () => NodeFS.writeFileSync(NodePath.join(root, "new.md"), "new"),
      () => NodeFS.writeFileSync(NodePath.join(root, "new.md"), "changed untracked"),
      () => NodeFS.renameSync(NodePath.join(root, "new.md"), NodePath.join(root, "renamed.md")),
      () => NodeFS.writeFileSync(NodePath.join(root, "binary.md"), Buffer.from([0, 255, 3])),
      () => NodeFS.writeFileSync(NodePath.join(root, "binary.md"), Buffer.from([0, 254, 3])),
      () => NodeFS.chmodSync(NodePath.join(root, "binary.md"), 0o755),
      () => NodeFS.symlinkSync("renamed.md", NodePath.join(root, "link.md")),
      () => {
        NodeFS.unlinkSync(NodePath.join(root, "link.md"));
        NodeFS.symlinkSync("missing.md", NodePath.join(root, "link.md"));
      },
      () => NodeFS.unlinkSync(NodePath.join(root, "README.md")),
    ]) {
      const before = checks();
      mutate();
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("reused receipt");
      expect(checks()).not.toBe(before);
      expect(run().stdout).toContain("reused receipt");
    }
    // Staging and committing additions must preserve the same diff identity as untracked bytes.
    const beforeCommit = checks();
    git("add", "--all", "--", "README.md", "renamed.md", "binary.md", "link.md");
    git("commit", "-qm", "lane additions");
    expect(run().stdout).toContain("reused receipt");
    expect(checks()).toBe(beforeCommit);
    // An unrelated main change and a clean rebase leave the lane diff and checks identical.
    git("checkout", "-qb", "lane");
    git("checkout", "-q", "base");
    NodeFS.writeFileSync(NodePath.join(root, "main.md"), "unrelated");
    git("add", "main.md");
    git("commit", "-qm", "main moved");
    git("checkout", "-q", "lane");
    git("rebase", "base");
    expect(run().stdout).toContain("reused receipt");
    expect(checks()).toBe(beforeCommit);
    // Decision: no test deleted or weakened; the receipt never masks a failure.
    // Selection inputs can change on main without changing the lane patch or command list.
    for (const path of [
      "scripts/gate-timing-reporter.ts",
      "scripts/state-smoke-cases.ts",
      "scripts/gate-changed.ts",
      "pnpm-lock.yaml",
      "vite.config.ts",
      "scripts/package.json",
    ]) {
      const before = checks();
      const stages = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8")).selectedStages;
      git("checkout", "-q", "base");
      NodeFS.appendFileSync(
        NodePath.join(root, path),
        path.endsWith(".json")
          ? '{"name":"scripts","type":"module"}'
          : path.endsWith(".ts")
            ? "\n// selection revision\n"
            : "# lock revision\n",
      );
      if (path === "pnpm-lock.yaml") installLockfile(root);
      git("add", path);
      git("commit", "-qm", "selection inputs changed");
      git("checkout", "-q", "lane");
      git("rebase", "base");
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, `changed selection input: ${path}`).not.toContain("reused receipt");
      expect(checks()).not.toBe(before);
      expect(JSON.parse(NodeFS.readFileSync(receiptPath, "utf8")).selectedStages).toEqual(stages);
      expect(run().stdout).toContain("reused receipt");
    }
    const scenario = "apps/web/test/scenarios/areas/b-menu/pick.scenario.ts";
    git("checkout", "-q", "base");
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, scenario)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, scenario), "export {};\n");
    git("add", scenario);
    git("commit", "-qm", "scenario inventory");
    git("checkout", "-q", "lane");
    git("rebase", "base");
    NodeFS.mkdirSync(NodePath.join(root, "apps/web/test/scenarios/areas/c-mate"), {
      recursive: true,
    });
    const explicit = run(["--scenarios", scenario]);
    expect(explicit.status, explicit.stderr).toBe(0);
    expect(explicit.stdout).not.toContain("reused receipt");
    expect(explicit.stdout).toContain("ok edited scenario files");
    const queuedReceipt = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8"));
    expect(queuedReceipt.queueWaitMs).toBeGreaterThanOrEqual(0);
    expect(
      queuedReceipt.results.find((step: { name: string }) => step.name === "browser/scenario slot")
        .durationMs,
    ).toBe(0);
    expect(queuedReceipt.durationMs).toBeGreaterThanOrEqual(
      queuedReceipt.results.reduce(
        (sum: number, step: { durationMs: number }) => sum + step.durationMs,
        0,
      ),
    );
    expect(run(["--scenarios", scenario]).stdout).toContain("reused receipt");
    const commandLog = NodePath.join(root, "node_modules/hq-command.log");
    for (const hqCommand of ["node /fixtures/hq-a.ts", "node /fixtures/hq-b.ts", undefined]) {
      NodeFS.rmSync(commandLog);
      const changedHq = run(["--scenarios", scenario], false, hqCommand);
      expect(changedHq.status, changedHq.stderr).toBe(0);
      expect(
        changedHq.stdout,
        "ASSERTION: changing the HQ test command runs scenarios against the selected backend",
      ).toContain("ok edited scenario files");
      expect(NodeFS.readFileSync(commandLog, "utf8")).toBe(hqCommand ?? "<unset>");
      expect(run(["--scenarios", scenario], false, hqCommand).stdout).toContain("reused receipt");
    }
    expect(run().stdout).not.toContain("reused receipt");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("BigInt source edits select checks while comments alone select none", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-bigint-"));
  const path = "asset.ts";
  const file = NodePath.join(root, path);
  const git = (...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  try {
    NodeFS.writeFileSync(file, "export const bytes = 1n;\n");
    git("init", "-q");
    git("config", "user.name", "Gate fixture");
    git("config", "user.email", "gate@example.test");
    git("add", ".");
    git("commit", "-qm", "BigInt fixture");
    for (const [source, expected] of [
      ["// retained bytes\nexport const bytes = 1n;\n", []],
      ["export const bytes = 2n;\n", [path]],
      ['export const bytes = "1";\n', [path]],
    ] as const) {
      NodeFS.writeFileSync(file, source);
      expect(
        () => meaningfulChanges(root, "HEAD", [path]),
        "ASSERTION: a BigInt literal cannot prevent the gate from selecting checks",
      ).not.toThrow();
      expect(meaningfulChanges(root, "HEAD", [path]).paths).toEqual(expected);
    }
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("the default laptop gate omits selected browser scenarios and fixed smoke", () => {
  const scenario = "apps/web/test/scenarios/areas/d-change/review.scenario.ts";
  const { steps } = selectGateSteps(repositoryGraph, {
    comparison: "HEAD",
    existing: [scenario],
    paths: [scenario],
    inventory: [scenario],
    smokeFiles: Object.keys(stateOnlySmoke),
    slots: 3,
  });
  expect(
    steps.filter((step) =>
      ["edited scenario files", "state-only smoke", "state-only oracle smoke"].includes(step.name),
    ),
    "ASSERTION: default laptop completion never executes browser scenarios or fixed smoke",
  ).toEqual([]);
});

it.each(["changed", "deleted"])(
  "CI keeps every affected scenario beyond the local cap for a %s dependency",
  (change) => {
    const dependency = "apps/web/src/sharedWitness.ts";
    areaFixture([[dependency, scenarioAreas]], (root) => {
      for (const directory of ["packages", "infra"])
        NodeFS.mkdirSync(NodePath.join(root, directory));
      const git = (...args: string[]) => {
        const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
        if (result.status !== 0) throw new Error(result.stderr);
      };
      git("init", "-q");
      git("config", "user.name", "Gate fixture");
      git("config", "user.email", "gate@example.test");
      git("add", ".");
      git("commit", "-qm", "base");
      const path = NodePath.join(root, dependency);
      if (change === "deleted") NodeFS.rmSync(path);
      else NodeFS.writeFileSync(path, "export const changed = true;");
      const expected = scenarioAreas
        .map((area) => `apps/web/test/scenarios/areas/${area}/journey.scenario.ts`)
        .sort();
      expect(
        affectedScenarioFiles(root, "HEAD"),
        "ASSERTION: required CI selection never caps graph-related scenario files",
      ).toEqual(expected);
      expect(affectedScenarioFiles(root, "4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toEqual(
        expected,
      );
      // Explicit requests survive without a dependency edge and deduplicate an edited file.
      const edited = expected[0]!;
      NodeFS.appendFileSync(NodePath.join(root, edited), "\nexport const edited = true;");
      expect(affectedScenarioFiles(root, "HEAD", [edited, edited])).toEqual(expected);
    });
  },
);

const smokeTitles = [
  "cold direct conversation URL opens the named Mate and its history",
  "reload restores history",
  "sending a message puts it in the durable visible conversation",
  "approve an agent command and see it resolve",
  "a secret the person gives never reaches the Mate's records or its agent",
  "a published page that navigates itself by script sends nothing and is never shown",
];

it("L2 runs invariants, touched typechecks, owned units, edited scenarios and fixed state-only smoke in order", () => {
  const path = "packages/contracts/src/engine.ts";
  const selected = selectGateSteps(repositoryGraph, {
    withScenarios: true,
    comparison: "HEAD",
    existing: [path, "apps/web/test/scenarios/areas/d-change/review.scenario.ts"],
    paths: [path, "apps/web/test/scenarios/areas/d-change/review.scenario.ts"],
    inventory: ["apps/web/test/scenarios/areas/d-change/review.scenario.ts"],
    smokeFiles: Object.keys(stateOnlySmoke),
    slots: 3,
  });
  const output = selected.steps
    .map((step) => `${step.name}: ${step.command} ${step.args.join(" ")}`)
    .join("\n");
  const lines = output.split("\n");
  const index = (prefix: string) => lines.findIndex((line) => line.startsWith(prefix));
  expect(
    index("repository invariants:"),
    "ASSERTION: invariants run before typechecks",
  ).toBeGreaterThan(-1);
  expect(index("typecheck @t3tools/contracts:")).toBeGreaterThan(index("repository invariants:"));
  expect(index("related root tests:")).toBeGreaterThan(index("typecheck @t3tools/contracts:"));
  const smoke = lines.find((line) => line.startsWith("state-only smoke:"));
  expect(index("state-only smoke:")).toBeGreaterThan(index("related root tests:"));
  expect(smoke).toContain("chat.scenario.ts");
  expect(smoke).toContain("engine-secret.scenario.ts");
  expect(smoke).toContain("engine-page.scenario.ts");
  expect(smoke, "ASSERTION: fixed approval smoke clicks the person's browser control").toContain(
    "(?:approve an agent command and see it resolve)$",
  );
  expect(smoke).toContain(smokeTitles.map((title) => `(?:${title})$`).join("|"));
  expect(smoke).not.toContain("first open crosses the door and OAuth");
  expect(lines.some((line) => line.startsWith("state-only oracle smoke:"))).toBe(false);
  const edited = lines.find((line) => line.startsWith("edited scenario files:"));
  expect(edited).toBe(
    "edited scenario files: vp test run --config test/scenarios/vitest.config.ts test/scenarios/areas/d-change/review.scenario.ts",
  );
  const typeIndexes = lines.flatMap((line, i) => (line.startsWith("typecheck ") ? [i] : []));
  const unitIndexes = lines.flatMap((line, i) => (line.startsWith("related ") ? [i] : []));
  expect(Math.min(...typeIndexes)).toBeGreaterThan(index("repository invariants:"));
  expect(Math.min(...unitIndexes)).toBeGreaterThan(Math.max(...typeIndexes));
  expect(index("edited scenario files:")).toBeGreaterThan(Math.max(...unitIndexes));
  expect(index("state-only smoke:")).toBeGreaterThan(index("edited scenario files:"));
  for (const guard of ["guard ledgers:", "runtime cycle ratchet:", "test sentence retention:"])
    expect(index(guard)).toBeLessThan(index("repository invariants:"));
  expect(output).not.toContain("scripts/chat-gate.ts --stages");
});

it.each(["apps/web/package.json", "package.json", "pnpm-lock.yaml"])(
  "L2 manifest rule keeps %s on touched typechecks and explicit owned tests",
  (path) => {
    const file = NodePath.join(repositoryFixture, path);
    const original = NodeFS.readFileSync(file, "utf8");
    const ownedTest = "scripts/gate-timing-reporter.test.ts";
    const ownedOriginal = NodeFS.readFileSync(NodePath.join(sourceRoot, ownedTest), "utf8");
    NodeFS.writeFileSync(
      NodePath.join(repositoryFixture, ownedTest),
      ownedOriginal + "\nexport const manifestOwnedWitness = true;\n",
    );
    try {
      NodeFS.writeFileSync(
        file,
        path.endsWith(".json")
          ? original.replace(/\}\s*$/u, ', "l2Witness": true\n}\n')
          : original + "\n# L2 witness\n",
      );
      if (path === "pnpm-lock.yaml") installLockfile(repositoryFixture);
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
        { cwd: repositoryFixture, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("typecheck @t3tools/web:");
      const unitLines = result.stdout.split("\n").filter((line) => line.startsWith("related "));
      expect(unitLines.length).toBeGreaterThan(0);
      expect(
        unitLines.join("\n"),
        "ASSERTION: manifests never trigger Vitest's full-suite --changed fallback",
      ).not.toContain("--changed");
      expect(unitLines.join("\n")).toContain(ownedTest);
      if (path !== "apps/web/package.json") {
        expect(unitLines).toHaveLength(1);
        expect(unitLines[0]).toBe(`related root tests: vp test run ${ownedTest}`);
      } else {
        expect(unitLines.some((line) => line.startsWith("related @t3tools/web:"))).toBe(true);
        expect(unitLines.some((line) => line.startsWith("related t3:"))).toBe(false);
      }
      expect(result.stdout).not.toContain("vp run -r");
    } finally {
      NodeFS.writeFileSync(file, original);
      if (path === "pnpm-lock.yaml") installLockfile(repositoryFixture);
      NodeFS.rmSync(NodePath.join(repositoryFixture, ownedTest));
    }
  },
);

it.each(["added", "comment-only addition", "renamed", "deleted"])(
  "a %s source file selects repository-scanning invariants without an import edge",
  (change) => {
    const oldPath = "apps/web/src/components/zerops/ZeropsGitChangeRow.tsx";
    const newPath = "apps/web/src/components/zerops/GateUnclaimedRow.tsx";
    try {
      if (change === "added")
        NodeFS.writeFileSync(NodePath.join(repositoryFixture, newPath), "export {};\n");
      if (change === "comment-only addition")
        NodeFS.writeFileSync(
          NodePath.join(repositoryFixture, newPath),
          "// Newly added component.\n",
        );
      if (change === "renamed") fixtureGit("mv", oldPath, newPath);
      if (change === "deleted") fixtureGit("rm", oldPath);
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
        { cwd: repositoryFixture, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      const scanners = result.stdout
        .split("\n")
        .find((line) => line.startsWith("repository invariants:"));
      expect(scanners, "ASSERTION: tree scans must run independently of import edges").toContain(
        "scripts/surface-manifest.test.ts",
      );
      expect(scanners).toContain("scripts/mate-zone-architecture.test.ts");
      expect(scanners).not.toContain("--changed");
      expect(scanners).not.toContain("scripts/gate-changed.test.ts");
    } finally {
      fixtureGit("reset", "--hard", "HEAD");
      NodeFS.rmSync(NodePath.join(repositoryFixture, newPath), { force: true });
    }
  },
);

it.each([
  "apps/server/src/zerops/mcp/McpServers.ts",
  "packages/client-runtime/src/zerops/agentOwnership.ts",
  "apps/server/src/zerops/engineOverview.ts",
])("an import-edge repair selects the architecture scanner: %s", (path) => {
  const file = NodePath.join(repositoryFixture, path);
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.appendFileSync(file, '\nimport "./gate-boundary-witness.ts";\n');
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const scanner = result.stdout
      .split("\n")
      .find((line) => line.startsWith("repository invariants:"));
    expect(scanner, "ASSERTION: changed import edges must run architecture invariants").toContain(
      "scripts/mate-zone-architecture.test.ts",
    );
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

it("shared dependency sources are read once per selection regardless of reader count", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-shared-"));
  const sources = {
    "index.ts": 'export * from "./owner.ts";',
    "owner.ts": "export const Owner = 1;",
    ...Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `reader-${index}.test.ts`,
        'import * as Shared from "./index.ts";',
      ]),
    ),
  };
  for (const [file, source] of Object.entries(sources))
    NodeFS.writeFileSync(NodePath.join(root, file), source);
  const mutableFS = NodeModule.createRequire(import.meta.url)("node:fs") as typeof NodeFS;
  const read = vi.spyOn(mutableFS, "readFileSync");
  NodeModule.syncBuiltinESMExports();
  try {
    const readers = Object.keys(sources).filter((file) => file.endsWith(".test.ts"));
    expect(relatedFiles(root, ["owner.ts"], readers)).toEqual(readers.sort());
    const reads = read.mock.calls.map(([file]) => String(file));
    for (const file of Object.keys(sources))
      expect(
        reads.filter((path) => path === NodePath.join(root, file)).length,
        "ASSERTION: shared dependency sources are read once per selection",
      ).toBeLessThanOrEqual(1);
  } finally {
    read.mockRestore();
    NodeModule.syncBuiltinESMExports();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("an immutable related-file graph selects independent changes without reading sources again", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-snapshot-"));
  const sources = {
    "index.ts": 'export * from "./owner.ts"; export * from "./other.ts";',
    "owner.ts": "export const Owner = 1;",
    "other.ts": "export const Other = 2;",
    "owner.test.ts": 'import { Owner } from "./index.ts";',
    "other.test.ts": 'import { Other } from "./index.ts";',
    "namespace.test.ts": 'import * as All from "./index.ts";',
  };
  const fs = NodeModule.createRequire(import.meta.url)("node:fs") as typeof NodeFS;
  const read = vi.spyOn(fs, "readFileSync");
  NodeModule.syncBuiltinESMExports();
  try {
    for (const [path, text] of Object.entries(sources))
      NodeFS.writeFileSync(NodePath.join(root, path), text);
    const graph = buildRelatedFileGraph(root, [
      "owner.test.ts",
      "other.test.ts",
      "namespace.test.ts",
    ]);
    read.mockClear();
    expect(graph.select(["owner.ts"])).toEqual(["namespace.test.ts", "owner.test.ts"]);
    expect(graph.select(["other.ts"])).toEqual(["namespace.test.ts", "other.test.ts"]);
    expect(graph.select(["index.ts"])).toEqual([
      "namespace.test.ts",
      "other.test.ts",
      "owner.test.ts",
    ]);
    expect(
      read.mock.calls.length,
      "ASSERTION: selecting from an immutable graph performs no source reads",
    ).toBe(0);
    NodeFS.rmSync(NodePath.join(root, "owner.ts"));
    expect(graph.select(["owner.ts"])).toEqual(["namespace.test.ts", "owner.test.ts"]);
    expect(graph.select(["README.md"])).toEqual([]);
  } finally {
    read.mockRestore();
    NodeModule.syncBuiltinESMExports();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("named barrel imports select only readers of the changed export owner", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-barrel-"));
  const write = (file: string, text: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, file), text);
  };
  try {
    write(
      "packages/fixture/package.json",
      JSON.stringify({ name: "@fixture/contracts", exports: { ".": "./src/index.ts" } }),
    );
    write(
      "packages/fixture/src/index.ts",
      'export * from "./owner.ts"; export * from "./other.ts";',
    );
    write(
      "packages/fixture/src/owner.ts",
      "export const Owner = 1; export type OwnerRecord = string;",
    );
    write("packages/fixture/src/other.ts", "export const Other = 2;");
    write("owner.test.ts", 'import { Owner as Alias } from "@fixture/contracts";');
    write("type.test.ts", 'import type { OwnerRecord } from "@fixture/contracts";');
    write("other.test.ts", 'import { Other } from "@fixture/contracts";');
    write("namespace.test.ts", 'import * as Contracts from "@fixture/contracts";');
    write("sideEffect.test.ts", 'import "@fixture/contracts";');
    const files = [
      "owner.test.ts",
      "type.test.ts",
      "other.test.ts",
      "namespace.test.ts",
      "sideEffect.test.ts",
    ];
    expect(
      relatedFiles(root, ["packages/fixture/src/owner.ts"], files),
      "ASSERTION: unrelated exports do not own the changed contract",
    ).toEqual(["namespace.test.ts", "owner.test.ts", "sideEffect.test.ts", "type.test.ts"]);
    expect(
      relatedFiles(root, ["packages/fixture/src/owner.ts"], files, new Map(), 1),
      "ASSERTION: a direct namespace or side-effect barrel import retains its exported owner",
    ).toEqual(["namespace.test.ts", "owner.test.ts", "sideEffect.test.ts", "type.test.ts"]);
    expect(relatedFiles(root, ["packages/fixture/src/index.ts"], files)).toEqual([...files].sort());
    write(
      "packages/fixture/src/index.ts",
      'export { Owner as Published } from "./owner.ts"; export * from "./other.ts";',
    );
    write("owner.test.ts", 'import { Published } from "@fixture/contracts";');
    expect(relatedFiles(root, ["packages/fixture/src/owner.ts"], files)).toContain("owner.test.ts");
    write("packages/fixture/src/index.ts", 'import "./owner.ts"; export * from "./other.ts";');
    expect(relatedFiles(root, ["packages/fixture/src/owner.ts"], ["other.test.ts"])).toEqual([
      "other.test.ts",
    ]);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("L2 runs owned scenario-driver units through their existing project before scenarios", () => {
  const path = "apps/web/test/scenarios/fakes/mate.test.ts";
  const file = NodePath.join(repositoryFixture, path);
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.appendFileSync(file, "\nexport const l2DriverWitness = true;\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list", "--with-scenarios"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.split("\n");
    const driver = lines.findIndex((line) => line.startsWith("related scenario-driver units:"));
    expect(
      driver,
      "ASSERTION: an edited driver unit must run in its owning project",
    ).toBeGreaterThan(-1);
    expect(lines[driver]).toContain("vp test run --config test/scenarios/vitest.config.ts");
    expect(lines[driver]).toContain("test/scenarios/fakes/mate.test.ts");
    const types = lines.flatMap((line, index) => (line.startsWith("typecheck ") ? [index] : []));
    expect(driver).toBeGreaterThan(Math.max(...types));
    const slot = lines.findIndex((line) => line.startsWith("browser/scenario slot:"));
    expect(slot).toBeGreaterThan(Math.max(...types));
    expect(slot).toBeLessThan(driver);
    expect(lines.findIndex((line) => line.startsWith("state-only smoke:"))).toBeGreaterThan(driver);
    expect(lines.find((line) => line.startsWith("related @t3tools/web:")) ?? "").not.toContain(
      "test/scenarios/fakes/mate.test.ts",
    );
    expect(lines.some((line) => line.startsWith("edited scenario files:"))).toBe(false);
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

it.each([
  ["a depth-2 importer", 'import "./bridge.ts";', 'import "./owner.ts";'],
  ["a mock-only reader", 'vi.mock("./owner.ts", () => ({}));', "export {};"],
  ["a transitive mock reader", 'import "./bridge.ts";', 'vi.mock("./owner.ts", () => ({}));'],
])("the gate selects %s of a changed module", (_case, reader, bridge) => {
  const directory = "apps/web/src/gate-selection-witness";
  const fixtures = {
    [`${directory}/owner.ts`]: "export const value = 1;",
    [`${directory}/bridge.ts`]: bridge,
    [`${directory}/reader.test.ts`]: reader,
    [`${directory}/unrelated.test.ts`]: "export {};",
  };
  const head = fixtureGit("rev-parse", "HEAD");
  try {
    for (const [path, content] of Object.entries(fixtures)) {
      const file = NodePath.join(repositoryFixture, path);
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, content);
    }
    fixtureGit("add", ...Object.keys(fixtures));
    fixtureGit("commit", "-qm", "unit dependency fixture");
    NodeFS.appendFileSync(
      NodePath.join(repositoryFixture, `${directory}/owner.ts`),
      "\nexport const added = 2;\n",
    );
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const units = result.stdout
      .split("\n")
      .filter((line) => line.startsWith("related "))
      .join("\n");
    expect(
      units,
      "ASSERTION: every importing or mocking unit reader runs for its changed owner",
    ).toContain("src/gate-selection-witness/reader.test.ts");
    expect(units).not.toContain("unrelated.test.ts");
  } finally {
    fixtureGit("reset", "--hard", head);
    NodeFS.rmSync(NodePath.join(repositoryFixture, directory), { recursive: true, force: true });
  }
});

it("Decision: L2 selects changed modules' same-name tests and every importing or mocking unit reader at any depth, and preserves normal package parallelism", () => {
  const head = fixtureGit("rev-parse", "HEAD");
  const fixtures = {
    "packages/contracts/src/engine.spec.ts": "export {};",
    "packages/gate-hop-consumer/package.json": JSON.stringify({
      name: "@fixture/direct",
      scripts: { typecheck: "tsc --noEmit" },
      dependencies: { "@t3tools/contracts": "workspace:*" },
    }),
    "packages/gate-hop-consumer/src/direct.test.ts":
      'import { ConversationId } from "@t3tools/contracts";',
    "packages/gate-hop-consumer/src/reader.ts":
      'import { ConversationId } from "@t3tools/contracts"; export { ConversationId };',
    "packages/gate-hop-downstream/package.json": JSON.stringify({
      name: "@fixture/transitive",
      scripts: { typecheck: "tsc --noEmit" },
      dependencies: { "@fixture/direct": "workspace:*" },
    }),
    "packages/gate-hop-downstream/src/transitive.test.ts":
      'import { ConversationId } from "../../gate-hop-consumer/src/reader.ts";',
  };
  try {
    for (const [path, content] of Object.entries(fixtures)) {
      const file = NodePath.join(repositoryFixture, path);
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, content);
    }
    fixtureGit("add", ...Object.keys(fixtures));
    fixtureGit("commit", "-qm", "transitive ownership fixture");
    NodeFS.appendFileSync(
      NodePath.join(repositoryFixture, "packages/contracts/src/engine.ts"),
      "\nexport const transitiveWitness = true;\n",
    );
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const units = result.stdout.split("\n").filter((line) => line.startsWith("related "));
    expect(
      units.join("\n").includes("gate-hop-downstream/src/transitive.test.ts"),
      "ASSERTION: a contracts edit selects its transitive test readers",
    ).toBe(true);
    expect(units.join("\n")).toContain("gate-hop-consumer/src/direct.test.ts");
    expect(units.join("\n")).toContain("packages/contracts/src/engine.spec.ts");
    expect(result.stdout).toContain("typecheck @fixture/direct:");
    expect(result.stdout).toContain("typecheck @fixture/transitive:");
    expect(units.find((line) => line.startsWith("related t3:"))).toContain(
      "vp test run --fileParallelism ",
    );
    for (const line of units) {
      expect(line).not.toMatch(/--(?:no-file-parallelism|maxWorkers|minWorkers)/u);
    }
  } finally {
    fixtureGit("reset", "--hard", head);
    for (const path of Object.keys(fixtures))
      NodeFS.rmSync(NodePath.join(repositoryFixture, path), { force: true });
    for (const directory of ["packages/gate-hop-consumer", "packages/gate-hop-downstream"])
      NodeFS.rmSync(NodePath.join(repositoryFixture, directory), { recursive: true, force: true });
  }
});

it.each([
  [
    "packages/client-runtime/src/zerops/hq/client.ts",
    "oxlint-plugin-t3code/rules/no-remote-io-outside-data-layer.test.ts",
  ],
  [
    "apps/hq/src/environmentNavigation.ts",
    "test/scenarios/areas/b-menu/environmentIdentity.scenario.ts",
  ],
])("the gate lists the real consumer of a changed repository input (%s)", (input, consumer) => {
  const file = NodePath.join(repositoryFixture, input);
  const original = NodeFS.readFileSync(file, "utf8");
  try {
    NodeFS.writeFileSync(file, original + "\nexport const gateSelectionRegression = true;\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout, `ASSERTION: changed ${input} selects its real consumer`).toContain(
      consumer,
    );
  } finally {
    NodeFS.writeFileSync(file, original);
  }
});

it("related rendering scenarios run nearest first within the cap and log every overflow", () => {
  const head = fixtureGit("rev-parse", "HEAD");
  const owner = "apps/web/src/lib/gateScenarioSelection.ts";
  const helper = "apps/web/src/lib/gateScenarioHelper.ts";
  const area = "apps/web/test/scenarios/areas/b-menu";
  const near = Array.from({ length: 8 }, (_, i) => `${area}/gate-near-${i}.scenario.ts`);
  const far = `${area}/gate-far.scenario.ts`;
  const files = {
    [owner]: "export const witness = 1;",
    [helper]:
      "import { witness } from './gateScenarioSelection.ts'; export const doubled = witness * 2;",
    ...Object.fromEntries(
      near.map((file) => [
        file,
        "import { witness } from '../../../../src/lib/gateScenarioSelection.ts';",
      ]),
    ),
    [far]: "import { doubled } from '../../../../src/lib/gateScenarioHelper.ts';",
  };
  try {
    for (const [file, source] of Object.entries(files)) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(repositoryFixture, file)), {
        recursive: true,
      });
      NodeFS.writeFileSync(NodePath.join(repositoryFixture, file), source);
    }
    fixtureGit("add", ...Object.keys(files));
    fixtureGit("commit", "-qm", "scenario distance fixture");
    NodeFS.appendFileSync(NodePath.join(repositoryFixture, owner), "\nexport const changed = 2;\n");
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const selected = result.stdout
      .split("\n")
      .filter((line) => line.startsWith("Scenario apps/"))
      .map((line) => line.split(";")[0]!.slice("Scenario ".length));
    expect(
      selected,
      "ASSERTION: eight nearest rendering scenarios run, without a full-suite fallback",
    ).toEqual(near);
    expect(result.stdout).toContain(`Deferred scenario ${far}; import graph distance 2`);
    expect(result.stdout).toContain("Related scenario cap: 8; selected 8; overflow 1");
  } finally {
    fixtureGit("reset", "--hard", head);
    for (const file of Object.keys(files))
      NodeFS.rmSync(NodePath.join(repositoryFixture, file), { force: true });
  }
});

it("a filesystem guard without a declaration stops gate selection with its owning path", () => {
  const file = "scripts/undeclared-source-guard.test.ts";
  const path = NodePath.join(repositoryFixture, file);
  try {
    NodeFS.writeFileSync(
      path,
      "import * as fs from 'node:fs'; fs.readFileSync('packages/client-runtime/src/zerops/hq/client.ts');",
    );
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      ["scripts/gate-changed.ts", "--base", "HEAD", "--list"],
      { cwd: repositoryFixture, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr, "ASSERTION: undeclared source guards fail before checks run").toContain(
      `${file}: filesystem reads need a declaration`,
    );
  } finally {
    NodeFS.rmSync(path, { force: true });
  }
});

it("a deleted test that read the filesystem needs no declaration, since it never runs again", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-deleted-"));
  const file = "deleted-source-guard.test.ts";
  try {
    // The test exists only at the base: the lane deleted it.
    const graph = buildRelatedFileGraph(
      root,
      [],
      new Map([[file, "import * as fs from 'node:fs'; fs.readFileSync('owner.ts');"]]),
    );
    expect(
      () => graph.inputFiles([file], []),
      "ASSERTION: a deleted guard's base reads need no declaration",
    ).not.toThrow();
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
