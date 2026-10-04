// @effect-diagnostics nodeBuiltinImport:off -- Tests the native publication watcher with disposable files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { observeStreamPorts, type WatchEndpoint } from "./browserStreamEndpoint.ts";

const fixture = () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-browser-endpoint-"));
  const directory = NodePath.join(home, ".agent-browser");
  const file = NodePath.join(directory, "default.stream");
  const handles: Array<{
    path: string;
    change: (filename: string | null) => void;
    error: ((error: Error) => void) | undefined;
    closed: boolean;
  }> = [];
  const watch: WatchEndpoint = (path, change) => {
    const handle = {
      path,
      change,
      closed: false,
      error: undefined as ((error: Error) => void) | undefined,
    };
    handles.push(handle);
    return {
      close: () => {
        handle.closed = true;
      },
      onError: (listener) => {
        handle.error = listener;
      },
    };
  };
  return { home, directory, file, handles, watch };
};

describe("browser endpoint publications", () => {
  it.effect(
    "observes late directory creation, deduplicates notifications, and notices a same-port republication",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* Effect.acquireRelease(Effect.sync(fixture), (f) =>
            Effect.sync(() => NodeFS.rmSync(f.home, { recursive: true, force: true })),
          );
          yield* Effect.scoped(
            Effect.gen(function* () {
              const pull = yield* Stream.toPull(observeStreamPorts(f.home, f.watch));
              expect(yield* pull).toEqual([undefined]);
              NodeFS.mkdirSync(f.directory);
              NodeFS.writeFileSync(f.file, "44831\n");
              f.handles[0]!.change(".agent-browser");
              expect(yield* pull).toEqual([44831]);
              f.handles[1]!.change("default.stream");
              f.handles[1]!.change("default.stream");
              NodeFS.unlinkSync(f.file);
              NodeFS.writeFileSync(f.file, "44831\n");
              f.handles[1]!.change("default.stream");
              expect(yield* pull).toEqual([44831]);
              NodeFS.unlinkSync(f.file);
              f.handles[1]!.change("default.stream");
              expect(yield* pull).toEqual([undefined]);
            }),
          );
          expect(f.handles.every((handle) => handle.closed)).toBe(true);
        }),
      ),
  );

  it.effect("reports a watcher failure and closes its handles", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* Effect.acquireRelease(Effect.sync(fixture), (f) =>
          Effect.sync(() => NodeFS.rmSync(f.home, { recursive: true, force: true })),
        );
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const pull = yield* Stream.toPull(observeStreamPorts(f.home, f.watch));
            yield* pull;
            f.handles[0]!.error?.(new Error("watch permission denied"));
            return yield* pull;
          }),
        ).pipe(Effect.result);
        expect(result).toMatchObject({ _tag: "Failure", failure: "watch permission denied" });
        expect(f.handles.every((handle) => handle.closed)).toBe(true);
      }),
    ),
  );
});
