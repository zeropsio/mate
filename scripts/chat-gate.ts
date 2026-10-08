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
}

export const chatGateStages = [
  {
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
] satisfies ReadonlyArray<{
  readonly name: string;
  readonly commands: ReadonlyArray<ChatGateCommand>;
}>;

async function runCommand(root: string, command: ChatGateCommand): Promise<number> {
  const env = { ...process.env };
  // PostgreSQL scenarios own their serial fixture policy, independently of unit-test workers.
  if (command.args.some((arg) => arg.endsWith("/scenarios/vitest.config.ts")))
    delete env.VITEST_MAX_WORKERS;
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn("vp", [...command.args], {
      cwd: NodePath.join(root, command.cwd),
      env: {
        ...env,
        PATH: [NodePath.join(root, "node_modules/.bin"), process.env.PATH ?? ""].join(
          NodePath.delimiter,
        ),
      },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--list" && arg !== "--select"))
    throw new Error("Usage: node scripts/chat-gate.ts [--list | --select (paths on stdin)]");
  if (args.includes("--select")) {
    console.log(selectsChatGate(NodeFS.readFileSync(0, "utf8").split(/\r?\n/u)));
  } else if (args.includes("--list")) {
    for (const stage of chatGateStages)
      for (const command of stage.commands)
        console.log(`${stage.name}: (${command.cwd}) vp ${command.args.join(" ")}`);
  } else {
    if (process.env.SPI_UPDATE_GOLDENS === "1")
      throw new Error("The chat gate compares goldens; unset SPI_UPDATE_GOLDENS.");
    const root = NodePath.resolve(import.meta.dirname, "..");
    // Stage B's journeys run in the pinned Chrome for Testing. Installing it here (a no-op once
    // the host has it) keeps one gate command for CI and a fresh worktree alike.
    const browserInstalled = await new Promise<number>((resolve) => {
      const child = NodeChildProcess.spawn(process.execPath, ["apps/web/test/testBrowser.ts"], {
        cwd: root,
        stdio: "inherit",
      });
      child.on("error", () => resolve(1));
      child.on("exit", (code) => resolve(code ?? 1));
    });
    if (browserInstalled !== 0)
      throw new Error("The chat gate could not install the scenarios' Chrome for Testing.");
    const results = await Promise.all(
      chatGateStages.map(async (stage) => {
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
