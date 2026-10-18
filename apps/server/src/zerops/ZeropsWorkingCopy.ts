/**
 * The working copies an automated Mate works a task on: every mounted dev service's `/var/www`
 * (the reach `ZeropsCommitAuthor` writes its author through), put on the task's base before its
 * work starts. Each task delivers to a change of its own, while the working copy on each dev
 * service is one local branch (zcp's `mate/<project id>`): a new task starts from `main` as HQ's
 * git holds it, and a follow-up on an earlier task from that task's change branch, so no task's
 * work carries another's.
 *
 * On each working copy: its work kept first — uncommitted work stashed (`mate: kept before task
 * <id>`), commits on no remote branch kept on `mate-kept/<short id>` — then the local branch, under
 * the name zcp gave it, reset onto the base (`git checkout -B`). A working copy already at the
 * base, and clean, is left alone. A step that fails leaves that working copy as it is (anything
 * kept before stays kept) and is named; the others move on. Never a force, never a lost commit.
 *
 * @module ZeropsWorkingCopy
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { VcsProcess } from "../vcs/VcsProcess.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "./ZeropsRepositorySource.ts";

/** How long one local git step on a dev service may take, its SSH included. */
const STEP_TIMEOUT_MS = 30_000;
/** How long a fetch from HQ's git may take. */
const FETCH_TIMEOUT_MS = 120_000;

/** The branch every task's change lands on, as HQ's git holds it. */
const MAIN = "main";

/** Where a task's work starts: HQ's `main`, or its change's branch on HQ's git. */
export type WorkingCopyBase =
  | { readonly kind: "main" }
  | { readonly kind: "change"; readonly branch: string };

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
    /** Every working copy put on `base` for the task `taskId`, each that could not be named. */
    readonly hold: (taskId: string, base: WorkingCopyBase) => Effect.Effect<WorkingCopiesHeld>;
  }
>()("t3/zerops/ZeropsWorkingCopy") {}

/** The short name a task's kept work goes under: the first eight characters of its id. */
const shortOf = (taskId: string) => taskId.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 8) || "task";

export const make = Effect.gen(function* () {
  const source = yield* ZeropsRepositorySource;
  const vcs = yield* VcsProcess;

  const hostOf = (repository: ZeropsRepository, taskId: string, base: WorkingCopyBase) => {
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
      // from `main`.
      const onChange =
        base.kind === "change"
          ? yield* fetched(base.branch).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            )
          : false;
      const ref = onChange && base.kind === "change" ? base.branch : MAIN;
      const target = yield* commitOf(`refs/remotes/origin/${ref}`);
      if (target === undefined) return yield* Effect.fail("no base");
      const dirty = (yield* git(["status", "--porcelain"])).stdout.trim() !== "";
      if (!dirty && (yield* commitOf("HEAD")) === target) return;
      if (dirty) yield* git(["stash", "push", "-u", "-m", `mate: kept before task ${taskId}`]);
      // Commits on no remote branch are nobody's but this working copy's: kept under a name.
      const unpushed = (yield* git([
        "rev-list",
        "--count",
        "HEAD",
        "--not",
        "--remotes=origin",
      ])).stdout.trim();
      if (unpushed !== "" && unpushed !== "0")
        yield* git(["branch", "-f", `mate-kept/${shortOf(taskId)}`, "HEAD"]);
      yield* git(["checkout", "-q", "--no-track", "-B", branch, `refs/remotes/origin/${ref}`]);
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

  const hold = (taskId: string, base: WorkingCopyBase) =>
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
        listed.repositories,
        (repository) => hostOf(repository, taskId, base),
        { concurrency: "unbounded" },
      );
      return { missed: missed.filter((host) => host !== undefined), unlisted: false };
    });

  return ZeropsWorkingCopy.of({ hold });
});

export const layer = Layer.effect(ZeropsWorkingCopy, make);
