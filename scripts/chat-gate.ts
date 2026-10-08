#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- host boundary gate runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Conservative selection: the client meets the server over shared wire contracts. */
export function selectsChatGate(paths: ReadonlyArray<string>): boolean {
  return paths.some((path) => {
    if (path.endsWith(".md")) return false;
    if (/^apps\/web\/test\/scenarios\/(?:areas|fakes)\/(?!c-mate\/)[^/]+\//u.test(path))
      return false;
    if (/^apps\/web\/src\/.*\.test\.[cm]?[jt]sx?$/u.test(path)) return false;
    return (
      /^(?:apps\/server\/src\/|apps\/web\/(?:src\/|test\/scenarios\/)|packages\/(?:contracts|client-runtime|shared|effect-codex-app-server|effect-acp)\/)/u.test(
        path,
      ) ||
      /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|vite\.config\.ts|apps\/(?:server|web)\/(?:package\.json|vite\.config\.ts|tsconfig\.json)|scripts\/(?:chat-gate(?:-reporter)?|gate-changed)(?:\.test)?\.ts|\.github\/workflows\/ci\.yml)$/u.test(
        path,
      )
    );
  });
}

export interface ChatGateCommand {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ChatGateStage {
  readonly id: string;
  readonly name: string;
  readonly commands: ReadonlyArray<ChatGateCommand>;
}

export const chatGateStages: ReadonlyArray<ChatGateStage> = [
  {
    id: "A",
    name: "A: provider goldens",
    commands: [
      {
        cwd: "apps/server",
        args: [
          "test",
          "run",
          "src/spi/replay/goldens.test.ts",
          "--allowOnly=false",
          "--reporter=default",
          "--reporter=../../scripts/chat-gate-reporter.ts",
        ],
      },
    ],
  },
  {
    id: "C",
    name: "B: client wire journeys (C)",
    commands: [
      {
        cwd: "apps/web",
        args: [
          "test",
          "run",
          "--config",
          "test/scenarios/vitest.config.ts",
          "--project",
          "scenarios",
          "test/scenarios/areas/c-mate",
          "--allowOnly=false",
          "--reporter=default",
          "--reporter=../../scripts/chat-gate-reporter.ts",
        ],
      },
    ],
  },
  {
    // The same journeys against a Mate whose conversation runs on the engine's wire: their
    // sentences hold for both engines (engine.md, "Running beside the old engine").
    id: "C-engine",
    name: "B: client wire journeys on the engine (C)",
    commands: [
      {
        cwd: "apps/web",
        args: [
          "test",
          "run",
          "--config",
          "test/scenarios/vitest.config.ts",
          "--project",
          "scenarios-engine",
          "test/scenarios/areas/c-mate/chat.scenario.ts",
          "--allowOnly=false",
          "--reporter=default",
          "--reporter=../../scripts/chat-gate-reporter.ts",
        ],
      },
    ],
  },
  {
    // The engine's proof on the harness's fixed seeds (deep seeds run before an engine release,
    // never here), and the running engine end to end on every driver.
    id: "E",
    name: "E: engine proof",
    commands: [
      {
        cwd: "apps/server",
        args: [
          "test",
          "run",
          "src/engine/domain/decide.model.test.ts",
          "src/engine/outbox/crash.test.ts",
          "src/engine/history/historyImport.test.ts",
          "src/zerops/crew/engine/importV1Crew.test.ts",
          "src/engine/engine.sim.test.ts",
          "src/engine/engine.pump.test.ts",
          "--allowOnly=false",
          "--reporter=default",
          "--reporter=../../scripts/chat-gate-reporter.ts",
        ],
      },
    ],
  },
  {
    // The crew's journeys on a Mate whose crew runs on the engine; the unit suite runs the same
    // sentences on V1's crew, so each one holds on both. The files' V1-only tests (skipped off the V1
    // world: V1's own mechanism) skip here by design, so this run reports without the certifying reporter.
    id: "F",
    name: "F: crew journeys on the engine",
    commands: [
      {
        cwd: "apps/server",
        env: { CREW_WORLD: "engine" },
        args: [
          "test",
          "run",
          "src/zerops/crew/CrewEngine",
          "src/zerops/crew/registerCrewRpc.test.ts",
          "--allowOnly=false",
        ],
      },
    ],
  },
  {
    id: "types",
    name: "Typecheck: wire consumers",
    commands: [
      ...["apps/server", "packages/contracts", "packages/client-runtime", "apps/web"].map(
        (cwd) => ({
          cwd,
          args: ["exec", "tsc", "--noEmit", "--incremental"],
        }),
      ),
      {
        cwd: ".",
        args: [
          "exec",
          "tsc",
          "--noEmit",
          "--incremental",
          "-p",
          "apps/web/test/scenarios/areas/c-mate/tsconfig.json",
        ],
      },
    ],
  },
];

/** Lane obligations are independent; CI retains the conservative selector and full default. */
export function selectLaneChatStages(paths: ReadonlyArray<string>, areas: ReadonlyArray<string>) {
  const selected = new Set<string>();
  if (areas.includes("c-mate")) {
    selected.add("C");
    selected.add("C-engine");
    selected.add("types");
  }
  for (const path of paths) {
    if (/\.test\.[cm]?[jt]sx?$/u.test(path)) {
      for (const stage of chatGateStages)
        if (
          stage.commands.some((command) =>
            command.args.some((arg) => NodePath.posix.join(command.cwd, arg) === path),
          )
        )
          selected.add(stage.id);
      continue;
    }
    if (!selectsChatGate([path])) continue;
    if (
      /^(?:apps\/server\/src\/(?:provider|spi)\/|packages\/(?:effect-acp|effect-codex-app-server)\/)/u.test(
        path,
      )
    ) {
      selected.add("A");
    } else if (/^(?:apps\/server\/src\/engine\/|packages\/contracts\/src\/engine)/u.test(path)) {
      selected.add("E");
      // Engine records and call metadata also reach the encoded records consumed by C.
      if (
        /^(?:apps\/server\/src\/engine\/wire\/|packages\/contracts\/src\/(?:engine\.ts$|engineCall\.ts$|engineWire))/u.test(
          path,
        )
      ) {
        selected.add("C");
        selected.add("C-engine");
        selected.add("types");
      }
    } else if (path.startsWith("apps/web/")) {
      // Area ownership above decides whether a web change reaches chat.
      continue;
    } else if (path.startsWith("apps/server/src/")) {
      // The crew's journeys run on the engine in their own stage.
      if (path.startsWith("apps/server/src/zerops/crew/")) selected.add("F");
      selected.add("C");
      selected.add("C-engine");
      selected.add("types");
    } else {
      // Shared contracts, dependencies and gate tooling have uncertain boundary impact on the
      // chat; the crew's journeys (F) stay with the crew's own paths.
      for (const stage of chatGateStages) if (stage.id !== "F") selected.add(stage.id);
    }
  }
  return chatGateStages.filter((stage) => selected.has(stage.id));
}

/** File ownership comes from the commands that will actually run. */
export function chatGateTestFiles(
  root: string,
  stages: ReadonlyArray<(typeof chatGateStages)[number]>,
): string[] {
  const collect = (directory: string): string[] => {
    if (!NodeFS.existsSync(NodePath.join(root, directory)))
      throw new Error(
        `Missing selected scenario path: ${NodePath.posix.relative("apps/web", directory)}`,
      );
    return NodeFS.readdirSync(NodePath.join(root, directory), { withFileTypes: true }).flatMap(
      (entry) => {
        const path = `${directory}/${entry.name}`;
        return entry.isDirectory()
          ? collect(path)
          : entry.isFile() && path.endsWith(".scenario.ts")
            ? [path]
            : [];
      },
    );
  };
  return [
    ...new Set(
      stages.flatMap((stage) =>
        stage.commands.flatMap((command) =>
          command.args.flatMap((arg) => {
            if (/\.(?:test|scenario)\.ts$/u.test(arg))
              return [NodePath.posix.join(command.cwd, arg)];
            if (arg.startsWith("test/scenarios/areas/"))
              return collect(NodePath.posix.join(command.cwd, arg));
            return [];
          }),
        ),
      ),
    ),
  ];
}

async function runCommand(root: string, command: ChatGateCommand): Promise<number> {
  const env = { ...process.env };
  // PostgreSQL scenarios own their serial fixture policy, independently of unit-test workers.
  if (command.args.some((arg) => arg.endsWith("/scenarios/vitest.config.ts")))
    delete env.VITEST_MAX_WORKERS;
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn(
      "vp",
      command.args.map((arg) =>
        arg.startsWith("test/scenarios/areas/") ? NodePath.resolve(root, command.cwd, arg) : arg,
      ),
      {
        cwd: NodePath.join(root, command.cwd),
        env: {
          ...env,
          ...command.env,
          PATH: [NodePath.join(root, "node_modules/.bin"), process.env.PATH ?? ""].join(
            NodePath.delimiter,
          ),
        },
        stdio: "inherit",
      },
    );
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const stageAt = args.indexOf("--stages");
  const stageIds = stageAt === -1 ? undefined : args[stageAt + 1]?.split(",");
  const remaining =
    stageAt === -1 ? args : args.filter((_, index) => index !== stageAt && index !== stageAt + 1);
  if (
    remaining.length > 1 ||
    remaining.some((arg) => arg !== "--list" && arg !== "--select") ||
    (stageAt !== -1 &&
      (!stageIds?.length ||
        stageIds.some((id) => !chatGateStages.some((stage) => stage.id === id)))) ||
    (args.includes("--select") && (args.length !== 1 || stageAt !== -1))
  )
    throw new Error(
      "Usage: node scripts/chat-gate.ts [--list | --select (paths on stdin)] [--stages A,C,C-engine,E,types]",
    );
  const stages = stageIds
    ? chatGateStages.filter((stage) => stageIds.includes(stage.id))
    : chatGateStages;
  if (args.includes("--select")) {
    console.log(selectsChatGate(NodeFS.readFileSync(0, "utf8").split(/\r?\n/u)));
  } else if (args.includes("--list")) {
    for (const stage of stages)
      for (const command of stage.commands)
        console.log(
          `${stage.name}: (${command.cwd}) ${Object.entries(command.env ?? {})
            .map(([key, value]) => `${key}=${value} `)
            .join("")}vp ${command.args.join(" ")}`,
        );
  } else {
    if (process.env.SPI_UPDATE_GOLDENS === "1")
      throw new Error("The chat gate compares goldens; unset SPI_UPDATE_GOLDENS.");
    const root = NodePath.resolve(import.meta.dirname, "..");
    // Stage B's journeys run in the pinned Chrome for Testing. Installing it here (a no-op once
    // the host has it) keeps one gate command for CI and a fresh worktree alike.
    const browserInstalled = stages.some((stage) =>
      stage.commands.some((command) => command.args.includes("--project")),
    )
      ? await new Promise<number>((resolve) => {
          const child = NodeChildProcess.spawn(process.execPath, ["apps/web/test/testBrowser.ts"], {
            cwd: root,
            stdio: "inherit",
          });
          child.on("error", () => resolve(1));
          child.on("exit", (code) => resolve(code ?? 1));
        })
      : 0;
    if (browserInstalled !== 0)
      throw new Error("The chat gate could not install the scenarios' Chrome for Testing.");
    const results = await Promise.all(
      stages.map(async (stage) => {
        const started = performance.now();
        let status = 0;
        for (const command of stage.commands) {
          status = await runCommand(root, command);
          if (status !== 0) break;
        }
        return {
          name: stage.name,
          status,
          seconds: ((performance.now() - started) / 1000).toFixed(2),
        };
      }),
    );
    const summary = results.map(
      ({ name, status, seconds }) => `${status === 0 ? "ok" : "FAIL"} ${name} (${seconds}s)`,
    );
    console.log(summary.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY)
      NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n\n")}\n`);
    process.exitCode = results.some(({ status }) => status !== 0) ? 1 : 0;
  }
}
