// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- host check logs and stage runs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export function failureSummary(output: string, logPath: string): string {
  // Strip terminal colour only from the summary; the full log retains the original bytes.
  const lines = output
    // oxlint-disable-next-line eslint/no-control-regex -- Terminal colour contains ESC.
    .replace(/\u001b\[[\d;]*m/gu, "")
    .trimEnd()
    .split("\n");
  const first =
    lines.find(
      (line) =>
        !/\b(?:suggestion|warning)\s+TS\d+:/iu.test(line) &&
        (/(?:\b[A-Za-z]*Error:|:\s*error\b|^\s*error\b|^\s*[x✖✘]\s|\b(?:ENOENT|EACCES|ECONNREFUSED|ENOSPC)\b)/iu.test(
          line,
        ) ||
          /^\s*(?:\S+\.(?:[cm]?[jt]sx?|css|md)(?::\d+(?::\d+)?)?:\s+|T1 (?:over budget\b|[^:]+:\s+))/u.test(
            line,
          ) ||
          /^\s*(?:guard exceptions|[a-z][a-z0-9]*(?:-[a-z0-9]+)+): (?!ledger reconciled\b)/u.test(
            line,
          )),
    ) ??
    lines.find((line) => /^\s*FAIL\b/iu.test(line)) ??
    lines.find((line) => line.trim().length > 0) ??
    "Stage produced no output";
  const starts = lines.flatMap((line, index) =>
    /^\s*(?:FAIL\b|(?:Assertion|Type|Syntax|Reference)?Error:|[^\s]+\(\d+,\d+\): error|[x✖✘]\s)/u.test(
      line,
    )
      ? [index]
      : [],
  );
  if (
    starts.length > 0 &&
    (starts.some((index) => /^\s*FAIL\b/u.test(lines[index]!)) ||
      lines.some((line) => /(?:\.[cm]?[jt]sx?:\d+|\(\d+,\d+\): error)/u.test(line)))
  ) {
    const shown = new Set<number>();
    for (const start of starts) {
      for (let index = start; index < Math.min(lines.length, start + 40); index++) {
        if (
          index > start &&
          /^\s*(?:Test Files|Tests\s|Duration|ok .+ ·|[✓✔]|PASS\b|⎯)/u.test(lines[index]!)
        )
          break;
        shown.add(index);
      }
    }
    return `First error: ${first}\n${[...shown]
      .sort((a, b) => a - b)
      .map((index) => lines[index])
      .join("\n")}\nFull log: ${logPath}`;
  }
  return `First error: ${first}\nTail:\n${lines.slice(-12).join("\n")}\nFull log: ${logPath}`;
}

/** Merge stdout/stderr on disk, preserving their order without buffering a whole gate in memory. */
export function runLogged(
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  logPath: string,
): number {
  const fd = NodeFS.openSync(logPath, "w", 0o600);
  try {
    const result = NodeChildProcess.spawnSync(command, args, {
      ...options,
      stdio: ["ignore", fd, fd],
    });
    if (result.error) NodeFS.writeSync(fd, `${result.error.message}\n`);
    if (result.signal) NodeFS.writeSync(fd, `Process terminated by ${result.signal}\n`);
    return result.status ?? 1;
  } finally {
    NodeFS.closeSync(fd);
  }
}

const FAILED_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * A fresh log directory. Only a failed or killed run leaves one behind (a green run calls
 * `removeGateLogs`), so older ones of the same gate are pruned here.
 */
export function gateLogDirectory(name: string): string {
  const parent = NodeOS.tmpdir();
  const prefix = `mate-${name}-`;
  const cutoff = Date.now() - FAILED_LOG_RETENTION_MS;
  for (const entry of NodeFS.readdirSync(parent)) {
    if (!entry.startsWith(prefix)) continue;
    const stale = NodePath.join(parent, entry);
    try {
      if (NodeFS.statSync(stale).mtimeMs < cutoff)
        NodeFS.rmSync(stale, { recursive: true, force: true });
    } catch {
      // Another run removed it first.
    }
  }
  return NodeFS.mkdtempSync(NodePath.join(parent, prefix));
}

/** A passed gate has nothing to show; its logs go with it. */
export function removeGateLogs(logs: string): void {
  NodeFS.rmSync(logs, { recursive: true, force: true });
}

/** Each stage owns its full log; verbose replays it without changing the command or verdict. */
export function stageSummary(
  name: string,
  status: number,
  durationMs: number,
  output: string,
  files: number,
): string {
  // oxlint-disable-next-line eslint/no-control-regex -- Terminal colour contains ESC.
  const plain = output.replace(/\u001b\[[\d;]*m/gu, "");
  const counts = [...plain.matchAll(/^\s*Tests\s+.*?\((\d+)\)\s*$/gmu)];
  const cases =
    counts.reduce((sum, match) => sum + Number(match[1]), 0) ||
    [...plain.matchAll(/· (\d+) cases ·/gu)].reduce((sum, match) => sum + Number(match[1]), 0);
  return `${status === 0 ? "ok" : "FAIL"} ${name} · ${cases ? `${cases} cases` : `${files} files`} · ${(durationMs / 1000).toFixed(2)}s`;
}

/**
 * A running gate stage. `done` resolves its exit status, or `stopped` when `stop` ended it.
 * `stop(graceMs)` sends its process group SIGTERM, then SIGKILL `graceMs` later; a stage that
 * already ended, or was already stopped, is left as it is.
 */
export interface StageRun {
  readonly done: Promise<number | "stopped">;
  readonly stop: (graceMs: number) => void;
}

const groupAlive = (group: number): boolean => {
  try {
    process.kill(group, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Lets gate stages run at once while each one's merged output goes to its own file. Each stage
 * runs in its own process group, so `stop` ends everything it started (vp's Vitest and Vite
 * workers too). A stopped stage resolves `stopped` once its group is gone or has been sent SIGKILL.
 */
export function runLoggedAsync(
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  logPath: string,
): StageRun {
  const fd = NodeFS.openSync(logPath, "w", 0o600);
  const child = NodeChildProcess.spawn(command, args, {
    ...options,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  const group = child.pid === undefined ? undefined : -child.pid;
  let stopped = false;
  let closed = false;
  let killed = false;
  let kill: NodeJS.Timeout | undefined;
  const { promise: done, resolve } = Promise.withResolvers<number | "stopped">();
  const stop = (graceMs: number) => {
    if (stopped || group === undefined || child.exitCode !== null || child.signalCode !== null)
      return;
    stopped = true;
    try {
      process.kill(group, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    kill = setTimeout(() => {
      try {
        process.kill(group, "SIGKILL");
      } catch {}
      killed = true;
      // A leader that has not closed yet resolves on its close.
      if (closed) resolve("stopped");
    }, graceMs);
  };
  child.on("error", (error) => NodeFS.writeSync(fd, `${error.message}\n`));
  child.on("close", (code, signal) => {
    closed = true;
    if (signal) NodeFS.writeSync(fd, `Process terminated by ${signal}\n`);
    NodeFS.closeSync(fd);
    if (!stopped) return resolve(code ?? 1);
    // The leader ended; tools it started that are still in its group get the rest of the grace.
    if (!killed && group !== undefined && groupAlive(group)) return;
    clearTimeout(kill);
    resolve("stopped");
  });
  return { done, stop };
}
