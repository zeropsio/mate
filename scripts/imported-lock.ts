#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as String from "effect/String";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

// The zone map (methodology §3): these are the standalone wire-protocol
// packages the fork imports byte-identically from upstream. Neither imports
// owned code (`@t3tools/*` or `apps/`) — verified 2026-08-28.
export const IMPORTED_LOCK_PATHS = [
  "packages/effect-codex-app-server",
  "packages/effect-acp",
] as const;

export const IMPORTED_LOCK_FILE_NAME = "imported.lock";

const ImportedLockSchema = Schema.Struct({
  upstream: Schema.String,
  paths: Schema.Record(Schema.String, Schema.String),
});
export type ImportedLock = typeof ImportedLockSchema.Type;

const ImportedLockJson = fromJsonStringPretty(ImportedLockSchema);
const decodeImportedLock = Schema.decodeEffect(ImportedLockJson);
const encodeImportedLock = Schema.encodeEffect(ImportedLockJson);

export class ImportedLockFileError extends Schema.TaggedError<ImportedLockFileError>()(
  "ImportedLockFileError",
  {
    operation: Schema.Literals(["read", "decode", "encode", "write"]),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} imported lock '${this.filePath}'.`;
  }
}

const gitRevisionContext = {
  cwd: Schema.String,
  revision: Schema.String,
};

export class GitRevisionResolutionError extends Schema.TaggedError<GitRevisionResolutionError>()(
  "GitRevisionResolutionError",
  {
    ...gitRevisionContext,
    operation: Schema.Literals(["spawn", "read-stdout", "read-stderr", "wait-for-exit"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to resolve git revision "${this.revision}" during "${this.operation}".`;
  }
}

export class GitRevisionExitError extends Schema.TaggedError<GitRevisionExitError>()(
  "GitRevisionExitError",
  {
    ...gitRevisionContext,
    exitCode: Schema.Number,
    stderrLength: Schema.Int,
  },
) {
  override get message(): string {
    return `git rev-parse "${this.revision}" exited with code ${this.exitCode}.`;
  }
}

export class ImportedLockDriftError extends Schema.TaggedError<ImportedLockDriftError>()(
  "ImportedLockDriftError",
  {
    lockFilePath: Schema.String,
    mismatchCount: Schema.Int,
  },
) {
  override get message(): string {
    return `${this.mismatchCount} imported path(s) drifted from ${this.lockFilePath}.`;
  }
}

export class ImportedLockNotByteIdenticalError extends Schema.TaggedError<ImportedLockNotByteIdenticalError>()(
  "ImportedLockNotByteIdenticalError",
  {
    upstreamRef: Schema.String,
    mismatches: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        expected: Schema.String,
        actual: Schema.String,
      }),
    ),
  },
) {
  override get message(): string {
    return `HEAD diverges from "${this.upstreamRef}" for ${this.mismatches.length} imported path(s); an import must be byte-identical.`;
  }
}

export class ImportedLockMissingUpstreamError extends Schema.TaggedError<ImportedLockMissingUpstreamError>()(
  "ImportedLockMissingUpstreamError",
  {},
) {
  override get message(): string {
    return "--write requires --upstream <ref>.";
  }
}

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

/** Resolves one git revision (e.g. `HEAD`, `<ref>`, or `<ref>:<path>`) to the object ID git prints for it. */
export const resolveGitRevision = Effect.fn("resolveGitRevision")(function* (
  cwd: string,
  revision: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const context = { cwd, revision } as const;
  const child = yield* spawner
    .spawn(ChildProcess.make("git", ["rev-parse", "--verify", revision], { cwd }))
    .pipe(
      Effect.mapError(
        (cause) => new GitRevisionResolutionError({ ...context, operation: "spawn", cause }),
      ),
    );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout).pipe(
        Effect.mapError(
          (cause) =>
            new GitRevisionResolutionError({ ...context, operation: "read-stdout", cause }),
        ),
      ),
      collectStreamAsString(child.stderr).pipe(
        Effect.mapError(
          (cause) =>
            new GitRevisionResolutionError({ ...context, operation: "read-stderr", cause }),
        ),
      ),
      child.exitCode.pipe(
        Effect.map(Number),
        Effect.mapError(
          (cause) =>
            new GitRevisionResolutionError({ ...context, operation: "wait-for-exit", cause }),
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );

  if (exitCode !== 0) {
    return yield* new GitRevisionExitError({ ...context, exitCode, stderrLength: stderr.length });
  }

  return String.trim(stdout);
}, Effect.scoped);

/** Resolves `<ref>:<path>` for every path, returning a map of path to tree OID. */
export const resolveTreeOids = Effect.fn("resolveTreeOids")(function* (
  cwd: string,
  ref: string,
  paths: ReadonlyArray<string>,
) {
  const oids: Record<string, string> = {};
  for (const path of paths) {
    oids[path] = yield* resolveGitRevision(cwd, `${ref}:${path}`);
  }
  return oids;
});

export interface OidMismatch {
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
}

/**
 * Pure comparison: every key present in `expected` whose value in `actual`
 * differs (or is absent). Both maps are assumed to already be fully resolved
 * for the same key set — a path that could not be resolved at all fails
 * earlier, in `resolveTreeOids`, rather than showing up here as a mismatch.
 */
export const diffOidMaps = (
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): ReadonlyArray<OidMismatch> =>
  Object.keys(expected)
    .filter((path) => actual[path] !== expected[path])
    .map((path) => ({ path, expected: expected[path]!, actual: actual[path]! }));

export const formatOidMismatchLine = (mismatch: OidMismatch): string =>
  `${mismatch.path}: expected ${mismatch.expected}, got ${mismatch.actual}`;

export const readImportedLock = Effect.fn("readImportedLock")(function* (lockFilePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs
    .readFileString(lockFilePath)
    .pipe(
      Effect.mapError(
        (cause) => new ImportedLockFileError({ operation: "read", filePath: lockFilePath, cause }),
      ),
    );
  return yield* decodeImportedLock(text).pipe(
    Effect.mapError(
      (cause) => new ImportedLockFileError({ operation: "decode", filePath: lockFilePath, cause }),
    ),
  );
});

export const writeImportedLockFile = Effect.fn("writeImportedLockFile")(function* (
  lockFilePath: string,
  lock: ImportedLock,
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* encodeImportedLock(lock).pipe(
    Effect.mapError(
      (cause) => new ImportedLockFileError({ operation: "encode", filePath: lockFilePath, cause }),
    ),
  );
  yield* fs
    .writeFileString(lockFilePath, `${text}\n`)
    .pipe(
      Effect.mapError(
        (cause) => new ImportedLockFileError({ operation: "write", filePath: lockFilePath, cause }),
      ),
    );
});

/** `--check`: recomputes each locked path's tree OID at HEAD and diffs it against the lock. */
export const checkImportedLock = Effect.fn("checkImportedLock")(function* (
  cwd: string,
  lockFilePath: string,
) {
  const lock = yield* readImportedLock(lockFilePath);
  const actual = yield* resolveTreeOids(cwd, "HEAD", Object.keys(lock.paths));
  return diffOidMaps(lock.paths, actual);
});

/**
 * `--write --upstream <ref>`: regenerates the lock from `<ref>:<path>` for
 * each path, and verifies HEAD's tree equals the ref's tree for every one —
 * an import must be byte-identical, so a write that would record a diverged
 * path fails instead of silently locking in the drift.
 */
export const writeImportedLock = Effect.fn("writeImportedLock")(function* (
  cwd: string,
  upstreamRef: string,
  paths: ReadonlyArray<string> = IMPORTED_LOCK_PATHS,
) {
  // `^{commit}` peels an annotated tag's ref (which points at the tag OBJECT,
  // not the commit) to the commit it names — a no-op when upstreamRef is
  // already a commit or a lightweight tag. `imported.lock`'s `upstream` field
  // must be the commit so a later `git diff <upstream>..upstream/main` works.
  const upstreamSha = yield* resolveGitRevision(cwd, `${upstreamRef}^{commit}`);
  const upstreamOids = yield* resolveTreeOids(cwd, upstreamRef, paths);
  const headOids = yield* resolveTreeOids(cwd, "HEAD", paths);
  const mismatches = diffOidMaps(upstreamOids, headOids);

  if (mismatches.length > 0) {
    return yield* new ImportedLockNotByteIdenticalError({ upstreamRef, mismatches });
  }

  return { upstream: upstreamSha, paths: upstreamOids } satisfies ImportedLock;
});

export const importedLockCommand = Command.make(
  "imported-lock",
  {
    write: Flag.Boolean("write").pipe(
      Flag.withDescription("Regenerate imported.lock from --upstream instead of checking it."),
      Flag.withDefault(false),
    ),
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("Check imported.lock against HEAD. The default when --write is absent."),
      Flag.withDefault(false),
    ),
    upstream: Flag.String("upstream").pipe(
      Flag.withDescription(
        "Upstream ref or SHA to regenerate the lock from (required with --write).",
      ),
      Flag.optional,
    ),
    root: Flag.String("root").pipe(
      Flag.withDescription(
        "Workspace root containing imported.lock. Defaults to the current directory.",
      ),
      Flag.optional,
    ),
  },
  ({ write, upstream, root }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const cwd = path.resolve(Option.getOrUndefined(root) ?? process.cwd());
      const lockFilePath = path.join(cwd, IMPORTED_LOCK_FILE_NAME);

      if (write) {
        const upstreamRef = Option.getOrUndefined(upstream);
        if (upstreamRef === undefined) {
          return yield* new ImportedLockMissingUpstreamError();
        }
        const lock = yield* writeImportedLock(cwd, upstreamRef);
        yield* writeImportedLockFile(lockFilePath, lock);
        yield* Console.log(`Wrote ${lockFilePath} from ${upstreamRef} (${lock.upstream}).`);
        return;
      }

      const mismatches = yield* checkImportedLock(cwd, lockFilePath);
      if (mismatches.length === 0) {
        yield* Console.log(`${IMPORTED_LOCK_FILE_NAME} matches HEAD.`);
        return;
      }
      for (const mismatch of mismatches) {
        yield* Console.log(formatOidMismatchLine(mismatch));
      }
      return yield* new ImportedLockDriftError({
        lockFilePath,
        mismatchCount: mismatches.length,
      });
    }),
).pipe(
  Command.withDescription(
    "Check or regenerate imported.lock, the pin for the fork's byte-identical import zone.",
  ),
);

if (import.meta.main) {
  Command.run(importedLockCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
