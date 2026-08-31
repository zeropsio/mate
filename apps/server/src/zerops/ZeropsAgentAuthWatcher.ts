// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
/**
 * `watchWithFallback` — plain Node `fs.watch`, not Effect's wrapped version.
 *
 * Interrupting an Effect-wrapped `fs.watch` stream (`FileSystem.watch` +
 * `Effect.forkScoped`) via scope closure is unreliable on this Effect build
 * (live-verified: a scope close after such a fork throws deep inside the
 * scheduler, `self.addObserver is not a function`, whether or not any event
 * ever fired). So the raw OS watch lives here, as a small synchronous,
 * dispose()-able collaborator {@link ZeropsAgentAuth} injects rather than
 * calls itself — `ZeropsAgentAuth.make` stays Effect-native and testable
 * without touching a real file watcher at all; this module is wired in only
 * at `ZeropsAgentAuth.layer`.
 *
 * Mirrors `vscode-bootstrap-welcome.js`'s `watchWithFallback`
 * (docs/spec-welcome-mode.md §3): watches a DIR (or file) that may not exist
 * yet by falling back to its nearest existing ancestor until the target
 * appears, then swaps to watching it directly. `onChange` may fire more than
 * once per real change (a single write can emit more than one fs event, and
 * the fallback->target swap itself fires once) — debouncing is the caller's
 * job, not this module's.
 *
 * Every handle runs exactly one target-fingerprint poll from construction
 * until `dispose()`. `fs.watch` is the low-latency path; the 1-second poll is
 * the permanent delivery net for silently dropped watcher events as well as
 * missing targets and watcher recovery. There is no separate polling lifetime
 * for fallback or recovery states.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface WatcherHandle {
  /** Stops watching. Idempotent; safe to call more than once. */
  readonly dispose: () => void;
}

export type WatchFactory = (
  path: string,
  listener: NodeFS.WatchListener<string>,
) => NodeFS.FSWatcher;

export interface WatchWithFallbackOptions {
  /** Injectable only where a caller needs to exercise watch-allocation failure. */
  readonly watch?: WatchFactory;
  /** Receives every watcher failure before recovery continues. */
  readonly logWarning?: (message: string, cause: unknown) => void;
}

const FINGERPRINT_POLL_INTERVAL_MS = 1000;
const ERROR_REARM_DELAYS_MS = [50, 100, 200, 400, 800, 1600] as const;

interface TargetSnapshot {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly key: string;
}

const isMissingPathError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");

const statKey = (stat: NodeFS.Stats): string =>
  [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");

/**
 * `generation` guards the fallback->target swap the same way welcome.js's
 * does: fs.watch callbacks are delivered asynchronously and can queue up, so
 * a stale fallback event already in flight when an earlier swap happened
 * must not re-fire it.
 */
export const watchWithFallback = (
  target: string,
  fallbackDir: string,
  onChange: () => void,
  options: WatchWithFallbackOptions = {},
): WatcherHandle => {
  const watch = options.watch ?? ((path, listener) => NodeFS.watch(path, listener));
  const logWarning =
    options.logWarning ??
    ((message: string, cause: unknown) => {
      process.stderr.write(`${message}: ${String(cause)}\n`);
    });
  let watcher: NodeFS.FSWatcher | undefined;
  let watcherPath: string | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let rearmTimer: ReturnType<typeof setTimeout> | undefined;
  let errorRearmAttempts = 0;
  let generation = 0;
  let disposed = false;

  const readTargetSnapshot = (): TargetSnapshot => {
    try {
      const targetStat = NodeFS.statSync(target);
      if (!targetStat.isDirectory()) {
        return { exists: true, isDirectory: false, key: `file:${statKey(targetStat)}` };
      }

      let entries: ReadonlyArray<string>;
      try {
        entries = NodeFS.readdirSync(target).sort();
      } catch (cause) {
        if (!isMissingPathError(cause)) {
          logWarning(
            `zerops agent auth watcher: could not inspect directory target "${target}"; polling will keep trying`,
            cause,
          );
        }
        return {
          exists: !isMissingPathError(cause),
          isDirectory: true,
          key: `directory:${statKey(targetStat)}:unreadable`,
        };
      }

      const children = entries.map((entry) => {
        const child = NodePath.join(target, entry);
        try {
          return `${entry}:${statKey(NodeFS.statSync(child))}`;
        } catch (cause) {
          if (!isMissingPathError(cause)) {
            logWarning(
              `zerops agent auth watcher: could not inspect child "${child}"; polling will keep trying`,
              cause,
            );
          }
          return `${entry}:unavailable`;
        }
      });
      return {
        exists: true,
        isDirectory: true,
        key: `directory:${statKey(targetStat)}:${children.join("|")}`,
      };
    } catch (cause) {
      if (!isMissingPathError(cause)) {
        logWarning(
          `zerops agent auth watcher: could not inspect target "${target}"; polling will keep trying`,
          cause,
        );
        return { exists: false, isDirectory: false, key: "unavailable" };
      }
      return { exists: false, isDirectory: false, key: "missing" };
    }
  };

  let observedSnapshot = readTargetSnapshot();

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const cancelRearm = () => {
    if (rearmTimer !== undefined) {
      clearTimeout(rearmTimer);
      rearmTimer = undefined;
    }
  };

  const closeCurrent = () => {
    const current = watcher;
    const currentPath = watcherPath;
    watcher = undefined;
    watcherPath = undefined;
    if (current === undefined) {
      return;
    }
    try {
      current.close();
    } catch (cause) {
      logWarning(
        `zerops agent auth watcher: could not close filesystem watch for "${currentPath ?? target}"; stale callbacks will be ignored`,
        cause,
      );
    }
  };

  const noteWatcherEvent = () => {
    observedSnapshot = readTargetSnapshot();
    errorRearmAttempts = 0;
    cancelRearm();
    onChange();
  };

  const startPolling = () => {
    if (disposed || pollTimer !== undefined) {
      return;
    }
    pollTimer = setInterval(() => {
      if (disposed) {
        return;
      }
      const nextSnapshot = readTargetSnapshot();
      if (nextSnapshot.key === observedSnapshot.key) {
        return;
      }
      observedSnapshot = nextSnapshot;
      errorRearmAttempts = 0;
      cancelRearm();
      generation += 1;
      closeCurrent();
      attachBestAvailable(true);
      onChange();
    }, FINGERPRINT_POLL_INTERVAL_MS);
  };

  const scheduleRearmAfterError = (failedPath: string, cause: unknown) => {
    if (errorRearmAttempts >= ERROR_REARM_DELAYS_MS.length) {
      logWarning(
        `zerops agent auth watcher: filesystem watch for "${failedPath}" stopped after ${ERROR_REARM_DELAYS_MS.length} re-arm attempts; permanent fingerprint polling remains active for "${target}"`,
        cause,
      );
      return;
    }
    const delayMs = ERROR_REARM_DELAYS_MS[errorRearmAttempts]!;
    errorRearmAttempts += 1;
    logWarning(
      `zerops agent auth watcher: filesystem watch for "${failedPath}" stopped; re-arm ${errorRearmAttempts}/${ERROR_REARM_DELAYS_MS.length} in ${delayMs}ms while permanent fingerprint polling remains active for "${target}"`,
      cause,
    );
    cancelRearm();
    rearmTimer = setTimeout(() => {
      rearmTimer = undefined;
      if (disposed) {
        return;
      }
      generation += 1;
      closeCurrent();
      attachBestAvailable(true);
    }, delayMs);
  };

  const installWatcher = (
    path: string,
    myGeneration: number,
    listener: NodeFS.WatchListener<string>,
  ): boolean => {
    let nextWatcher: NodeFS.FSWatcher | undefined;
    try {
      nextWatcher = watch(path, listener);
      nextWatcher.on("error", (cause) => {
        if (disposed || myGeneration !== generation) {
          return;
        }
        generation += 1;
        closeCurrent();
        scheduleRearmAfterError(path, cause);
      });
      watcher = nextWatcher;
      watcherPath = path;
      return true;
    } catch (cause) {
      if (nextWatcher !== undefined) {
        try {
          nextWatcher.close();
        } catch (closeCause) {
          logWarning(
            `zerops agent auth watcher: could not close the failed filesystem watch for "${path}"`,
            closeCause,
          );
        }
      }
      logWarning(
        `zerops agent auth watcher: could not arm filesystem watch for "${path}"; permanent fingerprint polling remains active for "${target}"`,
        cause,
      );
      return false;
    }
  };

  const attachFallback = (recovering: boolean): boolean => {
    const myGeneration = ++generation;
    const armed = installWatcher(fallbackDir, myGeneration, () => {
      if (disposed || myGeneration !== generation) {
        return;
      }
      const nextSnapshot = readTargetSnapshot();
      if (!nextSnapshot.exists) {
        return;
      }
      observedSnapshot = nextSnapshot;
      errorRearmAttempts = 0;
      cancelRearm();
      generation += 1;
      closeCurrent();
      attachTarget(false, nextSnapshot.isDirectory);
      onChange();
    });
    if (armed) {
      if (!recovering) {
        errorRearmAttempts = 0;
      }
    }
    return armed;
  };

  const attachTarget = (recovering: boolean, isDirectory: boolean): boolean => {
    const myGeneration = ++generation;
    // A directory target is watched directly (reliable everywhere, and the
    // only way to see a file appear inside it). A FILE target is watched via
    // its parent directory, filtered to its own name: watching a lone file
    // directly is a documented Node caveat.
    const armed = isDirectory
      ? installWatcher(target, myGeneration, () => {
          if (disposed || myGeneration !== generation) {
            return;
          }
          noteWatcherEvent();
        })
      : installWatcher(NodePath.dirname(target), myGeneration, (_event, filename) => {
          if (disposed || myGeneration !== generation) {
            return;
          }
          if (filename === null || filename === NodePath.basename(target)) {
            noteWatcherEvent();
          }
        });
    if (armed && !recovering) {
      errorRearmAttempts = 0;
    }
    return armed;
  };

  function attachBestAvailable(recovering: boolean): boolean {
    const currentSnapshot = readTargetSnapshot();
    if (!recovering) {
      observedSnapshot = currentSnapshot;
    }
    return currentSnapshot.exists
      ? attachTarget(recovering, currentSnapshot.isDirectory)
      : attachFallback(recovering);
  }

  attachBestAvailable(false);
  startPolling();

  return {
    dispose: () => {
      disposed = true;
      generation += 1;
      cancelRearm();
      stopPolling();
      closeCurrent();
    },
  };
};
