#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off -- landing CLI run by a lander.
/**
 * Lands the checked-out HEAD on `origin/main`: lock, fetch, rebase onto `origin/main`, mate-hq pin
 * check, gate, sentence numbering, fast-forward push. The last stdout line is `LANDED <sha>` (exit 0); a refusal's last
 * stderr line is `land: refused <class>: <reason>`, it exits non-zero and has pushed nothing unless
 * its reason says the push may have landed.
 * Everything else goes to stderr. Only `conflict` and `gate` are fixed by changing the branch's
 * code: a lander reads the class to decide whether the builder gets the refusal back. A landing
 * whose lists' delta differs from `--sentences` is refused `sentences`; the lander passes the ids
 * its card names (`node scripts/land.ts --sentences PJ12,PJ+1`), the sentences it adds by their
 * lane-local ids.
 *
 * Holding the lock, this command is the only writer of `main`, so it alone gives final sentence
 * ids: after the gate passes it numbers every lane-local id (`ED+1`) and picks a free prefix for
 * every new list (`next: ED+`) through `numberSentences`, in one commit `test: number the sentences
 * this landing adds` whose body lists each `<old> → <new>`, and pushes that commit. When anything
 * stops the landing after that commit and origin has not taken it, the branch is reset to the
 * commit before it, so a branch never carries numbers a landing made; a moved `main` numbers again.
 *
 * This command owns the repository's landing queue and the landing's bound, so every caller (a
 * lane, a person, a script) gets the same behaviour and none adds a clock or lock of its own: it
 * waits its turn for the lock, in arrival order, as long as it takes, and once it holds it, the
 * landing has
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
import { numberSentences, sentenceDelta } from "./check-sentences.ts";
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
 * it), `sentences` (the lists' delta differs from the ids named by `--sentences`, which the
 * branch's code does not fix), `error` (anything unexpected, an unknown argument included).
 */
type RefusalClass =
  | "conflict"
  | "gate"
  | "sentences"
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
/** This landing's ticket in the queue beside the lock while it waits (`enqueue`). */
let queueEntry: string | undefined;
let rebasing = false;
let timedOut = false;
let deadlineSeconds = 3600;
let landRoot: string | undefined;
/** The commit being pushed, from the push's start: from then on origin decides the outcome. */
let pushing: { readonly root: string; readonly sha: string } | undefined;
/** The branch's commit before this landing numbered its sentences, from the numbering's start. */
let numbering: { readonly root: string; readonly before: string } | undefined;
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

/** The holder named by the file at `path` (`<pid> <start time>`), if it parses. */
function parseHolder(path: string): Holder | undefined {
  try {
    const [first, ...rest] = NodeFS.readFileSync(path, "utf8").trim().split(" ");
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
  const holder = parseHolder(NodePath.join(dir, "pid"));
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

/** The waiters' ticket numbers in `queue`, oldest first. */
function tickets(queue: string): number[] {
  return NodeFS.readdirSync(queue)
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .toSorted((left, right) => left - right);
}

/**
 * Records this landing's arrival in `queue`: the next ticket number, a file linked into place with
 * its waiter (`<pid> <start time>`) already in it, so it always names its waiter, and a link never
 * replaces a file, so no two waiters hold one number. A new ticket is above every ticket present,
 * so a number below a live waiter's is never issued again, and removing a dead waiter's ticket
 * never removes another's.
 */
function enqueue(queue: string, self: string): number {
  NodeFS.mkdirSync(queue, { recursive: true });
  const staged = NodePath.join(queue, `.new-${process.pid}`);
  NodeFS.writeFileSync(staged, `${process.pid} ${self}`);
  try {
    // A taken number means another waiter arrived at the same moment: the next one is this one's.
    for (let ticket = (tickets(queue).at(-1) ?? 0) + 1; ; ticket++) {
      const path = NodePath.join(queue, String(ticket));
      try {
        NodeFS.linkSync(staged, path);
        queueEntry = path;
        return ticket;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  } finally {
    NodeFS.rmSync(staged, { force: true });
  }
}

/** The nearest live waiter that arrived before `ticket`; the dead ones met on the way are removed. */
function earlierWaiter(queue: string, ticket: number): Holder | undefined {
  for (const earlier of tickets(queue)
    .filter((other) => other < ticket)
    .toReversed()) {
    const path = NodePath.join(queue, String(earlier));
    const waiter = parseHolder(path);
    if (waiter === undefined) {
      // It left after the listing; a ticket that stays and names no waiter was not made here.
      if (!NodeFS.existsSync(path)) continue;
      throw new Refusal(
        "lock",
        `${path} names no waiter, so no landing made it; remove it once no landing runs`,
      );
    }
    if (alive(waiter)) return waiter;
    try {
      NodeFS.unlinkSync(path);
      process.stderr.write(`land: removed the queue ticket of dead pid ${waiter.pid}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

/** Removes this landing's ticket: it holds the lock or it exits. */
function leaveQueue(): void {
  if (queueEntry === undefined) return;
  NodeFS.rmSync(queueEntry, { force: true });
  queueEntry = undefined;
}

/**
 * Two landings must not gate against the same base: one lock per repository (shared by every
 * worktree). The lock is a directory renamed into place with its `pid` file already in it, so it
 * always names its holder: a process identity (pid and start time), so a holder that died, however
 * it died, releases it to the next waiter, and a reused pid never holds it. A lock that names no
 * holder was not made by this command and is refused `lock` at once. Waiters take the lock in
 * arrival order: each holds a ticket in the queue beside the lock (`enqueue`), and only the oldest
 * live one tries the lock. Node has no advisory file lock, so a waiter looks again every `pollMs`;
 * the wait is unbounded.
 */
async function acquireLock(dir: string): Promise<void> {
  const self = started(process.pid);
  if (self === undefined) throw new Refusal("env", "ps cannot report this process's start time");
  const queue = `${dir}.queue`;
  const ticket = enqueue(queue, self);
  let lastNotice = 0;
  const notice = (line: string) => {
    if (Date.now() - lastNotice < noticeMs) return;
    process.stderr.write(line);
    lastNotice = Date.now();
  };
  for (;;) {
    const ahead = earlierWaiter(queue, ticket);
    if (ahead !== undefined) {
      notice(`land: waiting behind the earlier landing of pid ${ahead.pid}\n`);
      await NodeTimersPromises.setTimeout(pollMs);
      continue;
    }
    const fresh = `${dir}.new-${process.pid}`;
    NodeFS.rmSync(fresh, { recursive: true, force: true });
    NodeFS.mkdirSync(fresh);
    NodeFS.writeFileSync(NodePath.join(fresh, "pid"), `${process.pid} ${self}`);
    try {
      NodeFS.renameSync(fresh, dir);
      lockDir = dir;
      leaveQueue();
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
    notice(`land: waiting for the landing held by pid ${holder.pid}\n`);
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

/** Puts the branch back on its commit before the numbering, whose numbers did not land. */
function resetNumberingSync(): void {
  if (numbering === undefined) return;
  const { root, before } = numbering;
  numbering = undefined;
  NodeChildProcess.spawnSync("git", ["reset", "-q", "--hard", before], {
    cwd: root,
    stdio: ["ignore", 2, 2],
  });
  process.stderr.write(`land: the branch is back on ${before}, before the sentence numbering\n`);
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

/**
 * Numbers the tree's lane-local sentence ids in one commit on top of `sha` and returns the commit
 * to push: `sha` itself when the landing adds no sentence.
 */
async function numberLanding(root: string, sha: string): Promise<string> {
  numbering = { root, before: sha };
  let result: ReturnType<typeof numberSentences>;
  try {
    result = numberSentences(root);
  } catch (error) {
    throw new Refusal(
      "error",
      `numbering the sentences failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.numbered.length === 0) {
    numbering = undefined;
    return sha;
  }
  const lines = result.numbered.map(({ unit, from, to }) => `${unit}: ${from} → ${to}`);
  for (const line of lines) process.stderr.write(`land: numbered ${line}\n`);
  const fmt = await run("vp", ["fmt", ...result.files], { cwd: root });
  if (fmt.status !== 0) throw new Refusal("error", "vp fmt of the numbered sentences failed");
  const check = await run(process.execPath, [NodePath.join(root, "scripts/check-sentences.ts")], {
    cwd: root,
  });
  if (check.status !== 0) throw new Refusal("error", "the numbered sentences fail check-sentences");
  await gitOk(["add", "--", ...result.files], "git add of the numbered sentences failed", root);
  await gitOk(
    ["commit", "-q", "-m", "test: number the sentences this landing adds", "-m", lines.join("\n")],
    "git commit of the numbered sentences failed",
    root,
  );
  return gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
}

const usage = "usage: node scripts/land.ts [--sentences <id>[,<id>…]]";

/** The sentence ids the landing names; no flag names none. */
function readSentences(args: ReadonlyArray<string>): ReadonlySet<string> {
  if (args.length === 0) return new Set();
  const [flag, value, ...rest] = args;
  const ids = value?.split(",") ?? [];
  if (
    flag !== "--sentences" ||
    rest.length > 0 ||
    !ids.every((id) => /^[A-Z]{2,4}\+?(?:0|[1-9]\d*)$/u.test(id))
  )
    throw new Refusal("error", usage);
  return new Set(ids);
}

/** Refuses `sentences` unless the lists' delta against origin/main is exactly the named ids. */
function requireSentences(root: string, named: ReadonlySet<string>): void {
  const change = sentenceDelta(root, "origin/main");
  const delta = new Set(change.ids);
  if (delta.size === named.size && [...delta].every((id) => named.has(id))) return;
  for (const line of change.lines) process.stderr.write(`${line}\n`);
  const sorted = (ids: ReadonlySet<string>) => [...ids].toSorted().join(", ");
  throw new Refusal(
    "sentences",
    `sentences differ: named [${sorted(named)}], delta [${sorted(delta)}]`,
  );
}

async function land(args: ReadonlyArray<string>): Promise<string> {
  const named = readSentences(args);
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

    requireSentences(root, named);
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

    const numbered = await numberLanding(root, sha);
    pushing = { root, sha: numbered };
    const push = await run("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], { cwd: root });
    if (push.status === 0 || remoteMainHas(root, numbered) === true) {
      numbering = undefined;
      return numbered;
    }
    pushing = undefined;
    // A moved main is rebased onto and numbered again; any other stop resets in its handler.
    resetNumberingSync();
    await gitOk(["fetch", "-q", "origin", "main"], "git fetch origin main failed", root);
    const moved = await gitOk(["rev-parse", "origin/main"], "origin/main unavailable", root);
    if (moved === base) throw new Refusal("git", "git push to origin main failed");
    process.stderr.write(`land: main moved to ${moved} during the gate; landing again\n`);
  }
  throw new Refusal("contention", `main moved ${attempts} times during the gate`);
}

if (import.meta.main) {
  process.on("exit", leaveQueue);
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
          resetNumberingSync();
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
  land(process.argv.slice(2)).then(
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
      resetNumberingSync();
      process.stderr.write(outcome.line);
      process.exitCode = 1;
    },
  );
}
