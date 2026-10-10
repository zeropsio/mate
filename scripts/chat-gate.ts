#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- host boundary gate runner.
import { failureSummary, gateLogDirectory, runLoggedAsync, stageSummary } from "./gate-log.ts";
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
      /^(?:apps\/server\/src\/|apps\/web\/(?:src\/|test\/scenarios\/|test\/engine-oracle\/)|packages\/(?:contracts|client-runtime|shared|effect-codex-app-server|effect-acp)\/)/u.test(
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

export const chatGateStages = [
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
          "test/scenarios/areas/c-mate",
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
      {
        // The run-card oracle: the running engine's record through the client's wire and store
        // into the card, on its fixed seeds.
        cwd: "apps/web",
        args: [
          "test",
          "run",
          "--project",
          "engine-oracle",
          "test/engine-oracle/runCard.oracle.test.ts",
          "--allowOnly=false",
          "--reporter=default",
          "--reporter=../../scripts/chat-gate-reporter.ts",
        ],
      },
    ],
  },
  {
    // The crew's journeys on a Mate whose crew runs on the engine; the unit suite runs the same
    // sentences on V1's crew, so each one holds on both. The files' V1-only tests (skipped off the
    // V1 world: V1's own mechanism) skip here by design, so this run reports without the
    // certifying reporter.
    id: "F",
    name: "F: crew journeys on the engine",
    commands: [
      {
        cwd: "apps/server",
        env: { CREW_WORLD: "engine" },
        args: [
          "test",
          "run",
          ...["attachments", "endings", "lead", "memory", "midway", "operations", "runs"].map(
            (part) => `src/zerops/crew/CrewEngine.${part}.test.ts`,
          ),
          "src/zerops/crew/CrewEngine.test.ts",
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
      {
        cwd: ".",
        args: [
          "exec",
          "tsc",
          "--noEmit",
          "--incremental",
          "-p",
          "apps/web/test/engine-oracle/tsconfig.json",
        ],
      },
    ],
  },
] satisfies ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly commands: ReadonlyArray<ChatGateCommand>;
}>;

export interface ChatGateStage {
  readonly id: string;
  readonly name: string;
  readonly commands: ReadonlyArray<ChatGateCommand>;
  readonly reason?: string;
}

/** Narrow commands before ownership/exclusions are derived; CI's default stays unchanged. */
export function filterChatGateFiles(
  root: string,
  stages: ReadonlyArray<ChatGateStage>,
  files: ReadonlyArray<string>,
): ChatGateStage[] {
  return stages.flatMap((stage) => {
    if (stage.id === "types") return [stage];
    const inventory = chatGateTestFiles(root, [stage]);
    const selected = inventory.filter((file) => files.includes(file));
    const commands = stage.commands.flatMap((command) => {
      const own = selected.filter((file) => file.startsWith(`${command.cwd}/`));
      if (!own.length) return [];
      const args = command.args.flatMap((arg) => {
        if (/\.(?:test|scenario)\.ts$/u.test(arg) || arg.startsWith("test/scenarios/areas/"))
          return [];
        return [arg];
      });
      return [
        {
          ...command,
          args: [...args, ...own.map((file) => NodePath.posix.relative(command.cwd, file))],
        },
      ];
    });
    return commands.length ? [{ ...stage, commands }] : [];
  });
}

/** A/E need their owning seam AND related tests; C follows exact related C journeys. */
export function selectLaneChatStages(
  paths: ReadonlyArray<string>,
  related: ReadonlyArray<string>,
  root = NodePath.resolve(import.meta.dirname, ".."),
): ChatGateStage[] {
  const seams: Record<string, ReadonlyArray<string>> = {
    A: paths.filter((path) =>
      /^(?:apps\/server\/src\/(?:provider|spi)\/|packages\/(?:effect-acp|effect-codex-app-server)\/)/u.test(
        path,
      ),
    ),
    E: paths.filter((path) =>
      /^(?:apps\/server\/src\/engine\/|packages\/contracts\/src\/engine)/u.test(path),
    ),
    // The crew's journeys run on the engine for the crew's own paths.
    F: paths.filter((path) => path.startsWith("apps/server/src/zerops/crew/")),
    C: paths,
    "C-engine": paths,
  };
  const selected = related.length
    ? filterChatGateFiles(
        root,
        chatGateStages.filter((stage) => stage.id !== "types" && seams[stage.id]?.length),
        related,
      )
    : [];
  const stages: ChatGateStage[] = selected.map((stage) => ({
    ...stage,
    reason: `related files: ${chatGateTestFiles(root, [stage]).join(", ")}; inputs: ${seams[stage.id]!.join(", ")}`,
  }));
  const contracts = paths.filter(
    (path) =>
      path.startsWith("packages/contracts/src/") &&
      !/\.test\./u.test(path) &&
      !path.endsWith(".md"),
  );
  if (contracts.length || selected.some((stage) => stage.id === "C" || stage.id === "C-engine")) {
    stages.push({
      ...chatGateStages.find((stage) => stage.id === "types")!,
      reason: contracts.length
        ? `changed wire contract: ${contracts.join(", ")}`
        : "typecheck consumers of the selected client wire journeys",
    });
  }
  return stages;
}

/** File ownership comes from the commands that will actually run. */
/**
 * Which journeys each project of `apps/web/test/scenarios/vitest.config.ts` runs, relative to
 * `apps/web` (a test holds the two equal): a changed journey runs under the project that holds it.
 */
export const SCENARIO_PROJECT_FILES = {
  scenarios: {
    include: ["test/scenarios/areas/**/*.scenario.ts"],
    exclude: ["**/node_modules/**", "test/scenarios/areas/c-mate/engine-*.scenario.ts"],
  },
  "scenarios-engine": {
    include: [
      "test/scenarios/areas/c-mate/chat.scenario.ts",
      "test/scenarios/areas/c-mate/engine-*.scenario.ts",
    ],
    exclude: [],
  },
} as const satisfies Record<
  string,
  { readonly include: ReadonlyArray<string>; readonly exclude: ReadonlyArray<string> }
>;

/**
 * Whether the command's scenario project runs `file` (relative to the command's cwd): a directory
 * names every journey in it, and its project keeps only its own (`projects.ts`).
 */
function projectRuns(command: ChatGateCommand, file: string): boolean {
  const project = command.args[command.args.indexOf("--project") + 1];
  const files =
    project !== undefined && Object.hasOwn(SCENARIO_PROJECT_FILES, project)
      ? SCENARIO_PROJECT_FILES[project as keyof typeof SCENARIO_PROJECT_FILES]
      : undefined;
  if (files === undefined) return true;
  const matches = (glob: string) => NodePath.posix.matchesGlob(file, glob);
  return files.include.some(matches) && !files.exclude.some(matches);
}

export function chatGateTestFiles(root: string, stages: ReadonlyArray<ChatGateStage>): string[] {
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
              return collect(NodePath.posix.join(command.cwd, arg)).filter((file) =>
                projectRuns(command, NodePath.posix.relative(command.cwd, file)),
              );
            return [];
          }),
        ),
      ),
    ),
  ];
}

async function runCommand(
  root: string,
  command: ChatGateCommand,
  logPath: string,
): Promise<number> {
  const env = { ...process.env };
  // PostgreSQL scenarios own their serial fixture policy, independently of unit-test workers.
  if (command.args.some((arg) => arg.endsWith("/scenarios/vitest.config.ts")))
    delete env.VITEST_MAX_WORKERS;
  return runLoggedAsync(
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
    },
    logPath,
  );
}

if (import.meta.main) {
  const verbose = process.argv.includes("--verbose");
  const args = process.argv.slice(2).filter((arg) => arg !== "--verbose");
  const stageAt = args.indexOf("--stages");
  const stageIds = stageAt === -1 ? undefined : args[stageAt + 1]?.split(",");
  const filesAt = args.indexOf("--files");
  const shardAt = args.indexOf("--shard");
  const shard = shardAt === -1 ? undefined : args[shardAt + 1];
  const remaining = args.filter(
    (_, index) =>
      index !== stageAt &&
      index !== stageAt + (stageAt === -1 ? 0 : 1) &&
      index !== shardAt &&
      index !== shardAt + (shardAt === -1 ? 0 : 1) &&
      index !== filesAt &&
      index !== filesAt + (filesAt === -1 ? 0 : 1),
  );
  if (
    (shardAt !== -1 &&
      (!["1/2", "2/2"].includes(shard ?? "") || stageIds?.join(",") !== "C" || filesAt !== -1)) ||
    remaining.length > 1 ||
    remaining.some((arg) => arg !== "--list" && arg !== "--select") ||
    (stageAt !== -1 &&
      (!stageIds?.length ||
        stageIds.some((id) => !chatGateStages.some((stage) => stage.id === id)))) ||
    (args.includes("--select") && args.length !== 1)
  )
    throw new Error(
      "Usage: node scripts/chat-gate.ts [--verbose] [--list | --select (paths on stdin)] [--stages A,C,C-engine,E,F,types] [--files JSON-array] [--shard 1/2|2/2 (with --stages C)]",
    );
  const root = NodePath.resolve(import.meta.dirname, "..");
  const requested = stageIds
    ? chatGateStages.filter((stage) => stageIds.includes(stage.id))
    : chatGateStages;
  let stages: ReadonlyArray<ChatGateStage> = requested;
  if (shard) {
    // Balanced from the measured C file times; every other C file belongs to shard two.
    const first = new Set([
      "opening",
      "recovery",
      "admission",
      "providerLimits",
      "image-layout",
      "rewind",
    ]);
    const files = chatGateTestFiles(root, requested).filter(
      (file) => first.has(NodePath.basename(file, ".scenario.ts")) === (shard === "1/2"),
    );
    if (!files.length) throw new Error(`Chat contract shard ${shard}: no cases ran`);
    stages = filterChatGateFiles(root, requested, files).map((stage) => ({
      ...stage,
      name: `${stage.name} shard ${shard}`,
    }));
  }
  if (filesAt !== -1) {
    const files: unknown = JSON.parse(args[filesAt + 1] ?? "null");
    if (!Array.isArray(files) || !files.every((file): file is string => typeof file === "string"))
      throw new Error("--files needs a JSON array of test paths");
    const inventory = chatGateTestFiles(root, requested);
    for (const file of files) {
      if (!inventory.includes(file)) throw new Error(`File outside selected chat stages: ${file}`);
      if (!NodeFS.existsSync(NodePath.join(root, file)))
        throw new Error(`Missing selected file: ${file}`);
    }
    stages = filterChatGateFiles(root, requested, files);
    if (verbose || args.includes("--list"))
      for (const stage of requested)
        if (!stages.some((selected) => selected.id === stage.id))
          console.log(`Selection ${stage.id}: skip: no selected case files`);
  }
  if (args.includes("--select")) {
    console.log(selectsChatGate(NodeFS.readFileSync(0, "utf8").split(/\r?\n/u)));
  } else if (args.includes("--list")) {
    for (const stage of stages)
      for (const command of stage.commands)
        console.log(
          `${stage.name}: (${command.cwd}) ${Object.entries(command.env ?? {})
            .map(([key, value]) => `${key}=${value} `)
            .join(
              "",
            )}vp ${command.args.join(" ")} [reason: ${filesAt === -1 ? "full stage inventory" : "explicit related files"}]`,
        );
  } else {
    if (process.env.SPI_UPDATE_GOLDENS === "1")
      throw new Error("The chat gate compares goldens; unset SPI_UPDATE_GOLDENS.");
    // Stage B's journeys run in the pinned Chrome for Testing. Installing it here (a no-op once
    // the host has it) keeps one gate command for CI and a fresh worktree alike.
    const logs = gateLogDirectory("chat-gate");
    if (
      stages.some((stage) =>
        stage.commands.some((command) => command.args.includes("test/scenarios/vitest.config.ts")),
      )
    ) {
      const logPath = NodePath.join(logs, "browser.log");
      const status = await runLoggedAsync(
        process.execPath,
        ["apps/web/test/testBrowser.ts"],
        { cwd: root, env: process.env },
        logPath,
      );
      const output = NodeFS.readFileSync(logPath, "utf8");
      if (verbose) process.stdout.write(output);
      if (status !== 0) {
        console.error(failureSummary(output, logPath));
        throw new Error("The chat gate could not install the scenarios' Chrome for Testing.");
      }
    }
    const results = await Promise.all(
      stages.map(async (stage) => {
        if (verbose)
          console.log(
            `Selection ${stage.id}: ${chatGateTestFiles(root, [stage]).join(", ") || "typecheck consumers"}; reason: ${filesAt === -1 ? "full stage inventory" : "explicit related files"}`,
          );
        const started = performance.now();
        let status = 0;
        let output = "";
        for (const [index, command] of stage.commands.entries()) {
          const logPath = NodePath.join(logs, `${stage.id}-${index + 1}.log`);
          status = await runCommand(root, command, logPath);
          const commandOutput = NodeFS.readFileSync(logPath, "utf8");
          output += commandOutput;
          if (verbose) process.stdout.write(commandOutput);
          if (status !== 0) {
            console.error(failureSummary(commandOutput, logPath));
            break;
          }
        }
        return {
          name: stage.name,
          status,
          summary: stageSummary(
            stage.name,
            status,
            performance.now() - started,
            output,
            chatGateTestFiles(root, [stage]).length,
          ),
        };
      }),
    );
    const summary = results.map(({ summary }) => summary);
    console.log(summary.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY)
      NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n\n")}\n`);
    process.exitCode = results.some(({ status }) => status !== 0) ? 1 : 0;
  }
}
