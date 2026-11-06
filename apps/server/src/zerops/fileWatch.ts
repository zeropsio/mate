// @effect-diagnostics nodeBuiltinImport:off
/**
 * Files another process writes, read at their change: a wait on such a file
 * arms a watch, reads, and reads again only when the watch says the file
 * changed — never on a timer. Arming comes first, so a write landing between
 * the read and the wait still wakes it.
 *
 * Plain Node `fs.watch` on each file's directory, filtered by the file's name:
 * a writer that renames its file into place (zcp, Claude) changes the
 * directory entry, never the file once watched. While the directory is
 * missing, its nearest existing ancestor is watched instead, and the watch
 * moves down as the directories appear.
 *
 * Linux (inotify) watches from the moment `fs.watch` returns. macOS, where
 * only development runs, starts a directory's watch a moment later: a write
 * in that moment goes unseen until the file's next change.
 *
 * @module fileWatch
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";

export interface FileWatch {
  /** Resumes at the first change since the watch was armed or `next` last resumed; changes in between are one. */
  readonly next: Effect.Effect<void>;
}

/** Arms a watch that lasts as long as its scope. */
export type WatchFiles = Effect.Effect<FileWatch, never, Scope.Scope>;

/** Node's `fs.watch` on a directory; a test hands in its own to fire the events itself. */
export type WatchDirectory = (
  dir: string,
  listener: (event: string, name: string | null) => void,
) => NodeFS.FSWatcher;

const nodeWatch: WatchDirectory = (dir, listener) => NodeFS.watch(dir, listener);

/** One directory's watch, for the names of the files in it; answers its close. */
const watchDirectory = (
  watch: WatchDirectory,
  dir: string,
  names: ReadonlySet<string>,
  changed: () => void,
  warn: (cause: unknown) => void,
) => {
  let watcher: NodeFS.FSWatcher | undefined;
  let closed = false;
  const arm = (): void => {
    watcher?.close();
    watcher = undefined;
    if (closed) return;
    let watched = dir;
    let towards = names;
    while (!NodeFS.existsSync(watched) && NodePath.dirname(watched) !== watched) {
      towards = new Set([NodePath.basename(watched)]);
      watched = NodePath.dirname(watched);
    }
    const moved = (): void => {
      arm();
      changed();
    };
    try {
      watcher = watch(watched, (_event, name) => {
        // One on the way to the directory appeared, or the directory itself went: the watch moves.
        if (watched !== dir ? name === null || towards.has(name) : !NodeFS.existsSync(dir)) {
          moved();
        } else if (name === null || names.has(name)) {
          changed();
        }
      }).on("error", (cause) => {
        warn(cause);
        moved();
      });
    } catch (cause) {
      warn(cause);
      return;
    }
    // One on the way that appeared before its parent's watch was armed sent it nothing.
    const appeared = [...towards].some((name) => NodeFS.existsSync(NodePath.join(watched, name)));
    if (watched !== dir && appeared) moved();
  };
  arm();
  return () => {
    closed = true;
    watcher?.close();
  };
};

/** The live watch on `files`. */
export const watchFiles = (
  files: ReadonlyArray<string>,
  watch: WatchDirectory = nodeWatch,
): WatchFiles =>
  Effect.gen(function* () {
    const changes = yield* Queue.sliding<void>(1);
    const changed = () => {
      Queue.offerUnsafe(changes, undefined);
    };
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    const warn = (cause: unknown) => {
      runFork(Effect.logWarning("file watch failed", { files, cause: String(cause) }));
    };
    const byDirectory = new Map<string, Set<string>>();
    for (const file of files) {
      const dir = NodePath.dirname(file);
      byDirectory.set(dir, (byDirectory.get(dir) ?? new Set()).add(NodePath.basename(file)));
    }
    for (const [dir, names] of byDirectory) {
      yield* Effect.acquireRelease(
        Effect.sync(() => watchDirectory(watch, dir, names, changed, warn)),
        (close) => Effect.sync(close),
      );
    }
    return { next: Queue.take(changes) };
  });
