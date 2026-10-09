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

export function gateLogDirectory(name: string): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `mate-${name}-`));
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

/** Keep chat stages concurrent while their command output goes to separate files. */
export function runLoggedAsync(
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  logPath: string,
): Promise<number> {
  const fd = NodeFS.openSync(logPath, "w", 0o600);
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn(command, args, { ...options, stdio: ["ignore", fd, fd] });
    child.on("error", (error) => NodeFS.writeSync(fd, `${error.message}\n`));
    child.on("close", (code, signal) => {
      if (signal) NodeFS.writeSync(fd, `Process terminated by ${signal}\n`);
      NodeFS.closeSync(fd);
      resolve(code ?? 1);
    });
  });
}
