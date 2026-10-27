/**
 * The working copies an automated Mate works a task on: every mounted dev service's `/var/www`
 * (the reach `ZeropsCommitAuthor` writes its author through), put on the task's base before its
 * work starts. Each task delivers to a change of its own, while the working copy on each dev
 * service is one local branch (zcp's `mate/<project id>`): a new task starts from `main` as HQ's
 * git holds it, and a follow-up on an earlier task from that task's change branch — in the working
 * copy of the change's own repository (its `origin` names it; numbers are per repository), every
 * other working copy from `main` — so no task's work carries another's.
 *
 * On each working copy: its work kept first — uncommitted work stashed (`mate: kept before task
 * <id>`), commits on no remote branch kept on `mate-kept/<task it held>-<commit>`, a name never
 * written over — then the local branch, under
 * the name zcp gave it, reset onto the base (`git checkout -B`). A working copy already at the
 * base, and clean, is left alone. Either way the branch tracks the base the task starts from, never
 * the change an earlier task pushed it to (zcp's `push -u`). A step that fails leaves that working
 * copy as it is (anything kept before stays kept) and is named; the others move on. Never a force,
 * never a lost commit.
 *
 * Read only, a task's end asks which working copies hold work never delivered (`undelivered`):
 * changes to tracked files, or commits on no remote branch — a delivery pushes its branch to HQ's
 * git, which leaves none. New files count only where the task's work started on a clean working
 * copy (put on its base, every file it held kept away), so they are the task's own.
 *
 * A pool container a thread's agent leased is that thread's working copy, never one of these.
 *
 * @module ZeropsWorkingCopy
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { VcsProcess } from "../vcs/VcsProcess.ts";
import {
  isLeaseRepository,
  ZeropsRepositorySource,
  type ZeropsRepository,
} from "./ZeropsRepositorySource.ts";

/** How long one local git step on a dev service may take, its SSH included. */
const STEP_TIMEOUT_MS = 30_000;
/** How long a fetch from HQ's git may take. */
const FETCH_TIMEOUT_MS = 120_000;

/** The branch every task's change lands on, as HQ's git holds it. */
const MAIN = "main";

/** Where a task's work starts: HQ's `main`, or its change's branch on HQ's git. */
export type WorkingCopyBase =
  | { readonly kind: "main" }
  | { readonly kind: "change"; readonly repo: string; readonly branch: string };

/**
 * What putting the working copies on a task did: the dev services (by host) left as they were,
 * and whether the working copies could not be listed at all.
 */
export interface WorkingCopiesHeld {
  readonly missed: ReadonlyArray<string>;
  readonly unlisted: boolean;
}

export class ZeropsWorkingCopy extends Context.Service<
  ZeropsWorkingCopy,
  {
    /**
     * Every working copy put on `base` for the task `taskId`, each that could not be named; what
     * they held kept under the task they held, `held`, where known.
     */
    readonly hold: (
      taskId: string,
      base: WorkingCopyBase,
      held?: string,
    ) => Effect.Effect<WorkingCopiesHeld>;
    /**
     * The dev services (by host) whose working copy of a repository on HQ's git holds work never
     * delivered: changes to tracked files — new files too, `withNew` — or commits on no remote
     * branch. One git cannot read is left out; none where none is reached.
     */
    readonly undelivered: (withNew: boolean) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("t3/zerops/ZeropsWorkingCopy") {}

/** A task's short name: the first eight characters of its id. */
const shortOf = (taskId: string) => taskId.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 8) || "task";

/** The repository an `origin` on HQ's git names: its last path segment, `.git` off. */
export const repoOfOrigin = (url: string): string | undefined => {
  const last = url
    .trim()
    .replace(/\/+$/u, "")
    .split("/")
    .at(-1)
    ?.replace(/\.git$/u, "");
  if (last === undefined || last === "") return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return undefined;
  }
};

export const make = Effect.gen(function* () {
  const source = yield* ZeropsRepositorySource;
  const vcs = yield* VcsProcess;

  const hostOf = (
    repository: ZeropsRepository,
    taskId: string,
    base: WorkingCopyBase,
    held: string | undefined,
  ) => {
    const git = (args: ReadonlyArray<string>, timeoutMs = STEP_TIMEOUT_MS) =>
      vcs.run({
        operation: "ZeropsWorkingCopy.hold",
        command: "git",
        args,
        cwd: repository.mountPath,
        timeoutMs,
      });
    /** A ref's commit, none where it does not resolve. */
    const commitOf = (ref: string) =>
      Effect.map(
        vcs.run({
          operation: "ZeropsWorkingCopy.hold",
          command: "git",
          args: ["rev-parse", "-q", "--verify", `${ref}^{commit}`],
          cwd: repository.mountPath,
          timeoutMs: STEP_TIMEOUT_MS,
          allowNonZeroExit: true,
        }),
        (output) => (output.exitCode === 0 ? output.stdout.trim() || undefined : undefined),
      );
    const fetched = (branch: string) =>
      git(
        [
          "fetch",
          "--no-tags",
          "-q",
          "origin",
          `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
        ],
        FETCH_TIMEOUT_MS,
      );
    return Effect.gen(function* () {
      const branch = (yield* git(["symbolic-ref", "-q", "--short", "HEAD"])).stdout.trim();
      if (branch === "") return yield* Effect.fail("detached");
      yield* fetched(MAIN);
      // A change's branch lives in its own repository's git: a working copy of another starts
      // from `main` (a branch of the same number there is another change's).
      const origin = yield* vcs.run({
        operation: "ZeropsWorkingCopy.hold",
        command: "git",
        args: ["remote", "get-url", "origin"],
        cwd: repository.mountPath,
        timeoutMs: STEP_TIMEOUT_MS,
        allowNonZeroExit: true,
      });
      const onChange =
        base.kind === "change" &&
        origin.exitCode === 0 &&
        repoOfOrigin(origin.stdout) === base.repo;
      if (onChange) yield* fetched(base.branch);
      const ref = onChange ? base.branch : MAIN;
      const target = yield* commitOf(`refs/remotes/origin/${ref}`);
      if (target === undefined) return yield* Effect.fail("no base");
      // Written whole, not by `--track`: the fetch above names its refspec, which `origin` may lack.
      const tracksBase = Effect.andThen(
        git(["config", `branch.${branch}.remote`, "origin"]),
        git(["config", `branch.${branch}.merge`, `refs/heads/${ref}`]),
      );
      const dirty = (yield* git(["status", "--porcelain"])).stdout.trim() !== "";
      if (!dirty && (yield* commitOf("HEAD")) === target) return yield* tracksBase;
      if (dirty) yield* git(["stash", "push", "-u", "-m", `mate: kept before task ${taskId}`]);
      // Commits on no remote branch are nobody's but this working copy's: kept under a name.
      const unpushed = (yield* git([
        "rev-list",
        "--count",
        "HEAD",
        "--not",
        "--remotes=origin",
      ])).stdout.trim();
      if (unpushed !== "" && unpushed !== "0") {
        // Named after what it keeps — the task the working copy held, its commit — and never
        // written over: kept again unchanged, it is already there.
        const head = (yield* commitOf("HEAD")) ?? "";
        const kept = `mate-kept/${shortOf(held ?? "work")}-${head.slice(0, 7)}`;
        if ((yield* commitOf(`refs/heads/${kept}`)) === undefined)
          yield* git(["branch", kept, "HEAD"]);
      }
      yield* git(["checkout", "-q", "--no-track", "-B", branch, `refs/remotes/origin/${ref}`]);
      yield* tracksBase;
    }).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.as(
          Effect.logWarning("zerops working copy: left as it was", {
            host: repository.host,
            taskId,
            error: typeof error === "string" ? error : error.message,
          }),
          repository.host,
        ),
      ),
    );
  };

  /** The dev services' working copies, a lease's mount left to its thread. */
  const devServices = (repositories: ReadonlyArray<ZeropsRepository>) =>
    repositories.filter((repository) => !isLeaseRepository(repository));

  const hold = (taskId: string, base: WorkingCopyBase, held?: string) =>
    Effect.gen(function* () {
      const listed = yield* source.list;
      // Not in a Zerops container: no dev service, no working copy of its.
      if (listed._tag === "disabled") return { missed: [], unlisted: false };
      if (listed._tag === "unavailable") {
        yield* Effect.logWarning("zerops working copy: the working copies could not be listed", {
          reason: listed.reason,
        });
        return { missed: [], unlisted: true };
      }
      const missed = yield* Effect.forEach(
        devServices(listed.repositories),
        (repository) => hostOf(repository, taskId, base, held),
        { concurrency: "unbounded" },
      );
      return { missed: missed.filter((host) => host !== undefined), unlisted: false };
    });

  /** Whether the working copy holds work never delivered; none where git cannot read it. */
  const holdsUndelivered = (repository: ZeropsRepository, withNew: boolean) => {
    const git = (args: ReadonlyArray<string>) =>
      Effect.map(
        vcs.run({
          operation: "ZeropsWorkingCopy.undelivered",
          command: "git",
          args,
          cwd: repository.mountPath,
          timeoutMs: STEP_TIMEOUT_MS,
          allowNonZeroExit: true,
        }),
        (output) => (output.exitCode === 0 ? output.stdout.trim() : undefined),
      );
    return Effect.gen(function* () {
      // A working copy of no repository on HQ's git delivers nowhere.
      if ((yield* git(["remote", "get-url", "origin"])) === undefined) return false;
      const status = withNew
        ? ["status", "--porcelain"]
        : ["status", "--porcelain", "--untracked-files=no"];
      const changed = yield* git(status);
      if (changed === undefined) return false;
      if (changed !== "") return true;
      const unpushed = yield* git(["rev-list", "--count", "HEAD", "--not", "--remotes=origin"]);
      return unpushed !== undefined && unpushed !== "" && unpushed !== "0";
    }).pipe(
      Effect.catch((error) =>
        Effect.as(
          Effect.logWarning("zerops working copy: could not read what it holds", {
            host: repository.host,
            error: error.message,
          }),
          false,
        ),
      ),
    );
  };

  const undelivered = (withNew: boolean) =>
    Effect.gen(function* () {
      const listed = yield* source.list;
      if (listed._tag !== "available") return [];
      const held = yield* Effect.forEach(
        devServices(listed.repositories),
        (repository) =>
          Effect.map(holdsUndelivered(repository, withNew), (holds) =>
            holds ? repository.host : undefined,
          ),
        { concurrency: "unbounded" },
      );
      return held.filter((host) => host !== undefined);
    });

  return ZeropsWorkingCopy.of({ hold, undelivered });
});

export const layer = Layer.effect(ZeropsWorkingCopy, make);
