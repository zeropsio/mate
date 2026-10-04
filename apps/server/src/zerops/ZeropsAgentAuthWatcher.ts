// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
/**
 * Plain Node fs.watch avoids the Effect watcher teardown defect. Handles are
 * synchronously disposable, so the Effect consumers only need a finalizer.
 *
 * Watch a directory directly, a file through its parent (atomic replacements
 * keep working), or the nearest available ancestor until the target appears.
 * Filesystem events may advance that watch once to a newly available path.
 * Failures end degraded; only Watch again can allocate another watch. Check
 * now emits one observation without restarting a failed watch. No timers or
 * fingerprint polling compensate for lost OS events: lastObservedAt states
 * when the target was actually observed, never a promise of freshness.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface WatcherHandle {
  /** Stops watching. Idempotent; safe to call more than once. */
  readonly dispose: () => void;
}

export interface CredentialWatchState {
  readonly status: "watching" | "degraded" | "disposed";
  readonly path?: string | undefined;
  readonly reason?: string | undefined;
  /** Time of the last successful target observation, including absence. */
  readonly lastObservedAt?: number | undefined;
}

export interface CredentialWatcherHandle extends WatcherHandle {
  readonly getState: () => CredentialWatchState;
  /** One new watch attempt and, if successful, one credential notification. */
  readonly watchAgain: () => void;
  /** One target observation and credential notification; does not rearm. */
  readonly checkNow: () => void;
}

export type WatchFactory = (
  path: string,
  listener: NodeFS.WatchListener<string>,
) => NodeFS.FSWatcher;

export interface WatchWithFallbackOptions {
  readonly watch?: WatchFactory;
  /** Receives a terminal failure with its manual recovery actions. */
  readonly logWarning?: (message: string, cause: unknown) => void;
  /** Initial state and every subsequent observation or watch outcome. */
  readonly onStateChange?: (state: CredentialWatchState) => void;
}

const isMissingPathError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");

/** Stale callbacks from a retired watch cannot advance or restart its owner. */
export const watchWithFallback = (
  target: string,
  fallbackDir: string,
  onChange: () => void,
  options: WatchWithFallbackOptions = {},
): CredentialWatcherHandle => {
  const watch = options.watch ?? ((path, listener) => NodeFS.watch(path, listener));
  const logWarning =
    options.logWarning ??
    ((message: string, cause: unknown) => {
      process.stderr.write(`${message}: ${String(cause)}\n`);
    });
  let watcher: NodeFS.FSWatcher | undefined;
  let generation = 0;
  let targetExists = false;
  let state: CredentialWatchState = { status: "watching" };

  const publish = (next: CredentialWatchState) => {
    state = next;
    options.onStateChange?.(state);
  };

  const closeCurrent = () => {
    generation += 1;
    const current = watcher;
    watcher = undefined;
    try {
      current?.close();
    } catch (cause) {
      logWarning(
        `zerops agent auth watcher: could not close filesystem watch for "${state.path ?? target}"; stale callbacks will be ignored`,
        cause,
      );
    }
  };

  const fail = (cause: unknown, path = state.path ?? target) => {
    closeCurrent();
    publish({
      ...state,
      status: "degraded",
      path,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
    logWarning(
      `zerops agent auth watcher: observation stopped for "${target}"; Watch again to restart watching or Check now for one credential observation`,
      cause,
    );
  };

  const readTarget = () => {
    let stat: NodeFS.Stats | undefined;
    try {
      stat = NodeFS.statSync(target);
    } catch (cause) {
      if (!isMissingPathError(cause)) throw cause;
    }
    targetExists = stat !== undefined;
    state = { ...state, lastObservedAt: Date.now() };
    return stat;
  };

  const availablePath = (stat: NodeFS.Stats | undefined): string => {
    if (stat?.isDirectory()) return target;
    let ancestor = NodePath.dirname(target);
    while (true) {
      try {
        if (NodeFS.statSync(ancestor).isDirectory()) return ancestor;
      } catch (cause) {
        if (!isMissingPathError(cause)) throw cause;
      }
      const parent = NodePath.dirname(ancestor);
      if (ancestor === fallbackDir || parent === ancestor) {
        throw new Error(`watch directory is unavailable: ${ancestor}`);
      }
      ancestor = parent;
    }
  };

  const attach = (path: string) => {
    const myGeneration = ++generation;
    let nextWatcher: NodeFS.FSWatcher | undefined;
    try {
      const relativeTarget = NodePath.relative(path, target).split(NodePath.sep)[0];
      nextWatcher = watch(path, (_event, filename) => {
        if (state.status !== "watching" || myGeneration !== generation) return;
        if (path !== target && filename !== null && filename !== relativeTarget) return;
        const previouslyExisted = targetExists;
        try {
          const nextPath = availablePath(readTarget());
          if (nextPath !== path) {
            closeCurrent();
            attach(nextPath);
          } else {
            publish({ ...state });
          }
        } catch (cause) {
          fail(cause);
          return;
        }
        // Creating an intermediate ancestor advances the watch, but is not
        // itself a credential change. Removal and replacement are changes.
        if (previouslyExisted || targetExists) onChange();
      });
      watcher = nextWatcher;
      nextWatcher.on("error", (cause) => {
        if (state.status === "disposed" || myGeneration !== generation) return;
        fail(cause, path);
      });
      nextWatcher.on("close", () => {
        if (state.status === "disposed" || myGeneration !== generation) return;
        fail(new Error("filesystem watch closed unexpectedly"), path);
      });
      publish({ ...state, status: "watching", path, reason: undefined });
    } catch (cause) {
      // A partially installed handle is retired by the same failure path.
      watcher = nextWatcher;
      fail(cause, path);
    }
  };

  const start = () => {
    try {
      attach(availablePath(readTarget()));
    } catch (cause) {
      fail(cause);
    }
  };

  start();

  return {
    getState: () => state,
    watchAgain: () => {
      if (state.status === "disposed") return;
      closeCurrent();
      start();
      if (state.status === "watching") onChange();
    },
    checkNow: () => {
      if (state.status === "disposed") return;
      try {
        readTarget();
      } catch (cause) {
        fail(cause);
        return;
      }
      publish({ ...state });
      onChange();
    },
    dispose: () => {
      if (state.status === "disposed") return;
      closeCurrent();
      publish({ ...state, status: "disposed" });
    },
  };
};
