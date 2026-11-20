#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off -- landing CLI run by a lander.
/**
 * Lands the checked-out HEAD on `origin/main`, together with every waiting landing whose change
 * stacks cleanly: lock, fetch, rebase onto `origin/main`, stack the waiters' commits, mate-hq pin
 * check, sentence numbering, one gate, one fast-forward push. The last stdout line is
 * `LANDED <sha>` (exit 0), where `<sha>` is the pushed tip, shared by every landing it holds; a
 * refusal's last stderr line is `land: refused <class>: <reason>`, it exits non-zero and has pushed
 * nothing unless its reason says the push may have landed.
 * Everything else goes to stderr. Only `conflict` and `gate` are fixed by changing the branch's
 * code: a lander reads the class to decide whether the builder gets the refusal back. A landing
 * whose lists' delta differs from `--sentences` is refused `sentences`; the lander passes the ids
 * its card names (`node scripts/land.ts --sentences PJ12,PJ+1`), the sentences it adds by their
 * lane-local ids. A landing lands the HEAD its worktree had when it joined the queue.
 *
 * This command owns the repository's landing queue and the landing's bound, so every caller (a
 * lane, a person, a script) gets the same behaviour and none adds a clock or lock of its own. A
 * landing joins the queue with a ticket naming its waiter, its HEAD and its sentence ids. While it
 * waits it refuses `conflict` as soon as its HEAD does not merge with the local `origin/main`
 * (no fetch: the holders' fetches and pushes move that ref), and it reads the result a holder
 * writes for it. The oldest live waiter takes the lock and holds a round, bounded by
 * `LAND_DEADLINE_SECONDS` (default 3600) before it is stopped and refused `timeout`: it rebases its
 * own commit onto the round's base `origin/main` sha, then cherry-picks every live waiter's
 * commits onto it in ticket order. A waiter whose commits conflict with the base, add nothing, or
 * fail the sentence or pin check is refused alone; one that conflicts only with a waiter stacked
 * before it stays queued. One gate runs on the stack's tip; a red gate is bisected over the
 * stack's prefixes, the first red one refuses its last waiter `gate`, the green prefix before it
 * is pushed, and the waiters after it stay queued. A waiter stopped while queued withdraws its
 * ticket; one that withdrew before the push mark is dropped and the rest is gated again, so what
 * is pushed is always the exact tree the gate passed. A holder that refuses itself claims nobody.
 *
 * Holding the lock, this command is the only writer of `main`, so it alone gives final sentence
 * ids: after each stacked commit's checks, the branch rule of `check-sentences.ts` among them
 * (refused `gate`), it numbers every lane-local id (`ED+1`) and picks a free prefix for every new
 * list (`next: ED+`) through `numberSentences`, in one commit `test: number the sentences this
 * landing adds` whose body lists each `<old> → <new>`, before the next waiter is stacked, so the
 * gate covers the numbered tip; it runs as `--landing`, which judges the tip by the landing rule
 * (final ids running on from the base's `next:`, `next:` right past them) instead of the branch
 * rule this numbering breaks. When the holder does not land, its branch is reset to its
 * own rebased commit, so a branch never carries numbers a landing made.
 *
 * Its stop bound (`docs/operations/release-and-deploy.md`) holds `termGraceMs` for its child, then
 * `remoteReadMs` to read origin. Once the push has started, origin decides: when its `main`
 * contains the pushed tip, the holder and the waiters it pushed print `LANDED <tip>` whatever
 * stopped them; when origin cannot be read, the refusal says the push may have landed.
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
 * Why a landing refused: `conflict` (its commits conflict with `origin/main`, at the rebase, at
 * stacking, or found while queued), `gate` (the gate is red on the stack's shortest red prefix,
 * which ends with this landing, or its sentence lists break the branch rule), `branch`
 * (uncommitted changes or merge commits), `empty` (HEAD adds nothing to origin/main and the
 * landings stacked before it), `pin` (the mate-hq pin is unreadable or not on HQ main), `env` (no
 * mate-hq checkout, stale dependencies), `git` (a git command failed), `contention` (main kept
 * moving), `timeout` (the landing passed its bound after taking the lock), `interrupted`
 * (SIGINT/SIGTERM), `lock` (the landing lock names no holder, so no landing made it), `sentences`
 * (the lists' delta differs from the ids named by `--sentences`, which the branch's code does not
 * fix), `error` (anything unexpected, an unknown argument included).
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

/** What a queued landing prints when a holder or origin decided it: log lines, then the last line. */
type Answer = { readonly log: ReadonlyArray<string>; readonly last: string };

type Holder = { readonly pid: number; readonly started: string };

/** A waiting landing as its ticket and meta name it: what a holder stacks. */
type Ticket = {
  readonly n: number;
  readonly waiter: Holder;
  readonly head: string;
  readonly sentences: ReadonlySet<string>;
};

/** One landing on the round's stack: the holder's own (no ticket) or a waiter's, with its tip. */
type Stacked = {
  readonly ticket: Ticket | undefined;
  readonly tip: string;
  readonly log: ReadonlyArray<string>;
};

let current: NodeChildProcess.ChildProcess | undefined;
let lockDir: string | undefined;
/** This landing's ticket in the queue beside the lock while it waits (`enqueue`). */
let queueEntry: { readonly queue: string; readonly n: number } | undefined;
let rebasing = false;
let picking = false;
let timedOut = false;
let deadlineSeconds = 3600;
let landRoot: string | undefined;
/** The tip being pushed, from the push's start: from then on origin decides the outcome. */
let pushing: { readonly root: string; readonly sha: string } | undefined;
/** The holder's own rebased commit, before its numbering: its branch's place when it does not land. */
let ownCommit: { readonly root: string; readonly sha: string } | undefined;
/** The waiters marked for the push (`markPush`), and their round's record. */
let marked:
  | { readonly queue: string; readonly round: string; readonly stack: ReadonlyArray<Stacked> }
  | undefined;
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
 * The queue directory `Q` holds, per ticket number `n`: `n` (the waiting ticket, `<pid> <start
 * time>`, the only name an earlier version of this command reads), `n.pushing` (the ticket renamed
 * by a holder that marked it for its push), `n.withdrawn` (renamed by its stopped waiter),
 * `n.result` (the lines a holder decided for it), `n.meta` (its waiter, HEAD and sentence ids, in
 * place before its ticket, so a ticket of this version always has it and the ticket file keeps
 * the earlier version's format); per holder that marked a push `round-<pid>` (its tip and the
 * tickets it marked). A rename is atomic, so the holder's mark and the waiter's withdrawal never
 * both succeed.
 */
const queueFile = (queue: string, n: number, suffix = "") => NodePath.join(queue, `${n}${suffix}`);

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Renames `from` to `to`; false when `from` is gone (another party renamed it first). */
function renameIfPresent(from: string, to: string): boolean {
  try {
    NodeFS.renameSync(from, to);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

/** Writes `content` to `path` in one rename, so a reader never sees it half written. */
function writeWhole(path: string, content: string): void {
  const staged = NodePath.join(
    NodePath.dirname(path),
    `.${NodePath.basename(path)}-${process.pid}`,
  );
  NodeFS.writeFileSync(staged, content);
  NodeFS.renameSync(staged, path);
}

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

type Meta = Holder & { readonly head: string; readonly sentences: ReadonlySet<string> };

/** The meta file at `path` (`{pid, started, head, sentences}`), if it parses. */
function parseMeta(path: string): Meta | undefined {
  let value: unknown;
  try {
    value = JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { pid, started: at, head, sentences } = value as Record<string, unknown>;
  if (typeof pid !== "number" || typeof at !== "string" || typeof head !== "string")
    return undefined;
  if (!/^[0-9a-f]{40,64}$/.test(head) || !Array.isArray(sentences)) return undefined;
  if (!sentences.every((id) => typeof id === "string")) return undefined;
  return { pid, started: at, head, sentences: new Set(sentences as ReadonlyArray<string>) };
}

/**
 * The HEAD and sentence ids the waiter of ticket `n` queued with; undefined for a waiter of an
 * earlier version (no meta, or the meta of another waiter that held the number before).
 */
function readMeta(queue: string, n: number, waiter: Holder): Meta | undefined {
  const meta = parseMeta(queueFile(queue, n, ".meta"));
  return meta?.pid === waiter.pid && meta.started === waiter.started ? meta : undefined;
}

/** Removes the meta of ticket `n` when it is `waiter`'s, not that of another holder of the number. */
function forgetMeta(queue: string, n: number, waiter: Holder): void {
  if (readMeta(queue, n, waiter) !== undefined)
    NodeFS.rmSync(queueFile(queue, n, ".meta"), { force: true });
}

/** Removes the ticket `n` of the dead `waiter` and its meta. */
function removeDead(queue: string, n: number, waiter: Holder): void {
  forgetMeta(queue, n, waiter);
  try {
    NodeFS.unlinkSync(queueFile(queue, n));
    process.stderr.write(`land: removed the queue ticket of dead pid ${waiter.pid}\n`);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

/**
 * Records this landing's arrival in `queue` under the next ticket number `n`: first its meta
 * (`n.meta`: waiter, HEAD and sentence ids), then its ticket (`n`, `<pid> <start time>`), each a
 * file linked into place whole, so a holder never sees this version's ticket without its meta and a
 * ticket always names its waiter. A link never replaces a file, so no two waiters hold one number:
 * a number whose meta or ticket is taken (a waiter of this or an earlier version arrived at the
 * same moment) is given up for the next one. A new ticket is above every queue file present, so a
 * number below a live waiter's is never issued again, and removing a dead waiter's ticket never
 * removes another's.
 */
function enqueue(
  queue: string,
  self: string,
  head: string,
  sentences: ReadonlySet<string>,
): number {
  NodeFS.mkdirSync(queue, { recursive: true });
  const stagedMeta = NodePath.join(queue, `.meta-${process.pid}`);
  const staged = NodePath.join(queue, `.new-${process.pid}`);
  NodeFS.writeFileSync(
    stagedMeta,
    JSON.stringify({ pid: process.pid, started: self, head, sentences: [...sentences] }),
  );
  NodeFS.writeFileSync(staged, `${process.pid} ${self}`);
  const link = (from: string, to: string) => {
    try {
      NodeFS.linkSync(from, to);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return false;
    }
  };
  try {
    for (let ticket = highestNumber(queue) + 1; ; ticket++) {
      if (!link(stagedMeta, queueFile(queue, ticket, ".meta"))) continue;
      if (link(staged, queueFile(queue, ticket))) {
        queueEntry = { queue, n: ticket };
        return ticket;
      }
      // An earlier version took this number (it reads no meta): this meta is not its waiter's.
      NodeFS.rmSync(queueFile(queue, ticket, ".meta"), { force: true });
    }
  } finally {
    NodeFS.rmSync(stagedMeta, { force: true });
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

/** Removes this landing's queue files: it holds the lock or it exits. */
function leaveQueue(): void {
  if (queueEntry === undefined) return;
  const { queue, n } = queueEntry;
  queueEntry = undefined;
  // A ticket or meta of this number that names another waiter is not this one's: an earlier
  // version reuses numbers.
  if (parseHolder(queueFile(queue, n))?.pid === process.pid)
    NodeFS.rmSync(queueFile(queue, n), { force: true });
  if (parseMeta(queueFile(queue, n, ".meta"))?.pid === process.pid)
    NodeFS.rmSync(queueFile(queue, n, ".meta"), { force: true });
  for (const suffix of [".pushing", ".withdrawn", ".result"])
    NodeFS.rmSync(queueFile(queue, n, suffix), { force: true });
}

/** The result a holder wrote for ticket `n`, if any. */
function readAnswer(queue: string, n: number): Answer | undefined {
  let text: string;
  try {
    text = NodeFS.readFileSync(queueFile(queue, n, ".result"), "utf8");
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  const lines = text.split("\n").filter(Boolean);
  const last = lines.pop();
  if (last === undefined) return undefined;
  return { log: lines.map((line) => `${line}\n`), last: `${last}\n` };
}

function writeAnswer(queue: string, n: number, log: ReadonlyArray<string>, last: string): void {
  writeWhole(queueFile(queue, n, ".result"), [...log, last].join(""));
}

/** The round that marked ticket `n` for its push: its holder and tip. */
function roundOf(
  queue: string,
  n: number,
): { readonly holder: Holder; readonly tip: string } | undefined {
  for (const name of NodeFS.readdirSync(queue).filter((entry) => /^round-\d+$/.test(entry))) {
    const round = readRound(NodePath.join(queue, name));
    if (round?.tickets.includes(n)) return round;
  }
  return undefined;
}

function readRound(
  path: string,
):
  | { readonly holder: Holder; readonly tip: string; readonly tickets: ReadonlyArray<number> }
  | undefined {
  let value: unknown;
  try {
    value = JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { pid, started: at, tip, tickets: marks } = value as Record<string, unknown>;
  if (typeof pid !== "number" || typeof at !== "string" || typeof tip !== "string")
    return undefined;
  if (!Array.isArray(marks) || !marks.every((n) => typeof n === "number")) return undefined;
  return { holder: { pid, started: at }, tip, tickets: marks as ReadonlyArray<number> };
}

/**
 * Removes what dead landings left in `queue`: tickets marked for a push whose waiter died,
 * results and withdrawals whose ticket is gone, rounds no marked ticket waits on, metas of dead
 * waiters (a live waiter's meta stays: it is in place before its ticket). Run by the holder at its
 * round's start, the only writer then.
 */
function sweep(queue: string): void {
  for (const name of NodeFS.readdirSync(queue)) {
    const marks = /^(\d+)\.pushing$/.exec(name);
    if (marks) {
      const waiter = parseHolder(NodePath.join(queue, name));
      if (waiter !== undefined && alive(waiter)) continue;
      if (waiter !== undefined) forgetMeta(queue, Number(marks[1]), waiter);
      NodeFS.rmSync(NodePath.join(queue, name), { force: true });
    }
  }
  const names = NodeFS.readdirSync(queue);
  const present = new Set(names);
  for (const name of names) {
    const leftover = /^(\d+)\.(?:result|withdrawn)$/.exec(name)?.[1];
    if (leftover !== undefined && !present.has(leftover) && !present.has(`${leftover}.pushing`))
      NodeFS.rmSync(NodePath.join(queue, name), { force: true });
    if (/^round-\d+$/.test(name)) {
      const round = readRound(NodePath.join(queue, name));
      if (!round?.tickets.some((n) => present.has(`${n}.pushing`)))
        NodeFS.rmSync(NodePath.join(queue, name), { force: true });
    }
    if (/^\d+\.meta$/.test(name)) {
      const meta = parseMeta(NodePath.join(queue, name));
      if (meta === undefined || !alive(meta))
        NodeFS.rmSync(NodePath.join(queue, name), { force: true });
    }
  }
}

/**
 * The early conflict probe: whether `head` merges with the local `origin/main`, read without a
 * fetch. A conflict withdraws the ticket and refuses `conflict`, unless a holder already marked it
 * for its push. Probes again only when the ref moved; returns the sha it probed.
 */
async function probe(root: string, n: number, head: string, probed: string | undefined) {
  const main = await git(["rev-parse", "-q", "--verify", "refs/remotes/origin/main"], root);
  if (main.status !== 0 || main.stdout === probed) return probed;
  const merge = await git(
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", main.stdout, head],
    root,
  );
  if (merge.status === 1 && queueEntry !== undefined) {
    const paths = merge.stdout.split("\n").slice(1).filter(Boolean);
    if (
      renameIfPresent(queueFile(queueEntry.queue, n), queueFile(queueEntry.queue, n, ".withdrawn"))
    )
      throw new Refusal(
        "conflict",
        `conflicts with origin/main in: ${paths.join(", ")}, found while queued`,
      );
  }
  return main.stdout;
}

/**
 * What decided ticket `n` once it left the plain queue: the result a holder wrote, else the round
 * that marked it for its push, else nothing (its mark was undone, or never made). The round is read
 * before the result: a holder writes every result before it removes its round, so a round gone
 * with no result means its push did not land for this ticket, never a result missed in between.
 */
function markOf(
  queue: string,
  n: number,
):
  | { readonly answer: Answer }
  | { readonly round: NonNullable<ReturnType<typeof roundOf>> }
  | undefined {
  const round = roundOf(queue, n);
  const answer = readAnswer(queue, n);
  if (answer !== undefined) return { answer };
  return round === undefined ? undefined : { round };
}

/**
 * A ticket marked for a push: waiting while its holder runs; once the holder is dead and wrote no
 * result, origin decides: `LANDED <tip>` when its `main` holds the tip, the ticket back in the
 * queue when not, a refusal when origin cannot be read.
 */
function settleMarked(root: string, queue: string, n: number): Answer | "waiting" | undefined {
  const mark = markOf(queue, n);
  if (mark !== undefined && "answer" in mark) return mark.answer;
  const round = mark?.round;
  if (round !== undefined && alive(round.holder)) return "waiting";
  const back = () => {
    renameIfPresent(queueFile(queue, n, ".pushing"), queueFile(queue, n));
    return undefined;
  };
  if (round === undefined) return back();
  const landed = remoteMainHas(root, round.tip);
  if (landed === true) return { log: [], last: `LANDED ${round.tip}\n` };
  if (landed === undefined)
    throw new Refusal(
      "interrupted",
      `the landing of pid ${round.holder.pid} stopped while pushing ${round.tip}; origin could not be read, the push may have landed`,
    );
  process.stderr.write(
    `land: the landing of pid ${round.holder.pid} stopped before its push landed; waiting again\n`,
  );
  return back();
}

/**
 * Two landings must not gate against the same base: one lock per repository (shared by every
 * worktree). The lock is a directory renamed into place with its `pid` file already in it, so it
 * always names its holder: a process identity (pid and start time), so a holder that died, however
 * it died, releases it to the next waiter, and a reused pid never holds it. A lock that names no
 * holder was not made by this command and is refused `lock` at once. Waiters take the lock in
 * arrival order: each holds a ticket in the queue beside the lock (`enqueue`), and only the oldest
 * live one tries the lock. Node has no advisory file lock, so a waiter looks again every `pollMs`;
 * the wait is unbounded. Each look first reads the result a holder wrote for this ticket, and
 * returns it instead of the lock.
 */
async function acquireLock(
  dir: string,
  root: string,
  head: string,
  named: ReadonlySet<string>,
): Promise<Answer | undefined> {
  const self = started(process.pid);
  if (self === undefined) throw new Refusal("env", "ps cannot report this process's start time");
  const queue = `${dir}.queue`;
  const ticket = enqueue(queue, self, head, named);
  let probed: string | undefined;
  let lastNotice = 0;
  const notice = (line: string) => {
    if (Date.now() - lastNotice < noticeMs) return;
    process.stderr.write(line);
    lastNotice = Date.now();
  };
  const wait = async (line: string) => {
    notice(line);
    await NodeTimersPromises.setTimeout(pollMs);
  };
  for (;;) {
    const answer = readAnswer(queue, ticket);
    if (answer !== undefined) return answer;
    if (NodeFS.existsSync(queueFile(queue, ticket, ".pushing"))) {
      const settled = settleMarked(root, queue, ticket);
      if (settled === "waiting") {
        await wait("land: a holder is pushing this landing\n");
        continue;
      }
      if (settled !== undefined) return settled;
    }
    probed = await probe(root, ticket, head, probed);
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
      // A holder may have decided this ticket between the look above and its release of the lock.
      const late = readAnswer(queue, ticket);
      if (late !== undefined) return late;
      leaveQueue();
      return undefined;
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
}

/** Aborts a rebase or cherry-pick a stop left open, so the worktree is left as it was. */
function abortRebaseSync(root: string): void {
  if (rebasing)
    NodeChildProcess.spawnSync("git", ["rebase", "--abort"], {
      cwd: root,
      stdio: ["ignore", 2, 2],
    });
  if (picking)
    NodeChildProcess.spawnSync("git", ["cherry-pick", "--abort"], {
      cwd: root,
      stdio: ["ignore", 2, 2],
    });
  rebasing = false;
  picking = false;
}

/** Puts the holder's branch back on its own rebased commit: the stack and the numbers did not land. */
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

/** Cherry-picks `from..to` onto HEAD; `conflict` after aborting a conflicting pick. */
async function cherryPick(root: string, from: string, to: string): Promise<"picked" | "conflict"> {
  picking = true;
  const pick = await run("git", ["cherry-pick", "--empty=drop", `${from}..${to}`], { cwd: root });
  if (pick.status === 0) {
    picking = false;
    return "picked";
  }
  const conflicts = await git(["diff", "--name-only", "--diff-filter=U"], root);
  const abort = await run("git", ["cherry-pick", "--abort"], { cwd: root });
  picking = false;
  // Not a refusal of the stacked landing: the holder's worktree is left mid-pick.
  if (abort.status !== 0) throw new Error("a cherry-pick onto the stack could not be aborted");
  if (conflicts.stdout === "") throw new Refusal("git", "cherry-pick onto the stack failed");
  return "conflict";
}

/** The paths where `head` conflicts with `base`: empty when it merges, undefined when unknown. */
async function conflictsWith(root: string, base: string, head: string) {
  const merge = await git(
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", base, head],
    root,
  );
  if (merge.status === 0) return [];
  if (merge.status === 1) return merge.stdout.split("\n").slice(1).filter(Boolean);
  return undefined;
}

/** Checks that a mate-hq checkout is set and fetches its main, once per round. */
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
): { readonly landed?: string; readonly unread?: boolean; readonly line: string } {
  if (pushing === undefined) return { line: refusedLine(kind, reason) };
  const landed = remoteMainHas(pushing.root, pushing.sha);
  if (landed === true) return { landed: pushing.sha, line: `LANDED ${pushing.sha}\n` };
  if (landed === false) return { line: refusedLine(kind, reason) };
  return {
    unread: true,
    line: refusedLine(kind, `${reason}; origin could not be read, the push may have landed`),
  };
}

/**
 * Marks the waiters of `stack` for the push of `tip`: the round's record first, then each ticket
 * renamed to `n.pushing`. False, with every mark undone, when a waiter withdrew or died first.
 */
function markPush(queue: string, stack: ReadonlyArray<Stacked>, tip: string): boolean {
  const waiters = stack.filter((entry) => entry.ticket !== undefined);
  const round = NodePath.join(queue, `round-${process.pid}`);
  writeWhole(
    round,
    JSON.stringify({
      pid: process.pid,
      started: started(process.pid),
      tip,
      tickets: waiters.map((entry) => entry.ticket?.n),
    }),
  );
  marked = { queue, round, stack: waiters };
  for (const [index, entry] of waiters.entries()) {
    const ticket = entry.ticket;
    if (ticket === undefined) continue;
    const kept = renameIfPresent(
      queueFile(queue, ticket.n),
      queueFile(queue, ticket.n, ".pushing"),
    );
    if (kept && alive(ticket.waiter)) continue;
    process.stderr.write(
      `land: the landing of pid ${ticket.waiter.pid} ${kept ? "died" : "withdrew"} before the push; stacking again\n`,
    );
    marked = { queue, round, stack: waiters.slice(0, kept ? index + 1 : index) };
    unmark();
    return false;
  }
  return true;
}

/** Puts the marked tickets back in the queue: their push did not land. */
function unmark(): void {
  if (marked === undefined) return;
  const { queue, round, stack } = marked;
  marked = undefined;
  for (const { ticket } of stack)
    if (ticket !== undefined)
      renameIfPresent(queueFile(queue, ticket.n, ".pushing"), queueFile(queue, ticket.n));
  NodeFS.rmSync(round, { force: true });
}

/** Writes `LANDED <tip>` for every marked ticket: their push landed. */
function settlePushed(tip: string): void {
  if (marked === undefined) return;
  const { queue, round, stack } = marked;
  marked = undefined;
  for (const { ticket, log } of stack)
    if (ticket !== undefined) writeAnswer(queue, ticket.n, log, `LANDED ${tip}\n`);
  NodeFS.rmSync(round, { force: true });
}

/**
 * Numbers the tree's lane-local sentence ids in one commit on top of `sha` and returns the commit
 * and the numbering's lines: `sha` itself when the landing adds no sentence.
 */
async function numberLanding(
  root: string,
  sha: string,
): Promise<{ readonly sha: string; readonly lines: ReadonlyArray<string> }> {
  let result: ReturnType<typeof numberSentences>;
  try {
    result = numberSentences(root);
  } catch (error) {
    throw new Refusal(
      "error",
      `numbering the sentences failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.numbered.length === 0) return { sha, lines: [] };
  const lines = result.numbered.map(({ unit, from, to }) => `${unit}: ${from} → ${to}`);
  const printed = lines.map((line) => `land: numbered ${line}\n`);
  for (const line of printed) process.stderr.write(line);
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
  return { sha: await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root), lines: printed };
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
 * Judges the stacked branch's unnumbered tree against `base`: refuses `gate` when its lists break
 * the branch rule (a final id, a moved `next:` line), so the numbered tip's gate (`--landing`, the
 * landing rule) only ever sees numbers this landing wrote; refuses `sentences` unless the delta is exactly the named ids.
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

/**
 * Stacks one waiter's commits on `previous`: its entry, or undefined when it was refused (its
 * result written, the stack back on `previous`) or stays queued (it conflicts only with a landing
 * stacked before it).
 */
async function stackTicket(
  root: string,
  queue: string,
  base: string,
  previous: string,
  ticket: Ticket,
  checkout: string,
): Promise<Stacked | undefined> {
  const who = `the landing of pid ${ticket.waiter.pid}`;
  try {
    const merges = await gitOk(
      ["rev-list", "--merges", `${base}..${ticket.head}`],
      "git rev-list failed",
      root,
    );
    if (merges !== "")
      throw new Refusal("branch", "HEAD has merge commits; rebase it onto origin/main instead");
    const from = await gitOk(["merge-base", base, ticket.head], "git merge-base failed", root);
    if (from !== ticket.head && (await cherryPick(root, from, ticket.head)) === "conflict") {
      const paths = await conflictsWith(root, base, ticket.head);
      if (paths !== undefined && paths.length > 0)
        throw new Refusal(
          "conflict",
          `conflicts with origin/main in: ${paths.join(", ")}, found at stacking`,
        );
      process.stderr.write(
        `land: ${who} conflicts with a landing stacked before it; it stays queued\n`,
      );
      return undefined;
    }
    const tip = await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
    if (tip === previous)
      throw new Refusal(
        "empty",
        "HEAD adds nothing to origin/main and the tickets stacked before it",
      );
    requireSentences(root, ticket.sentences, previous);
    requirePin(root, checkout);
    const numbered = await numberLanding(root, tip);
    process.stderr.write(`land: stacked ${who} as ${numbered.sha}\n`);
    return { ticket, tip: numbered.sha, log: numbered.lines };
  } catch (error) {
    // A timeout or an unexpected failure stops the round; a refusal of its checks is this waiter's.
    if (!(error instanceof Refusal) || error.kind === "timeout") throw error;
    await reset(root, previous);
    writeAnswer(queue, ticket.n, [], refusedLine(error.kind, error.message));
    process.stderr.write(`land: refused ${who}: ${error.kind}\n`);
    return undefined;
  }
}

/** Claims every live waiter of the current version in ticket order and stacks it on `ownTip`. */
async function buildStack(
  root: string,
  queue: string,
  base: string,
  ownTip: string,
  checkout: string,
): Promise<Stacked[]> {
  const stack: Stacked[] = [{ ticket: undefined, tip: ownTip, log: [] }];
  let tip = ownTip;
  for (const n of tickets(queue)) {
    if (NodeFS.existsSync(queueFile(queue, n, ".result"))) continue;
    const waiter = parseHolder(queueFile(queue, n));
    if (waiter === undefined) continue;
    if (!alive(waiter)) {
      removeDead(queue, n, waiter);
      continue;
    }
    // A waiter of an earlier version has no meta: it lands alone in its turn.
    const meta = readMeta(queue, n, waiter);
    if (meta === undefined) continue;
    const ticket = { n, waiter, head: meta.head, sentences: meta.sentences };
    const entry = await stackTicket(root, queue, base, tip, ticket, checkout);
    if (entry === undefined) continue;
    stack.push(entry);
    tip = entry.tip;
  }
  return stack;
}

/**
 * Gates the stack's tip; when red, bisects the stack's prefixes for the shortest red one, refuses
 * its last waiter `gate` and leaves the worktree on the green prefix before it. Returns the index
 * of the last green entry; a red holder alone refuses the holder.
 */
async function gateStack(
  root: string,
  queue: string,
  base: string,
  stack: ReadonlyArray<Stacked>,
): Promise<number> {
  const at = (index: number) => {
    const entry = stack[index];
    if (entry === undefined) throw new Error(`no stack entry ${index}`);
    return entry;
  };
  const red = async (index: number) => {
    await reset(root, at(index).tip);
    await requireInstalledDependencies(root);
    // A worker can write this worktree's receipt and the shared stage cache, so the gate of `main`
    // reuses neither: `--full` runs every stage itself. The tip carries the numbers this round
    // wrote after `requireSentences` judged each branch by the branch rule: `--landing`.
    const gate = await run(
      process.execPath,
      [NodePath.join(root, "scripts/gate-changed.ts"), "--base", base, "--full", "--landing"],
      { cwd: root },
    );
    return gate.status !== 0;
  };
  const last = stack.length - 1;
  if (!(await red(last))) return last;
  let low = 0;
  let high = last;
  if (last > 0)
    process.stderr.write(`land: the gate is red on the stack of ${stack.length}; bisecting\n`);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    process.stderr.write(`land: gating the first ${middle + 1} of the stack\n`);
    if (await red(middle)) high = middle;
    else low = middle + 1;
  }
  const culprit = at(high);
  if (culprit.ticket === undefined) throw new Refusal("gate", `gate red on ${culprit.tip}`);
  writeAnswer(
    queue,
    culprit.ticket.n,
    culprit.log,
    refusedLine("gate", `gate red on ${culprit.tip}, stacked on ${base} after ${high} tickets`),
  );
  process.stderr.write(`land: refused the landing of pid ${culprit.ticket.waiter.pid}: gate\n`);
  await reset(root, at(high - 1).tip);
  return high - 1;
}

/** The round: the holder's own checks, the stack, one gate (bisected when red), one push. */
async function holdRound(root: string, queue: string, named: ReadonlySet<string>): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    sweep(queue);
    await gitOk(["fetch", "-q", "origin", "main"], "git fetch origin main failed", root);
    // The round's base, read by name once: waiters' probes and other fetches share the ref.
    const base = await gitOk(
      ["rev-parse", "refs/remotes/origin/main"],
      "origin/main unavailable",
      root,
    );
    if (
      (await gitOk(["rev-list", "--merges", `${base}..HEAD`], "git rev-list failed", root)) !== ""
    )
      throw new Refusal("branch", "HEAD has merge commits; rebase it onto origin/main instead");
    await rebaseOnto(root, base);
    const own = await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
    if (own === base) throw new Refusal("empty", "HEAD adds nothing to origin/main");
    ownCommit = { root, sha: own };
    requireSentences(root, named, base);
    const checkout = await fetchHq();
    requirePin(root, checkout);
    const ownTip = (await numberLanding(root, own)).sha;

    let stack: ReadonlyArray<Stacked>;
    let tip: string;
    for (;;) {
      await reset(root, ownTip);
      const built = await buildStack(root, queue, base, ownTip, checkout);
      stack = built.slice(0, (await gateStack(root, queue, base, built)) + 1);
      tip = stack.at(-1)?.tip ?? ownTip;
      if (markPush(queue, stack, tip)) break;
    }
    if (stack.length > 1)
      process.stderr.write(`land: pushing ${tip} with ${stack.length - 1} more landings\n`);
    pushing = { root, sha: tip };
    const push = await run("git", ["push", "-q", "origin", `${tip}:refs/heads/main`], {
      cwd: root,
    });
    if (push.status === 0 || remoteMainHas(root, tip) === true) {
      settlePushed(tip);
      ownCommit = undefined;
      return tip;
    }
    pushing = undefined;
    unmark();
    await reset(root, own);
    await gitOk(["fetch", "-q", "origin", "main"], "git fetch origin main failed", root);
    const moved = await gitOk(
      ["rev-parse", "refs/remotes/origin/main"],
      "origin/main unavailable",
      root,
    );
    if (moved === base) throw new Refusal("git", "git push to origin main failed");
    process.stderr.write(`land: main moved to ${moved} during the gate; landing again\n`);
  }
  throw new Refusal("contention", `main moved ${attempts} times during the gate`);
}

/** Lands this worktree's HEAD: as the holder of a round, or as a waiter a holder decided. */
async function land(args: ReadonlyArray<string>): Promise<string | Answer> {
  const named = readSentences(args);
  deadlineSeconds = readDeadline();
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
  const head = await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
  const lock = NodePath.join(common, "land.lock");
  const answer = await acquireLock(lock, root, head, named);
  if (answer !== undefined) return answer;
  // The bound starts once the lock is held: waiting for another landing is no hung landing.
  process.stderr.write("land: holding the landing lock\n");
  const deadline = setTimeout(() => {
    timedOut = true;
    process.stderr.write(`land: ${timeoutReason()}; stopping it\n`);
    stopCurrent("SIGTERM");
  }, deadlineSeconds * 1000);
  deadline.unref();

  const now = await gitOk(["rev-parse", "HEAD"], "HEAD unavailable", root);
  if (now !== head) {
    if (!(await clean())) throw new Refusal("branch", "the worktree has uncommitted changes");
    process.stderr.write(
      `land: HEAD moved to ${now} while queued; landing ${head}, its HEAD then\n`,
    );
    await reset(root, head);
  }
  return holdRound(root, `${lock}.queue`, named);
}

/**
 * The outcome of a queued landing stopped by `signal`: withdrawn when its ticket is still queued;
 * once a holder marked it for its push, origin decides.
 */
function stoppedWaiter(signal: NodeJS.Signals): Answer {
  const reason = `interrupted by ${signal}`;
  const refused = { log: [], last: refusedLine("interrupted", reason) };
  if (queueEntry === undefined) return refused;
  const { queue, n } = queueEntry;
  if (renameIfPresent(queueFile(queue, n), queueFile(queue, n, ".withdrawn"))) return refused;
  const mark = markOf(queue, n);
  if (mark !== undefined && "answer" in mark) return mark.answer;
  if (mark === undefined || landRoot === undefined) return refused;
  const { round } = mark;
  const landed = remoteMainHas(landRoot, round.tip);
  if (landed === true) return { log: [], last: `LANDED ${round.tip}\n` };
  if (landed === false && !alive(round.holder)) return refused;
  const why =
    landed === false
      ? `the landing of pid ${round.holder.pid} is pushing ${round.tip}`
      : "origin could not be read";
  return {
    log: [],
    last: refusedLine("interrupted", `${reason}; ${why}, the push may have landed`),
  };
}

/** Prints an answer: its log to stderr, `LANDED` to stdout, a refusal to stderr; the exit code. */
function printAnswer(answer: Answer): number {
  for (const line of answer.log) process.stderr.write(line);
  if (answer.last.startsWith("LANDED ")) {
    process.stdout.write(answer.last);
    return 0;
  }
  process.stderr.write(answer.last);
  return 1;
}

/**
 * The holder's ending when it did not finish its round: the marked waiters land with it when the
 * push landed, go back to the queue when it did not, and stay marked for origin to decide when
 * origin could not be read; its branch goes back to its own rebased commit unless it landed.
 */
function endHolder(outcome: ReturnType<typeof stoppedOutcome>): void {
  if (outcome.landed !== undefined) {
    settlePushed(outcome.landed);
    return;
  }
  if (!outcome.unread) unmark();
  resetOwnSync();
}

if (import.meta.main) {
  process.on("exit", leaveQueue);
  process.on("exit", releaseLock);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.on(signal, () => {
      if (queueEntry !== undefined) {
        const status = printAnswer(stoppedWaiter(signal));
        process.exit(status === 0 ? 0 : code);
      }
      const finish = () => {
        if (landRoot !== undefined) abortRebaseSync(landRoot);
        const outcome = stoppedOutcome("interrupted", `interrupted by ${signal}`);
        endHolder(outcome);
        releaseLock();
        if (outcome.landed === undefined) {
          process.stderr.write(outcome.line);
          process.exit(code);
        }
        process.stdout.write(outcome.line);
        process.exit(0);
      };
      if (current === undefined || current.exitCode !== null) return finish();
      current.once("close", finish);
      stopCurrent(signal);
    });
  }
  land(process.argv.slice(2)).then(
    (result) => {
      releaseLock();
      if (typeof result === "string") process.stdout.write(`LANDED ${result}\n`);
      else process.exitCode = printAnswer(result);
    },
    (error: unknown) => {
      // A timeout can stop the rebase or a cherry-pick midway; the worktree is left as it was.
      if (landRoot !== undefined) abortRebaseSync(landRoot);
      const outcome =
        error instanceof Refusal
          ? stoppedOutcome(error.kind, error.message)
          : stoppedOutcome("error", error instanceof Error ? error.message : String(error));
      endHolder(outcome);
      releaseLock();
      if (outcome.landed !== undefined) {
        process.stdout.write(outcome.line);
        return;
      }
      process.stderr.write(outcome.line);
      process.exitCode = 1;
    },
  );
}
