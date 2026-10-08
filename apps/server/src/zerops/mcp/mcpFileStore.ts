/**
 * The agents' config files as the MCP tab reads and writes them.
 *
 * A write lands whole (a temporary file beside it, then a rename), through a
 * symlink to the file it points at, keeping the file's permissions — a new one
 * is private to its owner, since it can hold keys. It lands only over the text
 * it was planned from: a file an agent changed meanwhile is a
 * {@link McpFileConflict}, and the change is planned again. Claude Code's
 * `.claude.json` is written under the lock Claude Code itself takes on it
 * (proper-lockfile's `<file>.lock` directory), so neither side loses the
 * other's write.
 *
 * @module mcpFileStore
 */

import { McpServersError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/** The file no longer holds the text the change was planned from. */
export class McpFileConflict extends Schema.TaggedError<McpFileConflict>()("McpFileConflict", {
  path: Schema.String,
}) {}

export interface McpFileStore {
  readonly read: (path: string) => Effect.Effect<string | undefined, McpServersError>;
  /** Replaces the file when it still holds `base` (`undefined`: still missing). */
  readonly write: (
    path: string,
    text: string,
    base: string | undefined,
  ) => Effect.Effect<void, McpServersError | McpFileConflict>;
  /** Runs `effect` holding Claude Code's lock on each of `paths` that is a `.claude.json`. */
  readonly locked: <A, E>(
    paths: ReadonlyArray<string>,
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | McpServersError>;
}

/** proper-lockfile's defaults, which Claude Code keeps: a lock untouched this long is stale. */
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

const writeError = (file: string, cause: unknown) =>
  new McpServersError({
    operation: "mcp.servers.write",
    detail: `${file} could not be saved.`,
    cause,
  });

export const nodeFileStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const read = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.map((text): string | undefined => text),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
      Effect.mapError(
        (cause) =>
          new McpServersError({
            operation: "mcp.servers.read",
            detail: `${file} could not be read.`,
            cause,
          }),
      ),
    );

  const write = (file: string, text: string, base: string | undefined) =>
    Effect.gen(function* () {
      if ((yield* read(file)) !== base) return yield* new McpFileConflict({ path: file });
      const target = yield* fs.realPath(file).pipe(Effect.catch(() => Effect.succeed(file)));
      const mode = yield* fs.stat(target).pipe(
        Effect.map((info) => info.mode & 0o777),
        Effect.catch(() => Effect.succeed(0o600)),
      );
      yield* fs
        .makeDirectory(path.dirname(target), { recursive: true })
        .pipe(Effect.mapError((cause) => writeError(file, cause)));
      const suffix = Hex.encode(yield* crypto.randomBytes(4).pipe(Effect.orDie));
      const temporary = `${target}.mate-${suffix}.tmp`;
      yield* fs.writeFileString(temporary, text, { mode }).pipe(
        Effect.andThen(fs.rename(temporary, target)),
        Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)),
        Effect.mapError((cause) => writeError(file, cause)),
      );
    });

  const lockOne = (file: string) => {
    const lock = `${file}.lock`;
    const acquire = Effect.gen(function* () {
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      const started = yield* Clock.currentTimeMillis;
      for (let attempt = 0; ; attempt += 1) {
        const taken = yield* fs.makeDirectory(lock).pipe(
          Effect.as(true),
          Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
        );
        if (taken) return;
        const now = yield* Clock.currentTimeMillis;
        const touched = yield* fs.stat(lock).pipe(
          Effect.map((info) => Option.getOrUndefined(info.mtime)?.getTime() ?? now),
          Effect.catch(() => Effect.succeed(now)),
        );
        if (now - touched > LOCK_STALE_MS) {
          yield* fs.remove(lock, { recursive: true }).pipe(Effect.ignore);
          continue;
        }
        if (now - started > LOCK_WAIT_MS) {
          return yield* new McpServersError({
            operation: "mcp.servers.write",
            detail: "Claude Code is busy writing its settings. Try again in a moment.",
          });
        }
        yield* Effect.sleep(Math.min(50 * 2 ** attempt, 500));
      }
    }).pipe(Effect.catchTags({ PlatformError: (cause) => Effect.fail(writeError(file, cause)) }));
    return { acquire, release: fs.remove(lock, { recursive: true }).pipe(Effect.ignore) };
  };

  const locked = <A, E>(paths: ReadonlyArray<string>, effect: Effect.Effect<A, E>) => {
    const locks = [...new Set(paths.filter((file) => path.basename(file) === ".claude.json"))]
      .toSorted()
      .map(lockOne);
    return locks.reduceRight<Effect.Effect<A, E | McpServersError>>(
      (inner, lock) =>
        Effect.acquireUseRelease(
          lock.acquire,
          () => inner,
          () => lock.release,
        ),
      effect,
    );
  };

  return { read, write, locked } satisfies McpFileStore;
});
