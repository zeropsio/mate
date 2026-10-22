// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
// @effect-diagnostics globalTimers:off -- signal escalation for a child process, no Effect runtime here.
// @effect-diagnostics globalDate:off -- compares file mtimes, which are wall-clock by nature.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Redacted from "effect/Redacted";
import { GitError } from "./api.ts";
import { GITHUB_REFS } from "./followRefs.ts";
import { holdsRawBytes, pathBytes } from "./pathText.ts";

const failed = (operation: string, message: string) =>
  new GitError({ operation, reason: "git_failed", message });
const overrides = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly input?: string | Uint8Array;
  readonly acceptExitCodes?: ReadonlyArray<number>;
}
const graceMs = 2_000;
/** git's askpass helper: the user GitHub's tokens take, then the token from the file beside it. */
const ASKPASS = `#!/bin/sh
case "$1" in
  Username*) echo x-access-token ;;
  Password*) cat "$(dirname "$0")/credential" ;;
  *) exit 1 ;;
esac
`;
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

/** Single private subprocess boundary: no inherited environment, even for a restore and config. */
export class GitRunner {
  private readonly active = new Set<GitProcess>();
  private readonly handoffs = new Set<Promise<unknown>>();
  private closed = false;
  private readonly home: string;
  constructor(home: string) {
    this.home = home;
  }

  start(args: string[], options: RunOptions = {}): GitProcess {
    if (this.closed) throw failed("git", "Layer scope is closed");
    // Node writes argv as UTF-8: a last argument naming bytes that are not (`pathText`) reaches
    // git through stdin and a shell that `exec`s it, so git keeps this process and its exit code.
    const last = args.at(-1);
    const raw = last !== undefined && holdsRawBytes(last);
    if (args.slice(0, -1).some(holdsRawBytes) || (raw && options.input !== undefined))
      throw failed("git", "Only a last argument without input can name raw bytes");
    const [command, argv] = raw
      ? [
          "/bin/sh",
          [
            "-c",
            'last=$(cat; echo .); exec git "$@" "${last%.}"',
            "git",
            ...overrides,
            ...args.slice(0, -1),
          ],
        ]
      : ["git", [...overrides, ...args]];
    const child = NodeChildProcess.spawn(command, argv, {
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
    if (raw) child.stdin.end(pathBytes(last));
    const abort = () => terminate(child);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const done = new Promise<void>((resolve, reject) => {
      child.on("error", () => reject(failed(operation, "Could not start git")));
      child.on("close", (code) => {
        options.signal?.removeEventListener("abort", abort);
        // stderr names server paths and source URLs: it stays out of the error.
        if (code === 0 || (code !== null && options.acceptExitCodes?.includes(code))) resolve();
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

  /** Token stays in the private child environment, never argv, config on disk or errors. */
  remote(args: string[], url: string, token: Redacted.Redacted, signal: AbortSignal) {
    return this.run(args, {
      signal,
      env: {
        GIT_CONFIG_COUNT: "4",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "http.extraHeader",
        GIT_CONFIG_VALUE_1: `Authorization: Basic ${Buffer.from(`x-access-token:${Redacted.value(token)}`).toString("base64")}`,
        GIT_CONFIG_KEY_2: "http.followRedirects",
        GIT_CONFIG_VALUE_2: "false",
        GIT_CONFIG_KEY_3: `protocol.${NodePath.isAbsolute(url) ? "file" : new URL(url).protocol.slice(0, -1)}.allow`,
        GIT_CONFIG_VALUE_3: "always",
      },
    });
  }

  /**
   * Like `remote`, with the token reaching git only through askpass: a private file its helper
   * prints when git asks — never argv, the environment, config on disk or an error. Only paths
   * reach git's arguments; a remote that asks nothing (a local fixture) never reads the file.
   */
  async remoteAskpass(
    args: string[],
    url: string,
    token: Redacted.Redacted,
    signal: AbortSignal,
    acceptExitCodes?: ReadonlyArray<number>,
  ): Promise<{ readonly stdout: Buffer; readonly code: number }> {
    if (this.closed) throw failed("git", "Layer scope is closed");
    // Its files live in the home the scope removes after close, so close waits for them too.
    const handoff = this.askpass(args, url, token, signal, acceptExitCodes);
    this.handoffs.add(handoff);
    try {
      return await handoff;
    } finally {
      this.handoffs.delete(handoff);
    }
  }

  private async askpass(
    args: string[],
    url: string,
    token: Redacted.Redacted,
    signal: AbortSignal,
    acceptExitCodes?: ReadonlyArray<number>,
  ): Promise<{ readonly stdout: Buffer; readonly code: number }> {
    const dir = await NodeFSP.mkdtemp(NodePath.join(this.home, "askpass-"));
    try {
      await NodeFSP.chmod(dir, 0o700);
      const askpass = NodePath.join(dir, "askpass.sh");
      await NodeFSP.writeFile(NodePath.join(dir, "credential"), Redacted.value(token), {
        mode: 0o600,
        flag: "wx",
      });
      await NodeFSP.writeFile(askpass, ASKPASS, { mode: 0o700, flag: "wx" });
      const protocol = NodePath.isAbsolute(url) ? "file" : new URL(url).protocol.slice(0, -1);
      return await this.exec(
        [
          "-c",
          "credential.helper=",
          "-c",
          `core.askPass=${askpass}`,
          "-c",
          "credential.useHttpPath=true",
          "-c",
          "http.followRedirects=false",
          "-c",
          `protocol.${protocol}.allow=always`,
          ...args,
        ],
        { signal, env: { GIT_ASKPASS: askpass }, ...(acceptExitCodes ? { acceptExitCodes } : {}) },
      );
    } finally {
      // Git may still be writing in it as the call ends (an aborted push): Node retries the
      // removal then, so the credential never stays and the call keeps its own outcome.
      await NodeFSP.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  async run(args: string[], options: RunOptions = {}): Promise<Buffer> {
    return (await this.exec(args, options)).stdout;
  }

  /** Collects a prefix, then stops the process instead of reading a huge blob or patch into memory. */
  async prefix(
    args: string[],
    signal: AbortSignal,
    max: number,
  ): Promise<{ readonly bytes: Buffer; readonly truncated: boolean }> {
    const process = this.start(args, { signal });
    process.child.stdin.end();
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    try {
      for await (const chunk of process.child.stdout) {
        const bytes = Buffer.from(chunk as Uint8Array);
        const remaining = max - size;
        chunks.push(bytes.subarray(0, Math.max(0, remaining)));
        size += bytes.length;
        if (size > max) {
          truncated = true;
          break;
        }
      }
      if (!truncated) await process.done;
      return { bytes: Buffer.concat(chunks), truncated };
    } finally {
      terminate(process.child);
      await process.done.catch(() => {});
    }
  }

  /** Like run, and reports which accepted exit code git ended with. */
  async exec(
    args: string[],
    options: RunOptions = {},
  ): Promise<{ readonly stdout: Buffer; readonly code: number }> {
    const { child, done } = this.start(args, options);
    child.stdin.end(options.input);
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
      return { stdout: Buffer.concat(chunks), code: child.exitCode ?? 0 };
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
    await Promise.all([...this.handoffs].map((handoff) => handoff.catch(() => {})));
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
 hideRefs = ${GITHUB_REFS}
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
/** Private index, archive worktree and config staging the layer creates inside a repository. */
export const scratch = (name: string) => /^\.(?:index|archive|config)-/.test(name);
const names = (path: string, recursive = false) =>
  NodeFSP.readdir(path, { recursive }).catch(() => [] as string[]);

/** How long a fetch from a remote may run before it is stopped. */
export const fetchDeadlineMs = 60 * 1000;

/**
 * Packs a fetch stopped or refused mid-transfer left in `objects/pack`, untouched for longer than
 * any fetch may run: nothing still writes them, and nothing else ever removes them (`gc.auto = 0`).
 */
export const sweepPartialPacks = async (dir: string): Promise<void> => {
  const pack = NodePath.join(dir, "objects", "pack");
  for (const name of await names(pack)) {
    if (!name.startsWith("tmp_")) continue;
    const path = NodePath.join(pack, name);
    const stat = await NodeFSP.lstat(path).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > fetchDeadlineMs)
      await NodeFSP.rm(path, { force: true });
  }
};

/** Debris of a git killed mid-write: locks, quarantines and scratch untouched for an hour. */
export const sweep = async (dir: string): Promise<void> => {
  await sweepPartialPacks(dir);
  const candidates = [
    ...(await names(dir)).filter((name) => name.endsWith(".lock") || scratch(name)),
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
