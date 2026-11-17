#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off -- landing CLI run by a lander.
/**
 * Lands the checked-out HEAD on `origin/main`: lock, fetch, rebase onto `origin/main`, mate-hq pin
 * check, gate, fast-forward push. The last stdout line is `LANDED <sha>` (exit 0); a refusal's last
 * stderr line is `land: refused <class>: <reason>`, it exits non-zero and has pushed nothing.
 * Everything else goes to stderr. Only `conflict` and `gate` are fixed by changing the branch's
 * code: a lander reads the class to decide whether the builder gets the refusal back.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import { staleDependencies } from "./gate-installed-dependencies.ts";
import { readHqRef, requireHqMain } from "./hq-ref.ts";

const attempts = 3;
const pollMs = 5_000;
const noticeMs = 30_000;
const unreadableGraceMs = 10_000;

/**
 * Why a landing refused: `conflict` (rebase conflicts), `gate` (gate red), `branch` (uncommitted
 * changes or merge commits), `empty` (HEAD adds nothing), `pin` (the mate-hq pin is unreadable or
 * not on HQ main), `env` (no mate-hq checkout, stale dependencies), `git` (a git command failed),
 * `contention` (main kept moving), `interrupted` (SIGINT/SIGTERM), `error` (anything unexpected).
 */
type RefusalClass =
  | "conflict"
  | "gate"
  | "branch"
  | "empty"
  | "pin"
  | "env"
  | "git"
  | "contention"
  | "interrupted"
  | "error";

class Refusal extends Error {
  readonly kind: RefusalClass;
  constructor(kind: RefusalClass, message: string) {
    super(message);
    this.kind = kind;
  }
}

const refusedLine = (kind: RefusalClass, reason: string) => `land: refused ${kind}: ${reason}\n`;

type Result = { readonly status: number; readonly stdout: string };

let current: NodeChildProcess.ChildProcess | undefined;
let lockDir: string | undefined;
let rebasing = false;

/** Runs a command; stdout is captured or sent to stderr, stderr always goes to stderr. */
function run(
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string | undefined; readonly capture?: boolean } = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", options.capture ? "pipe" : 2, 2],
    });
    current = child;
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      current = undefined;
      resolve({ status: code ?? (signal ? 128 : 1), stdout: stdout.trim() });
    });
  });
}

const git = (args: ReadonlyArray<string>, cwd?: string) => run("git", args, { cwd, capture: true });

async function gitOk(args: ReadonlyArray<string>, failure: string, cwd?: string): Promise<string> {
  const result = await git(args, cwd);
  if (result.status !== 0) throw new Refusal("git", failure);
  return result.stdout;
}

function readPid(dir: string): number | undefined {
  try {
    const pid = Number(NodeFS.readFileSync(NodePath.join(dir, "pid"), "utf8").trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Two landings must not gate against the same base: one lock per repository (shared by every worktree). */
async function acquireLock(dir: string): Promise<void> {
  let unreadableSince: number | undefined;
  let lastNotice = 0;
  for (;;) {
    try {
      NodeFS.mkdirSync(dir);
      lockDir = dir;
      NodeFS.writeFileSync(NodePath.join(dir, "pid"), String(process.pid));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const pid = readPid(dir);
    if (pid === undefined) {
      unreadableSince ??= Date.now();
      if (Date.now() - unreadableSince > unreadableGraceMs) {
        NodeFS.rmSync(dir, { recursive: true, force: true });
        unreadableSince = undefined;
        continue;
      }
    } else {
      unreadableSince = undefined;
      if (!alive(pid)) {
        process.stderr.write(`land: taking over the lock of dead pid ${pid}\n`);
        if (readPid(dir) === pid) NodeFS.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - lastNotice >= noticeMs) {
        process.stderr.write(`land: waiting for the landing held by pid ${pid}\n`);
        lastNotice = Date.now();
      }
    }
    await NodeTimersPromises.setTimeout(pollMs);
  }
}

function releaseLock(): void {
  if (lockDir === undefined) return;
  if (readPid(lockDir) === process.pid || !NodeFS.existsSync(NodePath.join(lockDir, "pid")))
    NodeFS.rmSync(lockDir, { recursive: true, force: true });
  lockDir = undefined;
}

function abortRebaseSync(root: string): void {
  if (!rebasing) return;
  NodeChildProcess.spawnSync("git", ["rebase", "--abort"], { cwd: root, stdio: ["ignore", 2, 2] });
  rebasing = false;
}

async function rebaseOntoMain(root: string): Promise<void> {
  rebasing = true;
  const rebase = await run("git", ["rebase", "-q", "origin/main"], { cwd: root });
  if (rebase.status === 0) {
    rebasing = false;
    return;
  }
  const conflicts = await git(["diff", "--name-only", "--diff-filter=U"], root);
  const abort = await run("git", ["rebase", "--abort"], { cwd: root });
  rebasing = false;
  if (abort.status !== 0)
    throw new Refusal("git", "rebase onto origin/main failed and could not be aborted");
  const paths = conflicts.stdout.split("\n").filter(Boolean);
  throw paths.length > 0
    ? new Refusal("conflict", `rebase onto origin/main conflicts in: ${paths.join(", ")}`)
    : new Refusal("git", "rebase onto origin/main failed");
}

async function requirePin(root: string): Promise<void> {
  const checkout = process.env.MATE_HQ_CHECKOUT;
  const missing = "set MATE_HQ_CHECKOUT to a mate-hq clone (the pin must be on its origin/main)";
  if (!checkout || (await git(["-C", checkout, "rev-parse", "--git-dir"])).status !== 0)
    throw new Refusal("env", missing);
  let ref: string;
  try {
    ref = readHqRef(root);
  } catch (error) {
    throw new Refusal("pin", error instanceof Error ? error.message : String(error));
  }
  await gitOk(
    ["-C", checkout, "fetch", "-q", "origin", "main"],
    "git fetch of mate-hq main failed",
  );
  try {
    requireHqMain(ref, checkout, "FETCH_HEAD");
  } catch (error) {
    throw new Refusal("pin", error instanceof Error ? error.message : String(error));
  }
}

async function requireInstalledDependencies(root: string): Promise<void> {
  if (staleDependencies(root) === undefined) return;
  await run("vp", ["i"], { cwd: root });
  const stale = staleDependencies(root);
  if (stale !== undefined) throw new Refusal("env", stale);
}

async function land(): Promise<string> {
  const root = await gitOk(["rev-parse", "--show-toplevel"], "not inside a git worktree");
  if (
    (await gitOk(["status", "--porcelain", "--untracked-files=no"], "git status failed", root)) !==
    ""
  )
    throw new Refusal("branch", "the worktree has uncommitted changes");
  const common = await gitOk(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "git common dir unavailable",
    root,
  );
  await acquireLock(NodePath.join(common, "land.lock"));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await gitOk(["fetch", "-q", "origin", "main"], "git fetch origin main failed", root);
    const base = await gitOk(["rev-parse", "origin/main"], "origin/main unavailable", root);
    if (
      (await gitOk(["rev-list", "--merges", "origin/main..HEAD"], "git rev-list failed", root)) !==
      ""
    )
      throw new Refusal("branch", "HEAD has merge commits; rebase it onto origin/main instead");
    await rebaseOntoMain(root);
    const sha = await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
    if (sha === base) throw new Refusal("empty", "HEAD adds nothing to origin/main");

    await requirePin(root);
    await requireInstalledDependencies(root);
    const gate = await run(
      process.execPath,
      [NodePath.join(root, "scripts/gate-changed.ts"), "--base", "origin/main"],
      { cwd: root },
    );
    if (gate.status !== 0) throw new Refusal("gate", `gate red on ${sha}`);

    const push = await run("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], { cwd: root });
    if (push.status === 0) return sha;
    await gitOk(["fetch", "-q", "origin", "main"], "git fetch origin main failed", root);
    const moved = await gitOk(["rev-parse", "origin/main"], "origin/main unavailable", root);
    if (moved === base) throw new Refusal("git", "git push to origin main failed");
    process.stderr.write(`land: main moved to ${moved} during the gate; landing again\n`);
  }
  throw new Refusal("contention", `main moved ${attempts} times during the gate`);
}

if (import.meta.main) {
  process.on("exit", releaseLock);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.on(signal, () => {
      const finish = () => {
        const root = NodeChildProcess.spawnSync("git", ["rev-parse", "--show-toplevel"], {
          encoding: "utf8",
        });
        if (root.status === 0) abortRebaseSync(root.stdout.trim());
        process.stderr.write(refusedLine("interrupted", `interrupted by ${signal}`));
        process.exit(code);
      };
      if (current === undefined || current.exitCode !== null) return finish();
      current.once("close", finish);
      current.kill(signal);
    });
  }
  land().then(
    (sha) => {
      releaseLock();
      process.stdout.write(`LANDED ${sha}\n`);
    },
    (error: unknown) => {
      process.stderr.write(
        error instanceof Refusal
          ? refusedLine(error.kind, error.message)
          : refusedLine("error", error instanceof Error ? error.message : String(error)),
      );
      process.exitCode = 1;
    },
  );
}
