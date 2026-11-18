#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off -- landing CLI run by a lander.
/**
 * Lands the checked-out HEAD on `origin/main`: lock, fetch, rebase onto `origin/main`, mate-hq pin
 * check, gate, fast-forward push. The last stdout line is `LANDED <sha>` (exit 0); a refusal's last
 * stderr line is `land: refused <class>: <reason>`, it exits non-zero and has pushed nothing unless
 * its reason says the push may have landed.
 * Everything else goes to stderr. Only `conflict` and `gate` are fixed by changing the branch's
 * code: a lander reads the class to decide whether the builder gets the refusal back.
 *
 * This command owns the repository's landing queue and the landing's bound, so every caller (a
 * lane, a person, a script) gets the same behaviour and none adds a clock or lock of its own: it
 * waits for the lock as long as it takes, and once it holds it, the landing has
 * `LAND_DEADLINE_SECONDS` (default 3600) before it is stopped and refused `timeout`. Its stop bound
 * (`docs/operations/release-and-deploy.md`) holds `termGraceMs` for its child, then `remoteReadMs`
 * to read origin. Once the push has started, origin decides:
 * when its `main` contains the pushed commit, the landing prints `LANDED <sha>` whatever stopped it; when
 * origin cannot be read, the refusal says the push may have landed.
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
const termGraceMs = 2_000;
const remoteReadMs = 2_000;
const maxDeadlineSeconds = Math.floor(2 ** 31 / 1000) - 1;

/**
 * Why a landing refused: `conflict` (rebase conflicts), `gate` (gate red), `branch` (uncommitted
 * changes or merge commits), `empty` (HEAD adds nothing), `pin` (the mate-hq pin is unreadable or
 * not on HQ main), `env` (no mate-hq checkout, stale dependencies), `git` (a git command failed),
 * `contention` (main kept moving), `timeout` (the landing passed its bound after taking the lock),
 * `interrupted` (SIGINT/SIGTERM), `lock` (the landing lock names no holder, so no landing made
 * it), `error` (anything unexpected).
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
  | "timeout"
  | "interrupted"
  | "lock"
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
let timedOut = false;
let deadlineSeconds = 3600;
let landRoot: string | undefined;
/** The commit being pushed, from the push's start: from then on origin decides the outcome. */
let pushing: { readonly root: string; readonly sha: string } | undefined;
const timeoutReason = () => `the landing passed its ${deadlineSeconds} s bound`;

/** Runs a command; stdout is captured or sent to stderr, stderr always goes to stderr. */
function run(
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string | undefined; readonly capture?: boolean } = {},
): Promise<Result> {
  if (timedOut) return Promise.reject(new Refusal("timeout", timeoutReason()));
  return new Promise((resolve, reject) => {
    // Its own process group, so a stop reaches everything it started (the gate's tools too).
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", options.capture ? "pipe" : 2, 2],
      detached: true,
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
      if (timedOut && code !== 0) reject(new Refusal("timeout", timeoutReason()));
      else resolve({ status: code ?? (signal ? 128 : 1), stdout: stdout.trim() });
    });
  });
}

/** Stops the running command's process group: the signal, then SIGKILL after a grace. */
function stopCurrent(signal: NodeJS.Signals): void {
  const child = current;
  if (child?.pid === undefined || child.exitCode !== null) return;
  const group = -child.pid;
  try {
    process.kill(group, signal);
  } catch {
    child.kill(signal);
  }
  const kill = setTimeout(() => {
    try {
      process.kill(group, "SIGKILL");
    } catch {}
  }, termGraceMs);
  kill.unref();
  child.once("close", () => clearTimeout(kill));
}

const git = (args: ReadonlyArray<string>, cwd?: string) => run("git", args, { cwd, capture: true });

async function gitOk(args: ReadonlyArray<string>, failure: string, cwd?: string): Promise<string> {
  const result = await git(args, cwd);
  if (result.status !== 0) throw new Refusal("git", failure);
  return result.stdout;
}

/** A process's start time as `ps` reports it; with the pid it names one process, never a reused pid. */
function started(pid: number): string | undefined {
  const ps = NodeChildProcess.spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  });
  const out = ps.status === 0 ? ps.stdout.trim() : "";
  return out === "" ? undefined : out;
}

type Holder = { readonly pid: number; readonly started: string };

/** The holder named by the `pid` file (`<pid> <start time>`) in `dir`, if it parses. */
function parseHolder(dir: string): Holder | undefined {
  try {
    const [first, ...rest] = NodeFS.readFileSync(NodePath.join(dir, "pid"), "utf8")
      .trim()
      .split(" ");
    const pid = Number(first);
    const at = rest.join(" ");
    return Number.isSafeInteger(pid) && pid > 0 && at !== "" ? { pid, started: at } : undefined;
  } catch {
    return undefined;
  }
}

const inode = (dir: string) => {
  try {
    return NodeFS.statSync(dir).ino;
  } catch {
    return undefined;
  }
};

/**
 * The lock at `dir`: its holder, `absent` when there is no lock, or `unnamed` when one and the same
 * lock directory stayed in place while its `pid` file named no holder (this command never makes
 * one: the lock is renamed into place with its holder inside).
 */
function readLock(dir: string): Holder | "absent" | "unnamed" {
  const before = inode(dir);
  if (before === undefined) return "absent";
  const holder = parseHolder(dir);
  if (holder !== undefined) return holder;
  return inode(dir) === before ? "unnamed" : "absent";
}

/** The holder still runs: its pid exists and started when the holder wrote. */
function alive(holder: Holder): boolean {
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
  }
  const at = started(holder.pid);
  return at === undefined || at === holder.started;
}

/** Moves this landing's own lock aside in one rename, then deletes it: nobody sees it half removed. */
function discard(dir: string): void {
  const aside = `${dir}.gone-${process.pid}-${Date.now()}`;
  try {
    NodeFS.renameSync(dir, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  NodeFS.rmSync(aside, { recursive: true, force: true });
}

/**
 * Takes over the lock of the dead `holder` in one rename, to a name only that holder has: the first
 * waiter's rename moves the lock and leaves that name taken (it keeps its `pid` file, so it is never
 * empty), so any later rename by a waiter that read the same holder fails instead of moving the
 * next landing's lock. There is no step between deciding and taking over in which a taker can die.
 * The moved directory stays as the record of the takeover.
 */
function takeOver(dir: string, holder: Holder): boolean {
  const record = `${dir}.dead-${holder.pid}-${holder.started.replace(/[^0-9A-Za-z]+/g, "-")}`;
  try {
    NodeFS.renameSync(dir, record);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EEXIST" || code === "ENOTEMPTY") return false;
    throw error;
  }
  process.stderr.write(`land: took over the lock of dead pid ${holder.pid} (moved to ${record})\n`);
  return true;
}

/**
 * Two landings must not gate against the same base: one lock per repository (shared by every
 * worktree). The lock is a directory renamed into place with its `pid` file already in it, so it
 * always names its holder: a process identity (pid and start time), so a holder that died, however
 * it died, releases it to the next waiter, and a reused pid never holds it. A lock that names no
 * holder was not made by this command and is refused `lock` at once. Node has no advisory file
 * lock, so a waiter looks again every `pollMs`; the wait itself is the queue and is unbounded.
 */
async function acquireLock(dir: string): Promise<void> {
  const self = started(process.pid);
  if (self === undefined) throw new Refusal("env", "ps cannot report this process's start time");
  let lastNotice = 0;
  for (;;) {
    const fresh = `${dir}.new-${process.pid}`;
    NodeFS.rmSync(fresh, { recursive: true, force: true });
    NodeFS.mkdirSync(fresh);
    NodeFS.writeFileSync(NodePath.join(fresh, "pid"), `${process.pid} ${self}`);
    try {
      NodeFS.renameSync(fresh, dir);
      lockDir = dir;
      return;
    } catch (error) {
      NodeFS.rmSync(fresh, { recursive: true, force: true });
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
    }
    const holder = readLock(dir);
    if (holder === "absent") continue;
    if (holder === "unnamed")
      throw new Refusal(
        "lock",
        `${dir} names no holder, so no landing made it; remove it once no landing runs`,
      );
    if (!alive(holder) && takeOver(dir, holder)) continue;
    if (Date.now() - lastNotice >= noticeMs) {
      process.stderr.write(`land: waiting for the landing held by pid ${holder.pid}\n`);
      lastNotice = Date.now();
    }
    await NodeTimersPromises.setTimeout(pollMs);
  }
}

function releaseLock(): void {
  if (lockDir === undefined) return;
  const holder = readLock(lockDir);
  if (typeof holder === "object" && holder.pid === process.pid) discard(lockDir);
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

/** `LAND_DEADLINE_SECONDS`: whole seconds a timer can hold, 3600 when unset. */
function readDeadline(): number {
  const raw = process.env.LAND_DEADLINE_SECONDS;
  if (raw === undefined) return 3600;
  const seconds = Number(raw);
  if (!/^\d+$/.test(raw) || seconds < 1 || seconds > maxDeadlineSeconds)
    throw new Refusal(
      "env",
      `LAND_DEADLINE_SECONDS must be whole seconds from 1 to ${maxDeadlineSeconds}, not "${raw}"`,
    );
  return seconds;
}

/**
 * Whether origin's `main` contains `sha` (is it or descends from it: another landing may push on
 * top within these seconds), fetched once within `remoteReadMs`; undefined when unreadable.
 */
function remoteMainHas(root: string, sha: string): boolean | undefined {
  const fetch = NodeChildProcess.spawnSync("git", ["fetch", "-q", "origin", "refs/heads/main"], {
    cwd: root,
    timeout: remoteReadMs,
    stdio: "ignore",
  });
  if (fetch.status !== 0) return undefined;
  const ancestor = NodeChildProcess.spawnSync(
    "git",
    ["merge-base", "--is-ancestor", sha, "FETCH_HEAD"],
    { cwd: root, stdio: "ignore" },
  );
  return ancestor.status === 0 ? true : ancestor.status === 1 ? false : undefined;
}

/**
 * The outcome of a landing stopped with `kind`: once the push has started, `LANDED` when origin's
 * `main` contains the pushed commit, otherwise the refusal.
 */
function stoppedOutcome(
  kind: RefusalClass,
  reason: string,
): { readonly landed?: string; readonly line: string } {
  if (pushing === undefined) return { line: refusedLine(kind, reason) };
  const landed = remoteMainHas(pushing.root, pushing.sha);
  if (landed === true) return { landed: pushing.sha, line: `LANDED ${pushing.sha}\n` };
  if (landed === false) return { line: refusedLine(kind, reason) };
  return {
    line: refusedLine(kind, `${reason}; origin could not be read, the push may have landed`),
  };
}

async function land(): Promise<string> {
  deadlineSeconds = readDeadline();
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
  landRoot = root;
  // The bound starts once the lock is held: waiting for another landing is no hung landing.
  process.stderr.write("land: holding the landing lock\n");
  const deadline = setTimeout(() => {
    timedOut = true;
    process.stderr.write(`land: ${timeoutReason()}; stopping it\n`);
    stopCurrent("SIGTERM");
  }, deadlineSeconds * 1000);
  deadline.unref();

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
    // A worker can write this worktree's receipt and the shared stage cache, so the gate of `main`
    // reuses neither: `--full` runs every stage itself.
    const gate = await run(
      process.execPath,
      [NodePath.join(root, "scripts/gate-changed.ts"), "--base", "origin/main", "--full"],
      { cwd: root },
    );
    if (gate.status !== 0) throw new Refusal("gate", `gate red on ${sha}`);

    pushing = { root, sha };
    const push = await run("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], { cwd: root });
    if (push.status === 0 || remoteMainHas(root, sha) === true) return sha;
    pushing = undefined;
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
        const outcome = stoppedOutcome("interrupted", `interrupted by ${signal}`);
        if (outcome.landed === undefined) {
          process.stderr.write(outcome.line);
          process.exit(code);
        }
        releaseLock();
        process.stdout.write(outcome.line);
        process.exit(0);
      };
      if (current === undefined || current.exitCode !== null) return finish();
      current.once("close", finish);
      stopCurrent(signal);
    });
  }
  land().then(
    (sha) => {
      releaseLock();
      process.stdout.write(`LANDED ${sha}\n`);
    },
    (error: unknown) => {
      // A timeout can stop the rebase midway; the worktree is left as it was.
      if (landRoot !== undefined) abortRebaseSync(landRoot);
      const outcome =
        error instanceof Refusal
          ? stoppedOutcome(error.kind, error.message)
          : stoppedOutcome("error", error instanceof Error ? error.message : String(error));
      if (outcome.landed !== undefined) {
        releaseLock();
        process.stdout.write(outcome.line);
        return;
      }
      process.stderr.write(outcome.line);
      process.exitCode = 1;
    },
  );
}
