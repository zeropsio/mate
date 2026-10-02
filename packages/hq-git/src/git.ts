// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
// @effect-diagnostics globalTimers:off -- signal escalation for a child process, no Effect runtime here.
// @effect-diagnostics globalDate:off -- compares file mtimes, which are wall-clock by nature.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { GitError } from "./api.ts";

const failed = (operation: string, message: string) =>
  new GitError({ operation, reason: "git_failed", message });
const overrides = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}
const graceMs = 2_000;
const stopping = new WeakSet<NodeChildProcess.ChildProcess>();
/**
 * Stops git and the helpers in its process group. EOF comes first: git abandons an incomplete
 * pack and removes its own quarantine, which it leaves behind on SIGTERM. Then SIGTERM, which
 * still lets git drop its locks, and SIGKILL last.
 */
export const terminate = (child: NodeChildProcess.ChildProcess): void => {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (stopping.has(child)) return;
  stopping.add(child);
  child.stdin?.destroy();
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGKILL"];
  let timer: NodeJS.Timeout;
  const escalate = () => {
    try {
      globalThis.process.kill(-pid, signals.shift()!);
    } catch {
      /* The group is already gone. */
    }
    if (signals.length > 0) timer = setTimeout(escalate, graceMs).unref();
  };
  timer = setTimeout(escalate, graceMs).unref();
  child.once("close", () => clearTimeout(timer));
};
export interface GitProcess {
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly done: Promise<void>;
}

/** Single private subprocess boundary: no inherited environment, even for import and config. */
export class GitRunner {
  private readonly active = new Set<GitProcess>();
  private closed = false;
  private readonly home: string;
  constructor(home: string) {
    this.home = home;
  }

  start(args: string[], options: RunOptions = {}): GitProcess {
    if (this.closed) throw failed("git", "Layer scope is closed");
    const child = NodeChildProcess.spawn("git", [...overrides, ...args], {
      env: {
        PATH: "/usr/bin:/bin:/usr/local/bin",
        HOME: this.home,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_LITERAL_PATHSPECS: "1",
        LC_ALL: "C",
        ...options.env,
      },
      stdio: "pipe",
      // Its own process group, so stopping git also stops the helpers it spawned.
      detached: true,
    });
    const operation = args.find((arg) => /^[a-z][a-z-]*$/.test(arg)) ?? "git";
    child.stderr.resume();
    // Git may answer early without consuming the rest of a bad pack.
    child.stdin.on("error", () => {});
    const abort = () => terminate(child);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const done = new Promise<void>((resolve, reject) => {
      child.on("error", () => reject(failed(operation, "Could not start git")));
      child.on("close", (code) => {
        options.signal?.removeEventListener("abort", abort);
        // stderr names server paths and source URLs: it stays out of the error.
        if (code === 0) resolve();
        else reject(failed(operation, `Git ${operation} failed`));
      });
    });
    const spawned = { child, done };
    this.active.add(spawned);
    // Attach a rejection handler immediately; callers may be busy streaming the process's input.
    void done.then(
      () => this.active.delete(spawned),
      () => this.active.delete(spawned),
    );
    return spawned;
  }

  async run(args: string[], options: RunOptions = {}): Promise<Buffer> {
    const { child, done } = this.start(args, options);
    child.stdin.end();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of child.stdout) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > 16 * 1024 * 1024) throw failed("git", "Git output exceeds limit");
        chunks.push(bytes);
      }
      await done;
      return Buffer.concat(chunks);
    } finally {
      terminate(child);
      await done.catch(() => {});
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const processes = [...this.active];
    for (const { child } of processes) terminate(child);
    await Promise.all(processes.map(({ done }) => done.catch(() => {})));
  }
}

const settings = `
[core]
 bare = true
 hooksPath = /dev/null
 fsmonitor = false
 fsync = committed
 protectHFS = true
 protectNTFS = true
[receive]
 fsckObjects = true
 denyDeletes = true
 denyNonFastForwards = true
 maxInputSize = 200m
 advertisePushOptions = false
 autogc = false
[transfer]
 fsckObjects = true
[gc]
 auto = 0
[protocol]
 allow = never
[pack]
 threads = 1
 windowMemory = 100m
[uploadpack]
 allowFilter = true
`;
const preserved = new Set([
  "core.repositoryformatversion",
  "core.filemode",
  "core.ignorecase",
  "core.precomposeunicode",
  "core.symlinks",
  "extensions.objectformat",
  "extensions.refstorage",
]);
const quote = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .split("\b")
    .join("\\b")}"`;

export const converge = async (
  git: GitRunner,
  dir: string,
  signal?: AbortSignal,
): Promise<void> => {
  const config = NodePath.join(dir, "config");
  // Read this file outside repository discovery, with includes explicitly disabled.
  const current = await git.run(
    ["config", "--file", config, "--no-includes", "--list", "-z"],
    signal ? { signal } : {},
  );
  const own = new Map<string, string>();
  for (const entry of current.toString().split("\0")) {
    const newline = entry.indexOf("\n");
    const key = newline < 0 ? entry : entry.slice(0, newline);
    if (preserved.has(key)) own.set(key, newline < 0 ? "" : entry.slice(newline + 1));
  }
  let wanted = "";
  for (const [key, value] of own) {
    const [section, name] = key.split(".");
    wanted += `[${section}]\n ${name} = ${quote(value)}\n`;
  }
  wanted += settings;
  // Files that would make git read attributes, objects, or history from outside this repository.
  for (const file of [
    ["info", "attributes"],
    ["info", "grafts"],
    ["objects", "info", "alternates"],
    ["objects", "info", "http-alternates"],
  ]) {
    await NodeFSP.rm(NodePath.join(dir, ...file), { force: true });
  }
  if ((await NodeFSP.readFile(config, "utf8")) === wanted) return;
  const temp = await NodeFSP.mkdtemp(NodePath.join(dir, ".config-"));
  try {
    await NodeFSP.writeFile(NodePath.join(temp, "config"), wanted, { mode: 0o600 });
    await NodeFSP.rename(NodePath.join(temp, "config"), config);
  } finally {
    await NodeFSP.rm(temp, { recursive: true, force: true });
  }
};

const staleMs = 60 * 60 * 1000;
const names = (path: string, recursive = false) =>
  NodeFSP.readdir(path, { recursive }).catch(() => [] as string[]);

/** Debris of a git killed mid-write: lock files and push quarantines untouched for an hour. */
export const sweep = async (dir: string): Promise<void> => {
  const candidates = [
    ...(await names(dir)).filter((name) => name.endsWith(".lock")),
    ...(await names(NodePath.join(dir, "refs"), true))
      .filter((name) => name.endsWith(".lock"))
      .map((name) => NodePath.join("refs", name)),
    ...(await names(NodePath.join(dir, "objects")))
      .filter((name) => name.startsWith("tmp_objdir-incoming-"))
      .map((name) => NodePath.join("objects", name)),
  ];
  for (const name of candidates) {
    const path = NodePath.join(dir, name);
    const stat = await NodeFSP.lstat(path).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > staleMs)
      await NodeFSP.rm(path, { recursive: true, force: true });
  }
};
