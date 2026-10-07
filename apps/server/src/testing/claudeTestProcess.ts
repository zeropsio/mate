// @effect-diagnostics nodeBuiltinImport:off - test fixtures own and reap native child processes.
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import { afterAll, expect, onTestFinished, vi } from "vite-plus/test";

export const countFixtureProcesses = (binaryPath: string) =>
  NodeChildProcess.execFileSync("ps", ["-axo", "command="], { encoding: "utf8" })
    .split("\n")
    .filter((command) => command.includes(binaryPath)).length;

/** Call once per suite; each fixture owns only PIDs captured by its spawn callback. */
export const claudeTestProcessSuite = () => {
  const baselines = new Map<string, number>();
  afterAll(() => {
    for (const [binaryPath, before] of baselines) {
      expect(countFixtureProcesses(binaryPath), binaryPath).toBe(before);
    }
  });

  return Effect.fn("ownClaudeTestProcesses")(function* (binaryPath: string) {
    baselines.set(binaryPath, countFixtureProcesses(binaryPath));
    const children: Array<{ pid: number; closed: Promise<void> }> = [];
    const { query } = yield* Effect.promise(() =>
      vi.importActual<typeof ClaudeSdk>("@anthropic-ai/claude-agent-sdk"),
    );
    // Acquire the spy and register cleanup without an interruption gap.
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const spy = vi.spyOn(ClaudeSdk, "query").mockImplementation((input) => {
          if (input.options?.pathToClaudeCodeExecutable !== binaryPath) return query(input);
          return query({
            ...input,
            options: {
              ...input.options,
              spawnClaudeCodeProcess: (options) => {
                const child = NodeChildProcess.spawn(options.command, options.args, {
                  cwd: options.cwd,
                  env: options.env,
                  signal: options.signal,
                  detached: true,
                  stdio: ["pipe", "pipe", "pipe"],
                });
                const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
                if (child.pid !== undefined) children.push({ pid: child.pid, closed });
                return child;
              },
            },
          });
        });
        let cleanup: Promise<void> | undefined;
        const dispose = () =>
          (cleanup ??= (async () => {
            spy.mockRestore();
            for (const { pid } of children) {
              try {
                process.kill(-pid, "SIGKILL");
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
              }
            }
            await Promise.all(children.map(({ closed }) => closed));
          })());
        // Vitest teardown also runs after an assertion failure or runner timeout.
        onTestFinished(dispose);
        return dispose;
      }),
      (dispose) => Effect.promise(dispose),
    );
  });
};
