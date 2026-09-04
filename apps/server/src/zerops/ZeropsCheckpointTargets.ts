/**
 * ZeropsCheckpointTargets - one turn, N repositories.
 *
 * Upstream a thread has exactly one working tree, so a checkpoint is one
 * capture, one diff and one restore. On Zerops the thread's cwd is the
 * workspace root `/var/www`, which is not a repository at all: the
 * repositories are the mounted dev services inside it, each with its own
 * `.git` on its own disk. A turn that edits `kanbandev` and `apidev` must
 * therefore produce a checkpoint in each, and one diff that reads grouped by
 * service.
 *
 * Two facts make this cheaper than it sounds. The checkpoint ref carries the
 * thread and turn (`refs/t3/checkpoints/<thread>/turn/<n>`) and each
 * repository has its own ref store, so **the same ref string names the turn in
 * every repository** - no rename, and no migration of the projection, which
 * keeps its single `checkpoint_ref` column and recovers the repository set at
 * read time. And the repositories are on different hosts, so the captures run
 * concurrently: three repositories cost what one does.
 *
 * Failure is per repository. A capture that fails, or one refused by the
 * untracked-file guard, must not cost the other repositories their history -
 * capture is best-effort at this layer, and half a turn's history beats none.
 *
 * @module ZeropsCheckpointTargets
 */
import * as Effect from "effect/Effect";

import { CheckpointRef, type ThreadId } from "@t3tools/contracts";

import type * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { parseTurnDiffFilesFromNumstat } from "../checkpointing/Diffs.ts";
import { checkpointRefsPrefixForThread } from "../checkpointing/Utils.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import type { ZeropsRepositories } from "./ZeropsRepositorySource.ts";

/** One repository a checkpoint covers, and how its paths join the turn diff. */
export interface CheckpointTarget {
  /** Where the checkpoint operations run. */
  readonly cwd: string;
  /** `<host>/` when several repositories share one diff, `""` when one does. */
  readonly prefix: string;
}

/**
 * How much `ls-files --others` output the guard reads before it decides the
 * repository has no usable `.gitignore`.
 *
 * The threshold is not a number this module invents: it reads the executor's
 * own truncation flag at this cap, which is roughly four thousand paths. A
 * repository past that is the 245-second first checkpoint measured in S0.3 -
 * `add -A` walking a `node_modules` nobody meant to commit.
 */
export const UNTRACKED_PROBE_MAX_BYTES = 256 * 1024;

const UNTRACKED_REFUSAL_REASON =
  "This repository has thousands of untracked files and no usable .gitignore, so a checkpoint would commit them. Add a .gitignore, then checkpoints resume by themselves.";

const isUnder = (candidate: string, root: string): boolean =>
  candidate === root || candidate.startsWith(`${root}/`);

/**
 * Which repositories a checkpoint taken at `cwd` covers.
 *
 * - Not Zerops, or a topology we could not read: the single upstream target.
 *   An unreadable topology must never silently reduce a turn's history.
 * - A cwd that *contains* mounted repositories: one target each, prefixed by
 *   the path from the cwd, so the merged diff reads grouped by service.
 * - A cwd *inside* one repository: that repository alone, unprefixed - the
 *   paths are already relative to the thing the user is looking at.
 * - A Zerops project with no mounted repository: no targets at all. That is
 *   "no repositories yet", which the caller reports as a fact rather than an
 *   error.
 */
export const resolveCheckpointTargets = (
  cwd: string,
  repositories: ZeropsRepositories,
): ReadonlyArray<CheckpointTarget> => {
  if (repositories._tag !== "available") {
    return [{ cwd, prefix: "" }];
  }
  if (repositories.repositories.length === 0) {
    return [];
  }

  const contained = repositories.repositories.filter((repository) =>
    isUnder(repository.mountPath, cwd),
  );
  if (contained.length > 0) {
    return contained.map((repository) => ({
      cwd: repository.mountPath,
      prefix: repository.mountPath === cwd ? "" : `${repository.mountPath.slice(cwd.length + 1)}/`,
    }));
  }

  // Either a path inside one repository, or an ordinary repository elsewhere
  // on the container - both are the upstream single-target case.
  return [{ cwd, prefix: "" }];
};

export interface CheckpointDiffFile {
  readonly path: string;
  readonly kind: "modified";
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Joins each repository's diff into the one flat `files[]` the turn contract
 * already carries. Sorting by the prefixed path is what makes the list render
 * grouped by service without a single contract change.
 */
export const mergeCheckpointFiles = (
  parts: ReadonlyArray<{
    readonly prefix: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
    }>;
  }>,
): ReadonlyArray<CheckpointDiffFile> =>
  parts
    .flatMap((part) =>
      part.files.map((file) => ({
        path: `${part.prefix}${file.path}`,
        kind: "modified" as const,
        additions: file.additions,
        deletions: file.deletions,
      })),
    )
    .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

const prefixMetadataPath = (path: string, prefix: string): string => {
  if (path === "/dev/null") {
    return path;
  }
  if (path.startsWith('"') && path.endsWith('"')) {
    return `"${prefix}${path.slice(1)}`;
  }
  return `${prefix}${path}`;
};

const prefixFileHeaderPath = (path: string, prefix: string): string => {
  if (path === "/dev/null") {
    return path;
  }
  if (path.startsWith('"a/') || path.startsWith('"b/')) {
    return `${path.slice(0, 3)}${prefix}${path.slice(3)}`;
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return `${path.slice(0, 2)}${prefix}${path.slice(2)}`;
  }
  return path;
};

const prefixDiffHeader = (line: string, prefix: string): string => {
  const quoted = /^diff --git "a\/(.*)" "b\/(.*)"$/.exec(line);
  if (quoted) {
    return `diff --git "a/${prefix}${quoted[1]}" "b/${prefix}${quoted[2]}"`;
  }

  const plain = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
  return plain ? `diff --git a/${prefix}${plain[1]} b/${prefix}${plain[2]}` : line;
};

const prefixBinaryHeader = (line: string, prefix: string): string => {
  const quoted = /^Binary files "a\/(.*)" and "b\/(.*)" differ$/.exec(line);
  if (quoted) {
    return `Binary files "a/${prefix}${quoted[1]}" and "b/${prefix}${quoted[2]}" differ`;
  }

  const plain = /^Binary files a\/(.*?) and b\/(.*) differ$/.exec(line);
  return plain ? `Binary files a/${prefix}${plain[1]} and b/${prefix}${plain[2]} differ` : line;
};

/** Prefixes Git patch metadata while leaving hunk bodies byte-for-byte intact. */
const prefixUnifiedPatch = (patch: string, prefix: string): string => {
  if (prefix.length === 0 || patch.length === 0) {
    return patch;
  }

  let inFileMetadata = false;
  return patch
    .split("\n")
    .map((rawLine) => {
      const carriageReturn = rawLine.endsWith("\r") ? "\r" : "";
      const line = carriageReturn.length > 0 ? rawLine.slice(0, -1) : rawLine;

      if (line.startsWith("diff --git ")) {
        inFileMetadata = true;
        return `${prefixDiffHeader(line, prefix)}${carriageReturn}`;
      }
      if (!inFileMetadata) {
        return rawLine;
      }
      if (line.startsWith("@@")) {
        inFileMetadata = false;
        return rawLine;
      }
      if (line === "GIT binary patch") {
        inFileMetadata = false;
        return rawLine;
      }
      if (line.startsWith("Binary files ")) {
        inFileMetadata = false;
        return `${prefixBinaryHeader(line, prefix)}${carriageReturn}`;
      }
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        const marker = line.slice(0, 4);
        const pathWithTimestamp = line.slice(4);
        const timestampIndex = pathWithTimestamp.indexOf("\t");
        const path =
          timestampIndex === -1 ? pathWithTimestamp : pathWithTimestamp.slice(0, timestampIndex);
        const timestamp = timestampIndex === -1 ? "" : pathWithTimestamp.slice(timestampIndex);
        return `${marker}${prefixFileHeaderPath(path, prefix)}${timestamp}${carriageReturn}`;
      }
      for (const marker of ["rename from ", "rename to ", "copy from ", "copy to "] as const) {
        if (line.startsWith(marker)) {
          return `${marker}${prefixMetadataPath(line.slice(marker.length), prefix)}${carriageReturn}`;
        }
      }
      return rawLine;
    })
    .join("\n");
};

/** Reads and joins the same checkpoint range from every repository it covers. */
export const diffAcrossTargets = (
  store: CheckpointStore.CheckpointStore["Service"],
  input: {
    readonly targets: ReadonlyArray<CheckpointTarget>;
    readonly fromCheckpointRef: CheckpointRef;
    readonly toCheckpointRef: CheckpointRef;
    readonly fallbackFromToHead: boolean;
    readonly ignoreWhitespace: boolean;
  },
) =>
  Effect.forEach(
    input.targets,
    (target) =>
      store
        .diffCheckpoints({
          cwd: target.cwd,
          fromCheckpointRef: input.fromCheckpointRef,
          toCheckpointRef: input.toCheckpointRef,
          fallbackFromToHead: input.fallbackFromToHead,
          ignoreWhitespace: input.ignoreWhitespace,
        })
        .pipe(Effect.map((patch) => prefixUnifiedPatch(patch, target.prefix))),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((patches) =>
      patches.reduce(
        (merged, patch) =>
          patch.length === 0
            ? merged
            : merged.length === 0
              ? patch
              : `${merged}${merged.endsWith("\n") || patch.startsWith("\n") ? "" : "\n"}${patch}`,
        "",
      ),
    ),
  );

export interface CaptureAcrossTargetsResult {
  /** The merged, prefixed, sorted turn diff. */
  readonly files: ReadonlyArray<CheckpointDiffFile>;
  /** Repositories that now hold the checkpoint. */
  readonly captured: ReadonlyArray<string>;
  /** Repositories that do not, and why - a refusal or a failure. */
  readonly skipped: ReadonlyArray<{ readonly cwd: string; readonly reason: string }>;
  /** Repositories whose pre-turn baseline ref was absent. */
  readonly missingBaseline: ReadonlyArray<string>;
  /**
   * Repositories that hold the checkpoint but whose diff could not be read.
   * A separate outcome from `skipped`: the history is safe, only the summary
   * is missing, and the user is told which is which.
   */
  readonly diffUnavailable: ReadonlyArray<{ readonly cwd: string; readonly reason: string }>;
}

export interface CaptureAcrossTargetsInput {
  readonly targets: ReadonlyArray<CheckpointTarget>;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
}

/** What a fan-out needs to reach the repositories it covers. */
export interface CheckpointFanOut {
  readonly store: CheckpointStore.CheckpointStore["Service"];
  readonly vcsProcess: VcsProcess.VcsProcess["Service"];
}

/**
 * Asks, every single time, whether this repository's untracked set would
 * swallow the checkpoint.
 *
 * Deliberately not memoised. An earlier version remembered which repositories
 * it had already probed, which read like a free optimisation and was in fact
 * the whole guard: the reactor drives the baseline twice per turn - once for
 * `thread.turn-start-requested`, once for `thread.message-sent` - so the second
 * call skipped the probe and committed the very tree the first had refused.
 * Caching the verdict instead would fix that but strand a repository in
 * refusal after its `.gitignore` arrives, which the refusal message promises
 * will recover. The probe is one `ls-files` capped at 256 KB, run concurrently
 * across repositories - cheap enough to simply ask again.
 */
const probeUntrackedOverflow = (fanOut: CheckpointFanOut, cwd: string): Effect.Effect<boolean> =>
  fanOut.vcsProcess
    .run({
      operation: "ZeropsCheckpointTargets.probeUntracked",
      command: "git",
      args: ["ls-files", "--others", "--exclude-standard", "-z"],
      cwd,
      allowNonZeroExit: true,
      maxOutputBytes: UNTRACKED_PROBE_MAX_BYTES,
    })
    .pipe(
      Effect.map((result) => result.stdoutTruncated),
      // A probe that cannot run says nothing about the repository; the
      // checkpoint is the thing worth protecting, not the probe.
      Effect.catchCause(() => Effect.succeed(false)),
    );

/**
 * Captures the turn in every repository it covers, concurrently, and returns
 * one merged diff. Never fails: a repository that could not be captured is
 * reported in `skipped` so the caller can say so and let the turn proceed.
 */
export const captureAcrossTargets = (
  fanOut: CheckpointFanOut,
  input: CaptureAcrossTargetsInput,
): Effect.Effect<CaptureAcrossTargetsResult> =>
  Effect.forEach(
    input.targets,
    (target) =>
      Effect.gen(function* () {
        if (yield* probeUntrackedOverflow(fanOut, target.cwd)) {
          return {
            target,
            outcome: "refused" as const,
            reason: UNTRACKED_REFUSAL_REASON,
            baselineMissing: false,
            files: [],
            diffFailure: "",
          };
        }

        const baselineMissing = !(yield* fanOut.store
          .hasCheckpointRef({ cwd: target.cwd, checkpointRef: input.fromCheckpointRef })
          .pipe(Effect.catchCause(() => Effect.succeed(false))));

        const captureFailure = yield* fanOut.store
          .captureCheckpoint({ cwd: target.cwd, checkpointRef: input.toCheckpointRef })
          .pipe(
            Effect.as(undefined),
            Effect.catch((error) => Effect.succeed(error.message)),
          );
        if (captureFailure !== undefined) {
          return {
            target,
            outcome: "failed" as const,
            reason: captureFailure,
            baselineMissing,
            files: [],
            diffFailure: "",
          };
        }

        // A diff we could not read costs a summary, never the checkpoint -
        // but it is reported rather than swallowed, so the turn can say the
        // history is there and the summary is not.
        const diff = yield* fanOut.store
          .diffCheckpoints({
            cwd: target.cwd,
            fromCheckpointRef: input.fromCheckpointRef,
            toCheckpointRef: input.toCheckpointRef,
            fallbackFromToHead: false,
            ignoreWhitespace: false,
            format: "numstat",
          })
          .pipe(
            Effect.map((numstat) => ({
              files: parseTurnDiffFilesFromNumstat(numstat),
              reason: "",
            })),
            Effect.catch((error) => Effect.succeed({ files: [], reason: error.message })),
            Effect.catchCause(() =>
              Effect.succeed({ files: [], reason: "The turn diff could not be computed." }),
            ),
          );

        return {
          target,
          outcome: "captured" as const,
          reason: "",
          baselineMissing,
          files: diff.files,
          diffFailure: diff.reason,
        };
      }),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((results) => ({
      files: mergeCheckpointFiles(
        results.map((result) => ({ prefix: result.target.prefix, files: result.files })),
      ),
      captured: results
        .filter((result) => result.outcome === "captured")
        .map((result) => result.target.cwd),
      skipped: results
        .filter((result) => result.outcome !== "captured")
        .map((result) => ({ cwd: result.target.cwd, reason: result.reason })),
      missingBaseline: results
        .filter((result) => result.outcome === "captured" && result.baselineMissing)
        .map((result) => result.target.cwd),
      diffUnavailable: results
        .filter((result) => result.outcome === "captured" && result.diffFailure.length > 0)
        .map((result) => ({ cwd: result.target.cwd, reason: result.diffFailure })),
    })),
  );

export interface RestoreAcrossTargetsResult {
  readonly restored: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<{ readonly cwd: string; readonly reason: string }>;
}

/**
 * Restores the turn in every repository it covers.
 *
 * Sequential rather than concurrent: a restore rewrites a running
 * application's disk, and a half-applied fan-out is easier to reason about
 * when the repositories are done in a known order.
 */
export const restoreAcrossTargets = (
  store: CheckpointStore.CheckpointStore["Service"],
  input: {
    readonly targets: ReadonlyArray<CheckpointTarget>;
    readonly checkpointRef: CheckpointRef;
    readonly fallbackToHead: boolean;
  },
): Effect.Effect<RestoreAcrossTargetsResult> =>
  Effect.forEach(input.targets, (target) =>
    store
      .restoreCheckpoint({
        cwd: target.cwd,
        checkpointRef: input.checkpointRef,
        fallbackToHead: input.fallbackToHead,
      })
      .pipe(
        Effect.map((restored) =>
          restored
            ? ({ cwd: target.cwd, outcome: "restored" as const, reason: "" } as const)
            : ({
                cwd: target.cwd,
                outcome: "failed" as const,
                reason: "The filesystem checkpoint is unavailable in this repository.",
              } as const),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            cwd: target.cwd,
            outcome: "failed" as const,
            reason: error.message,
          } as const),
        ),
      ),
  ).pipe(
    Effect.map((results) => ({
      restored: results
        .filter((result) => result.outcome === "restored")
        .map((result) => result.cwd),
      failed: results
        .filter((result) => result.outcome === "failed")
        .map((result) => ({ cwd: result.cwd, reason: result.reason })),
    })),
  );

/** Deletes stale refs in every repository the checkpoint covered. */
export const deleteRefsAcrossTargets = (
  store: CheckpointStore.CheckpointStore["Service"],
  input: {
    readonly targets: ReadonlyArray<CheckpointTarget>;
    readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
  },
): Effect.Effect<void> =>
  Effect.forEach(
    input.targets,
    (target) =>
      store
        .deleteCheckpointRefs({ cwd: target.cwd, checkpointRefs: input.checkpointRefs })
        .pipe(Effect.catchCause(() => Effect.void)),
    { concurrency: "unbounded", discard: true },
  );

export interface CaptureBaselineResult {
  /** Repositories where the baseline was written now. */
  readonly captured: ReadonlyArray<string>;
  /** Repositories that already held it - nothing to do, nothing to report. */
  readonly alreadyPresent: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<{ readonly cwd: string; readonly reason: string }>;
}

/**
 * Writes the pre-turn baseline in every repository that lacks it.
 *
 * This is where the untracked-file guard earns its place: the baseline is the
 * *first* checkpoint a repository ever takes, so it is the one that would walk
 * a `node_modules` nobody ignored and cost four minutes of the user's turn.
 */
export const captureBaselineAcrossTargets = (
  fanOut: CheckpointFanOut,
  input: {
    readonly targets: ReadonlyArray<CheckpointTarget>;
    readonly checkpointRef: CheckpointRef;
  },
): Effect.Effect<CaptureBaselineResult> =>
  Effect.forEach(
    input.targets,
    (target) =>
      Effect.gen(function* () {
        const present = yield* fanOut.store
          .hasCheckpointRef({ cwd: target.cwd, checkpointRef: input.checkpointRef })
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        if (present) {
          return { cwd: target.cwd, outcome: "present" as const, reason: "" };
        }
        if (yield* probeUntrackedOverflow(fanOut, target.cwd)) {
          return {
            cwd: target.cwd,
            outcome: "skipped" as const,
            reason: UNTRACKED_REFUSAL_REASON,
          };
        }
        const failure = yield* fanOut.store
          .captureCheckpoint({ cwd: target.cwd, checkpointRef: input.checkpointRef })
          .pipe(
            Effect.as(undefined),
            Effect.catch((error) => Effect.succeed(error.message)),
          );
        return failure === undefined
          ? { cwd: target.cwd, outcome: "captured" as const, reason: "" }
          : { cwd: target.cwd, outcome: "skipped" as const, reason: failure };
      }),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((results) => ({
      captured: results
        .filter((result) => result.outcome === "captured")
        .map((result) => result.cwd),
      alreadyPresent: results
        .filter((result) => result.outcome === "present")
        .map((result) => result.cwd),
      skipped: results
        .filter((result) => result.outcome === "skipped")
        .map((result) => ({ cwd: result.cwd, reason: result.reason })),
    })),
  );

export interface PruneThreadRefsResult {
  /** Repositories the thread's refs were removed from, and how many. */
  readonly pruned: ReadonlyArray<{ readonly cwd: string; readonly refs: number }>;
  /** Repositories that could not be reached or refused - left as they were. */
  readonly failed: ReadonlyArray<{ readonly cwd: string; readonly reason: string }>;
}

/**
 * Deletes everything a thread left behind, in every repository it touched.
 *
 * Checkpoint refs are hidden, so nothing prunes them on its own: they
 * accumulate per turn x repository x thread and outlive the thread, which on
 * Zerops means they outlive it on someone else's disk. The sweep is by prefix
 * rather than by turn number because a deleted thread's turn count is already
 * gone from the projection.
 *
 * Per repository and tolerant by design: a service that has been unmounted or
 * deleted keeps its refs and is reported, because failing the whole prune over
 * one absent host would strand the repositories that are still there.
 */
export const pruneThreadRefsAcrossTargets = (
  fanOut: CheckpointFanOut,
  input: {
    readonly targets: ReadonlyArray<CheckpointTarget>;
    readonly threadId: ThreadId;
  },
): Effect.Effect<PruneThreadRefsResult> =>
  Effect.forEach(
    input.targets,
    (target) =>
      fanOut.vcsProcess
        .run({
          operation: "ZeropsCheckpointTargets.listThreadRefs",
          command: "git",
          args: [
            "for-each-ref",
            "--format=%(refname)",
            checkpointRefsPrefixForThread(input.threadId),
          ],
          cwd: target.cwd,
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.flatMap((result) => {
            const refs = result.stdout
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .map((line) => CheckpointRef.make(line));
            if (refs.length === 0) {
              return Effect.succeed({
                cwd: target.cwd,
                outcome: "pruned" as const,
                refs: 0,
                reason: "",
              });
            }
            return fanOut.store
              .deleteCheckpointRefs({ cwd: target.cwd, checkpointRefs: refs })
              .pipe(
                Effect.as({
                  cwd: target.cwd,
                  outcome: "pruned" as const,
                  refs: refs.length,
                  reason: "",
                }),
              );
          }),
          Effect.catch((error) =>
            Effect.succeed({
              cwd: target.cwd,
              outcome: "failed" as const,
              refs: 0,
              reason: error.message,
            }),
          ),
          Effect.catchCause(() =>
            Effect.succeed({
              cwd: target.cwd,
              outcome: "failed" as const,
              refs: 0,
              reason: "The repository could not be reached.",
            }),
          ),
        ),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((results) => ({
      pruned: results
        .filter((result) => result.outcome === "pruned")
        .map((result) => ({ cwd: result.cwd, refs: result.refs })),
      failed: results
        .filter((result) => result.outcome === "failed")
        .map((result) => ({ cwd: result.cwd, reason: result.reason })),
    })),
  );

/**
 * Which repositories to sweep when a thread is deleted.
 *
 * Deliberately not {@link resolveCheckpointTargets}: by the time the deletion
 * event arrives the thread's cwd may already be gone from the projection, and
 * on Zerops it is not needed anyway - the repository set is absolute, so every
 * mounted repository is swept regardless of where the thread was working.
 * Off Zerops the thread's cwd is the only thing that identifies the
 * repository, so a thread whose cwd has gone leaves its refs rather than
 * having them guessed at.
 */
export const resolvePruneTargets = (
  cwd: string | undefined,
  repositories: ZeropsRepositories,
): ReadonlyArray<CheckpointTarget> => {
  if (repositories._tag === "available" && repositories.repositories.length > 0) {
    return repositories.repositories.map((repository) => ({
      cwd: repository.mountPath,
      prefix: "",
    }));
  }
  return cwd === undefined ? [] : [{ cwd, prefix: "" }];
};
