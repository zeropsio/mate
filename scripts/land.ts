#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off -- landing CLI run by a lander.
/**
 * Lands the checked-out HEAD on `origin/main`. It verifies first, without the lock: fetch, rebase
 * onto `origin/main`, the sentence delta, the mate-hq pin, sentence numbering, the dependency
 * check and one gate (`gate-changed.ts --full`, under `nice`, so it yields to the landing that
 * holds the lock). Every refusal those steps give is given there, without ever taking the lock.
 * Then it queues and takes the lock; holding it, it fetches again: when `origin/main` is still the
 * commit it rebased onto, it pushes the tree it gated; otherwise it rebases onto the new
 * `origin/main`, repeats the sentence, pin, numbering and dependency steps and gates again with
 * `--passed <the HEAD its gate passed>`, which runs only the always-run stages and the stages that
 * read a file `main`'s new commits changed, then pushes. The last stdout line is `LANDED <sha>`
 * (exit 0), the pushed tip; a refusal's last stderr line is `land: refused <class>: <reason>`, it
 * exits non-zero and has pushed nothing unless its reason says the push may have landed. The line
 * before the last one is `land: waited <s> s, held the lock <s> s`. Everything else goes to
 * stderr. Only `conflict` and `gate` are fixed by changing the branch's code: a lander reads the
 * class to decide whether the builder gets the refusal back. A landing whose lists' delta differs
 * from `--sentences` is refused `sentences`; the lander passes the ids its card names (`node
 * scripts/land.ts --sentences PJ12,PJ+1`), the sentences it adds by their lane-local ids.
 *
 * Main is as safe as a gate under the lock: every stage either runs under the lock on the tree that
 * is pushed, or ran in this same process on a tree that differs from it in no file the stage reads.
 * Nothing carries that verdict but the gated commit's id in this process: no receipt, no cache, no
 * file another process can write, and both gates run `--full`.
 *
 * This command owns the repository's landing queue and the landing's bound, so every caller (a
 * lane, a person, a script) gets the same behaviour and none adds a clock or lock of its own. A
 * landing joins the queue with a ticket naming its process. While it waits it refuses `conflict` as
 * soon as its rebased commit does not merge with the local `origin/main` (no fetch: the holders'
 * fetches and pushes move that ref). The oldest live waiter takes the lock; the wait is unbounded.
 * `LAND_DEADLINE_SECONDS` (default 3600) bounds the verification before the lock from its start,
 * and the landing again from the moment it holds the lock; past either it is stopped and refused
 * `timeout`.
 *
 * This command is the only writer of `main`, so it alone gives final sentence ids: after the
 * checks, the branch rule of `check-sentences.ts` among them (refused `gate`), it numbers every
 * lane-local id (`ED+1`) and picks a free prefix for every new list (`next: ED+`) through
 * `numberSentences`, in one commit `test: number the sentences this landing adds` whose body lists
 * each `<old> → <new>`, so the gate covers the numbered tip; it runs as `--landing`, which judges
 * the tip by the landing rule (final ids running on from the base's `next:`, `next:` right past
 * them) instead of the branch rule this numbering breaks. The numbering is a function of the base,
 * so the one made before the lock on a base `main` still is, is the one the lock would make; once
 * `main` moved, it is made again on the new base. When the landing does not land, its branch is
 * reset to its own rebased commit, so a branch never carries numbers a landing made.
 *
 * Its stop bound (`docs/operations/release-and-deploy.md`) holds `termGraceMs` for its child, then
 * `remoteReadMs` to read origin. Once the push has started, origin decides: when its `main`
 * contains the pushed tip, it prints `LANDED <tip>` whatever stopped it; when origin cannot be
 * read, the refusal says the push may have landed.
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
/** The gate before the lock runs at this niceness, so the landing holding the lock gets the CPU. */
const verifyNiceness = "5";

/**
 * Why a landing refused: `conflict` (its commits conflict with `origin/main`, at a rebase or found
 * while queued), `gate` (the gate is red, before the lock or on the tree rebased under it, or its
 * sentence lists break the branch rule), `branch` (uncommitted changes or merge commits), `empty`
 * (HEAD adds nothing to origin/main), `pin` (the mate-hq pin is unreadable or not on HQ main),
 * `env` (no mate-hq checkout, stale dependencies), `git` (a git command failed), `contention`
 * (main kept moving while it held the lock), `timeout` (the verification or the landing passed its
 * bound), `interrupted` (SIGINT/SIGTERM), `lock` (the landing lock names no holder, so no landing
 * made it), `sentences` (the lists' delta differs from the ids named by `--sentences`, which the
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

type Holder = { readonly pid: number; readonly started: string };

let current: NodeChildProcess.ChildProcess | undefined;
let lockDir: string | undefined;
/** This landing's ticket in the queue beside the lock while it waits (`enqueue`). */
let queueEntry: { readonly queue: string; readonly n: number } | undefined;
let rebasing = false;
let timedOut = false;
let deadlineSeconds = 3600;
/** The running bound (`startBound`) and what it bounds. */
let bound: { readonly timer: NodeJS.Timeout; readonly span: string } | undefined;
let landRoot: string | undefined;
/** The tip being pushed, from the push's start: from then on origin decides the outcome. */
let pushing: { readonly root: string; readonly sha: string } | undefined;
/** The landing's own rebased commit, before its numbering: its branch's place when it does not land. */
let ownCommit: { readonly root: string; readonly sha: string } | undefined;
/** When the landing queued, took the lock and released it (ms since the epoch). */
const clock: { queued?: number; held?: number; released?: number } = {};

const timeoutReason = () =>
  `the landing passed its ${deadlineSeconds} s bound ${bound?.span ?? "holding the lock"}`;

/** Bounds what follows by `LAND_DEADLINE_SECONDS`, from now: past it the running command is stopped. */
function startBound(span: string): void {
  stopBound();
  const timer = setTimeout(() => {
    timedOut = true;
    process.stderr.write(`land: ${timeoutReason()}; stopping it\n`);
    stopCurrent("SIGTERM");
  }, deadlineSeconds * 1000);
  timer.unref();
  bound = { timer, span };
}

function stopBound(): void {
  if (bound !== undefined) clearTimeout(bound.timer);
}

/** The two numbers that decide the queue, written before the last line on every path. */
function timingLine(): string {
  const now = Date.now();
  const seconds = (ms: number) => Math.round(ms / 1000);
  const waited = clock.queued === undefined ? 0 : (clock.held ?? now) - clock.queued;
  const held = clock.held === undefined ? 0 : (clock.released ?? now) - clock.held;
  return `land: waited ${seconds(waited)} s, held the lock ${seconds(held)} s\n`;
}

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

/*
 * The queue directory `Q` holds one ticket per waiting landing: the file `n`, `<pid> <start
 * time>`. Files with a suffix (`n.meta` and the like) are an earlier version's; their numbers are
 * never issued again while they exist.
 */
const queueFile = (queue: string, n: number) => NodePath.join(queue, `${n}`);

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** The waiters' ticket numbers in `queue`, oldest first. */
function tickets(queue: string): number[] {
  return NodeFS.readdirSync(queue)
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .toSorted((left, right) => left - right);
}

/** The highest number any ticket file in `queue` carries, so no number is issued twice while it has files. */
function highestNumber(queue: string): number {
  return Math.max(
    0,
    ...NodeFS.readdirSync(queue).flatMap((name) => {
      const match = /^(\d+)(?:\.[a-z]+)?$/.exec(name);
      return match ? [Number(match[1])] : [];
    }),
  );
}

/** Removes the ticket `n` of the dead `waiter`. */
function removeDead(queue: string, n: number, waiter: Holder): void {
  try {
    NodeFS.unlinkSync(queueFile(queue, n));
    process.stderr.write(`land: removed the queue ticket of dead pid ${waiter.pid}\n`);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

/**
 * Records this landing's arrival in `queue` under the next ticket number `n`: its ticket (`n`,
 * `<pid> <start time>`), a file linked into place whole, so a ticket always names its waiter. A
 * link never replaces a file, so no two waiters hold one number: a number that is taken (a waiter
 * arrived at the same moment) is given up for the next one. A new ticket is above every queue file
 * present, so a number below a live waiter's is never issued again, and removing a dead waiter's
 * ticket never removes another's.
 */
function enqueue(queue: string, self: string): number {
  NodeFS.mkdirSync(queue, { recursive: true });
  const staged = NodePath.join(queue, `.new-${process.pid}`);
  NodeFS.writeFileSync(staged, `${process.pid} ${self}`);
  try {
    for (let ticket = highestNumber(queue) + 1; ; ticket++) {
      try {
        NodeFS.linkSync(staged, queueFile(queue, ticket));
        queueEntry = { queue, n: ticket };
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
    const path = queueFile(queue, earlier);
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
    removeDead(queue, earlier, waiter);
  }
  return undefined;
}

/** Removes this landing's ticket: it holds the lock or it exits. */
function leaveQueue(): void {
  if (queueEntry === undefined) return;
  const { queue, n } = queueEntry;
  queueEntry = undefined;
  // A ticket of this number that names another waiter is not this one's.
  if (parseHolder(queueFile(queue, n))?.pid === process.pid)
    NodeFS.rmSync(queueFile(queue, n), { force: true });
}

/**
 * The early conflict probe: whether `own` merges with the local `origin/main`, read without a
 * fetch; refuses `conflict` when it does not. Probes again only when the ref moved; returns the sha
 * it probed.
 */
async function probe(root: string, own: string, probed: string | undefined) {
  const main = await git(["rev-parse", "-q", "--verify", "refs/remotes/origin/main"], root);
  if (main.status !== 0 || main.stdout === probed) return probed;
  const merge = await git(
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", main.stdout, own],
    root,
  );
  if (merge.status === 1) {
    const paths = merge.stdout.split("\n").slice(1).filter(Boolean);
    throw new Refusal(
      "conflict",
      `conflicts with origin/main in: ${paths.join(", ")}, found while queued`,
    );
  }
  return main.stdout;
}

/**
 * Two landings must not push against the same base: one lock per repository (shared by every
 * worktree). The lock is a directory renamed into place with its `pid` file already in it, so it
 * always names its holder: a process identity (pid and start time), so a holder that died, however
 * it died, releases it to the next waiter, and a reused pid never holds it. A lock that names no
 * holder was not made by this command and is refused `lock` at once. Waiters take the lock in
 * arrival order: each holds a ticket in the queue beside the lock (`enqueue`), and only the oldest
 * live one tries the lock. Node has no advisory file lock, so a waiter looks again every `pollMs`;
 * the wait is unbounded.
 */
async function acquireLock(dir: string, root: string, own: string): Promise<void> {
  const self = started(process.pid);
  if (self === undefined) throw new Refusal("env", "ps cannot report this process's start time");
  const queue = `${dir}.queue`;
  const ticket = enqueue(queue, self);
  let probed: string | undefined;
  let lastNotice = 0;
  const wait = async (line: string) => {
    if (Date.now() - lastNotice >= noticeMs) {
      process.stderr.write(line);
      lastNotice = Date.now();
    }
    await NodeTimersPromises.setTimeout(pollMs);
  };
  for (;;) {
    probed = await probe(root, own, probed);
    const ahead = earlierWaiter(queue, ticket);
    if (ahead !== undefined) {
      await wait(`land: waiting behind the earlier landing of pid ${ahead.pid}\n`);
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
    await wait(`land: waiting for the landing held by pid ${holder.pid}\n`);
  }
}

function releaseLock(): void {
  if (lockDir === undefined) return;
  const holder = readLock(lockDir);
  if (typeof holder === "object" && holder.pid === process.pid) discard(lockDir);
  lockDir = undefined;
  clock.released = Date.now();
}

/** Aborts a rebase a stop left open, so the worktree is left as it was. */
function abortRebaseSync(root: string): void {
  if (rebasing)
    NodeChildProcess.spawnSync("git", ["rebase", "--abort"], {
      cwd: root,
      stdio: ["ignore", 2, 2],
    });
  rebasing = false;
}

/** Puts the branch back on its own rebased commit: the numbers did not land. */
function resetOwnSync(): void {
  if (ownCommit === undefined) return;
  const { root, sha } = ownCommit;
  ownCommit = undefined;
  const head = NodeChildProcess.spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (head.stdout.trim() === sha) return;
  NodeChildProcess.spawnSync("git", ["reset", "-q", "--hard", sha], {
    cwd: root,
    stdio: ["ignore", 2, 2],
  });
  process.stderr.write(`land: the branch is back on ${sha}, its own rebased commit\n`);
}

async function rebaseOnto(root: string, base: string): Promise<void> {
  rebasing = true;
  const rebase = await run("git", ["rebase", "-q", base], { cwd: root });
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

/** Checks that a mate-hq checkout is set and fetches its main. */
async function fetchHq(): Promise<string> {
  const checkout = process.env.MATE_HQ_CHECKOUT;
  const unset = "set MATE_HQ_CHECKOUT to a mate-hq clone (the pin must be on its origin/main)";
  if (!checkout || (await git(["-C", checkout, "rev-parse", "--git-dir"])).status !== 0)
    throw new Refusal("env", unset);
  await gitOk(
    ["-C", checkout, "fetch", "-q", "origin", "main"],
    "git fetch of mate-hq main failed",
  );
  return checkout;
}

/** Refuses `pin` unless the working tree's `.mate-hq-ref` is on the fetched mate-hq main. */
function requirePin(root: string, checkout: string): void {
  try {
    requireHqMain(readHqRef(root), checkout, "FETCH_HEAD");
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
 * `main` contains the pushed tip, otherwise the refusal; `unread` when origin could not be read.
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
 * Numbers the tree's lane-local sentence ids in one commit on top of `sha` and returns the commit:
 * `sha` itself when the landing adds no sentence.
 */
async function numberLanding(root: string, sha: string): Promise<string> {
  let result: ReturnType<typeof numberSentences>;
  try {
    result = numberSentences(root);
  } catch (error) {
    throw new Refusal(
      "error",
      `numbering the sentences failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.numbered.length === 0) return sha;
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

/**
 * Judges the branch's unnumbered tree against `base`: refuses `gate` when its lists break the
 * branch rule (a final id, a moved `next:` line), so the numbered tip's gate (`--landing`, the
 * landing rule) only ever sees numbers this landing wrote; refuses `sentences` unless the delta is
 * exactly the named ids.
 */
function requireSentences(root: string, named: ReadonlySet<string>, base: string): void {
  const change = sentenceDelta(root, base);
  if (change.problems.length > 0) {
    for (const problem of change.problems) process.stderr.write(`${problem}\n`);
    throw new Refusal(
      "gate",
      `the branch's sentence lists break the branch rule: ${change.problems.join("; ")}`,
    );
  }
  const delta = new Set(change.ids);
  if (delta.size === named.size && [...delta].every((id) => named.has(id))) return;
  for (const line of change.lines) process.stderr.write(`${line}\n`);
  const sorted = (ids: ReadonlySet<string>) => [...ids].toSorted().join(", ");
  throw new Refusal(
    "sentences",
    `sentences differ: named [${sorted(named)}], delta [${sorted(delta)}]`,
  );
}

const reset = (root: string, sha: string) =>
  gitOk(["reset", "-q", "--hard", sha], `git reset to ${sha} failed`, root);

/** A verified landing: its own rebased commit and the numbered tip its gate passed. */
type Verified = { readonly base: string; readonly own: string; readonly tip: string };

/**
 * Verifies the checked-out commit on `base`: rebase, sentence delta, mate-hq pin, numbering,
 * dependencies, gate. Before the lock (`passed` undefined) the gate runs whole under `nice`;
 * holding it, it runs with `--passed`, the tip this landing's gate passed before.
 */
async function verify(
  root: string,
  base: string,
  named: ReadonlySet<string>,
  passed: string | undefined,
): Promise<Verified> {
  await rebaseOnto(root, base);
  const own = await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
  if (own === base) throw new Refusal("empty", "HEAD adds nothing to origin/main");
  ownCommit = { root, sha: own };
  requireSentences(root, named, base);
  requirePin(root, await fetchHq());
  const tip = await numberLanding(root, own);
  await requireInstalledDependencies(root);
  // A worker can write this worktree's receipt and the shared stage cache, so a landing's gate
  // reuses neither: `--full`. The tip carries the numbers this landing wrote after
  // `requireSentences` judged the branch by the branch rule: `--landing`.
  const gate = [NodePath.join(root, "scripts/gate-changed.ts"), "--base", base, "--full"];
  const result =
    passed === undefined
      ? await run("/usr/bin/nice", ["-n", verifyNiceness, process.execPath, ...gate, "--landing"], {
          cwd: root,
        })
      : await run(process.execPath, [...gate, "--landing", "--passed", passed], { cwd: root });
  if (result.status !== 0)
    throw new Refusal(
      "gate",
      passed === undefined
        ? `gate red on ${tip}`
        : `gate red on ${tip}, rebased onto ${base} after the gate passed ${passed}`,
    );
  return { base, own, tip };
}

/** Lands this worktree's HEAD: verified before the lock, pushed holding it. */
async function land(args: ReadonlyArray<string>): Promise<string> {
  const named = readSentences(args);
  deadlineSeconds = readDeadline();
  startBound("before the lock");
  const root = await gitOk(["rev-parse", "--show-toplevel"], "not inside a git worktree");
  const clean = async () =>
    (await gitOk(["status", "--porcelain", "--untracked-files=no"], "git status failed", root)) ===
    "";
  if (!(await clean())) throw new Refusal("branch", "the worktree has uncommitted changes");
  const common = await gitOk(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    "git common dir unavailable",
    root,
  );
  landRoot = root;
  const fetchMain = async () => {
    await gitOk(["fetch", "-q", "origin", "main"], "git fetch origin main failed", root);
    // Read by name once: waiters' probes and other fetches share the ref.
    return gitOk(["rev-parse", "refs/remotes/origin/main"], "origin/main unavailable", root);
  };
  const first = await fetchMain();
  if ((await gitOk(["rev-list", "--merges", `${first}..HEAD`], "git rev-list failed", root)) !== "")
    throw new Refusal("branch", "HEAD has merge commits; rebase it onto origin/main instead");
  let verified = await verify(root, first, named, undefined);
  stopBound();

  // Waiting for another landing is no hung landing: the wait is unbounded.
  const lock = NodePath.join(common, "land.lock");
  clock.queued = Date.now();
  await acquireLock(lock, root, verified.own);
  clock.held = Date.now();
  process.stderr.write("land: holding the landing lock\n");
  startBound("holding the lock");

  const now = await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
  if (now !== verified.tip) {
    if (!(await clean())) throw new Refusal("branch", "the worktree has uncommitted changes");
    process.stderr.write(
      `land: HEAD moved to ${now} while queued; landing ${verified.tip}, the tree it verified\n`,
    );
    await reset(root, verified.tip);
  }
  let again = 0;
  let refusedPush = false;
  for (;;) {
    const main = await fetchMain();
    if (main !== verified.base) {
      if (++again > attempts)
        throw new Refusal(
          "contention",
          `main moved ${attempts} times while this landing held the lock`,
        );
      process.stderr.write(
        `land: main moved to ${main} since the gate passed ${verified.tip}; gating what it changed\n`,
      );
      await reset(root, verified.own);
      verified = await verify(root, main, named, verified.tip);
    } else if (refusedPush) {
      throw new Refusal("git", "git push to origin main failed");
    }
    const tip = verified.tip;
    pushing = { root, sha: tip };
    const push = await run("git", ["push", "-q", "origin", `${tip}:refs/heads/main`], {
      cwd: root,
    });
    if (push.status === 0 || remoteMainHas(root, tip) === true) {
      ownCommit = undefined;
      return tip;
    }
    // A push refused because main moved repeats the step above against the last gated tip.
    pushing = undefined;
    refusedPush = true;
    process.stderr.write(`land: the push of ${tip} was refused\n`);
  }
}

/** The landing's end: its timing line, then its last line; the exit code. */
function end(outcome: { readonly landed?: string; readonly line: string }): number {
  if (outcome.landed === undefined) resetOwnSync();
  else ownCommit = undefined;
  releaseLock();
  leaveQueue();
  process.stderr.write(timingLine());
  if (outcome.landed !== undefined) {
    process.stdout.write(outcome.line);
    return 0;
  }
  process.stderr.write(outcome.line);
  return 1;
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
        if (landRoot !== undefined) abortRebaseSync(landRoot);
        const status = end(stoppedOutcome("interrupted", `interrupted by ${signal}`));
        process.exit(status === 0 ? 0 : code);
      };
      if (current === undefined || current.exitCode !== null) return finish();
      current.once("close", finish);
      stopCurrent(signal);
    });
  }
  land(process.argv.slice(2)).then(
    (tip) => {
      process.exitCode = end({ landed: tip, line: `LANDED ${tip}\n` });
    },
    (error: unknown) => {
      // A timeout can stop the rebase midway; the worktree is left as it was.
      if (landRoot !== undefined) abortRebaseSync(landRoot);
      process.exitCode = end(
        error instanceof Refusal
          ? stoppedOutcome(error.kind, error.message)
          : stoppedOutcome("error", error instanceof Error ? error.message : String(error)),
      );
    },
  );
}
