// @effect-diagnostics nodeBuiltinImport:off
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
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface WatcherHandle {
  /** Stops watching. Idempotent; safe to call more than once. */
  readonly dispose: () => void;
}

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
): WatcherHandle => {
  let watcher: NodeFS.FSWatcher | undefined;
  let generation = 0;
  let disposed = false;

  const closeCurrent = () => {
    try {
      watcher?.close();
    } catch {
      // already closed — nothing to do.
    }
    watcher = undefined;
  };

  const attachFallback = () => {
    const myGeneration = ++generation;
    try {
      watcher = NodeFS.watch(fallbackDir, () => {
        if (disposed || myGeneration !== generation) {
          return;
        }
        let exists = false;
        try {
          exists = NodeFS.existsSync(target);
        } catch {
          exists = false;
        }
        if (!exists) {
          return;
        }
        closeCurrent();
        attachTarget();
        onChange();
      });
    } catch {
      // fallbackDir itself missing or unwatchable: give up quietly, exactly
      // like welcome.js's own "fs.watch(zembed) unavailable" fallback.
      watcher = undefined;
    }
  };

  const attachTarget = () => {
    const myGeneration = ++generation;
    try {
      // A directory target is watched directly (reliable everywhere, and the
      // only way to see a file appear inside it). A FILE target is watched
      // via its parent directory, filtered to its own name: watching a lone
      // file directly is a documented Node caveat (unreliable "change"
      // delivery on some platforms/filesystems, live-observed here) — the
      // directory-plus-filter form is the standard, more reliable fix.
      let isDirectory = false;
      try {
        isDirectory = NodeFS.statSync(target).isDirectory();
      } catch {
        isDirectory = false;
      }
      if (isDirectory) {
        watcher = NodeFS.watch(target, () => {
          if (disposed || myGeneration !== generation) {
            return;
          }
          onChange();
        });
      } else {
        const dir = NodePath.dirname(target);
        const base = NodePath.basename(target);
        watcher = NodeFS.watch(dir, (_event, filename) => {
          if (disposed || myGeneration !== generation) {
            return;
          }
          if (filename === null || filename === base) {
            onChange();
          }
        });
      }
    } catch {
      // Raced: target disappeared again, or another transient failure.
      // Fall back to watching for its (re)appearance.
      attachFallback();
    }
  };

  let targetExists = false;
  try {
    targetExists = NodeFS.existsSync(target);
  } catch {
    targetExists = false;
  }
  if (targetExists) {
    attachTarget();
  } else {
    attachFallback();
  }

  return {
    dispose: () => {
      disposed = true;
      generation += 1;
      closeCurrent();
    },
  };
};
