// @effect-diagnostics nodeBuiltinImport:off -- host check logs.
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
        /(?:\b[A-Za-z]*Error:|:\s*error\b|^\s*error\b|^\s*[x✖✘]\s|\b(?:ENOENT|EACCES|ECONNREFUSED|ENOSPC)\b)/iu.test(
          line,
        ),
    ) ??
    lines.find((line) => /^\s*FAIL\b/iu.test(line)) ??
    "No explicit error line reported";
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

export function gateLogDirectory(name: string): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `mate-${name}-`));
}
