/**
 * One watch per transcript directory. A directory that does not exist yet (a fresh Mate's first
 * run creates `~/.claude/projects` or `~/.codex/sessions`) is waited for from its nearest existing
 * ancestor; a watch that errors is closed and attached again after a growing delay.
 */
// @effect-diagnostics nodeBuiltinImport:off -- the nearest existing ancestor of a missing directory.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type { WatchDirectory } from "./usageCapture.ts";

export interface WatchRetry {
  readonly baseMs: number;
  readonly maxMs: number;
}
export const DEFAULT_WATCH_RETRY: WatchRetry = { baseMs: 1_000, maxMs: 60_000 };
/** How long a newly attached recursive watch may take to see everything beneath it. */
const SETTLE_MS = 1_000;

export interface SourceWatches {
  /** Attach the directory's watch, or wait for it from its nearest existing ancestor. */
  readonly ensure: (directory: string) => Effect.Effect<void>;
}

interface Entry {
  /** The directory itself once it exists, else the ancestor it is awaited from. */
  readonly watched: string;
  close: () => void;
}

/** Why a watch could not attach: the directory is not there yet, or anything else. */
const attachFailure = (cause: unknown): "missing" | "failed" => {
  const code = (cause as { readonly code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "failed";
};

export const makeSourceWatches = Effect.fnUntraced(function* (options: {
  readonly watch: WatchDirectory;
  /** Ask for a scan: a source changed or a watch changed hands. */
  readonly nudge: () => void;
  readonly retry: WatchRetry;
}) {
  const scope = yield* Effect.scope;
  const entries = new Map<string, Entry>();
  const failures = new Map<string, number>();
  const retryAt = new Map<string, number>();
  const failed = yield* Queue.unbounded<{ readonly directory: string; readonly entry: Entry }>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const entry of entries.values()) entry.close();
      entries.clear();
    }),
  );

  const backOff = (directory: string) =>
    Effect.gen(function* () {
      const count = (failures.get(directory) ?? 0) + 1;
      failures.set(directory, count);
      const delay = Math.min(options.retry.baseMs * 2 ** (count - 1), options.retry.maxMs);
      retryAt.set(directory, (yield* Clock.currentTimeMillis) + delay);
      yield* Effect.sleep(delay).pipe(
        Effect.andThen(Effect.sync(options.nudge)),
        Effect.forkIn(scope),
      );
      yield* Effect.logWarning("Usage transcript watch failed; retrying", { directory, delay });
    });

  yield* Effect.forkScoped(
    Effect.forever(
      Queue.take(failed).pipe(
        Effect.flatMap(({ directory, entry }) =>
          entries.get(directory) === entry
            ? Effect.sync(() => {
                entry.close();
                entries.delete(directory);
              }).pipe(Effect.andThen(backOff(directory)))
            : Effect.void,
        ),
      ),
    ),
  );

  const attach = (
    directory: string,
    watched: string,
    recursive: boolean,
    relevant: (name: string | null) => boolean,
  ) =>
    Effect.try({
      try: () => {
        const entry: Entry = { watched, close: () => {} };
        entry.close = options.watch(watched, {
          recursive,
          changed: (name) => {
            if (!relevant(name)) return;
            failures.delete(directory);
            options.nudge();
          },
          failed: () => Queue.offerUnsafe(failed, { directory, entry }),
        });
        return entry;
      },
      catch: attachFailure,
    });

  const install = (directory: string, entry: Entry) =>
    Effect.gen(function* () {
      entries.get(directory)?.close();
      entries.set(directory, entry);
      // Reconcile once: whatever changed before the watch attached is read by the next scan, and
      // again a moment later, for what changed while a recursive watch was still starting.
      options.nudge();
      if (entry.watched === directory)
        yield* Effect.sleep(SETTLE_MS).pipe(
          Effect.andThen(Effect.sync(options.nudge)),
          Effect.forkIn(scope),
        );
    });

  const ensure = (directory: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = entries.get(directory);
      if (current?.watched === directory) return;
      if ((retryAt.get(directory) ?? 0) > (yield* Clock.currentTimeMillis)) return;
      const own = yield* attach(directory, directory, true, (name) =>
        name === null ? true : name.endsWith(".jsonl"),
      ).pipe(Effect.result);
      if (own._tag === "Success") return yield* install(directory, own.success);
      if (own.failure !== "missing") return yield* backOff(directory);
      let ancestor = NodePath.dirname(directory);
      while (!NodeFS.existsSync(ancestor) && NodePath.dirname(ancestor) !== ancestor)
        ancestor = NodePath.dirname(ancestor);
      if (current?.watched === ancestor) return;
      const next = NodePath.relative(ancestor, directory).split(NodePath.sep)[0];
      // An ancestor's watch sees only its own entries (inotify is not recursive): when the next
      // step towards the directory appears, the watch moves there at once, not at the next scan.
      const awaiting = yield* attach(directory, ancestor, false, (name) => {
        if (name !== next && name !== null) return false;
        Effect.runSync(ensure(directory));
        return true;
      }).pipe(Effect.result);
      if (awaiting._tag === "Success") return yield* install(directory, awaiting.success);
      yield* backOff(directory);
    });

  return { ensure } satisfies SourceWatches;
});
