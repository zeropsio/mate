/**
 * spec-mate.md §2.9 invariants:
 * - MU-2: a failing `zcp mate update` is a successful RPC carrying its JSON.
 * - MU-3: the descriptor's `update` field is absent, never fabricated, when
 *   `zcp` cannot be run.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Stream from "effect/Stream";

import { ZeropsCliFailed, ZeropsCliNotFound } from "./ZeropsCli.ts";
import { make } from "./ZeropsMateUpdate.ts";
import type { MateStatusResult } from "./zeropsMateUpdateParse.ts";

const STATUS_RESULT: MateStatusResult = {
  installed: "0.8.0",
  latest: "0.8.1",
  contract: 1,
  updateAvailable: true,
  checkedAt: "2026-09-09T00:00:00Z",
};

const stubCli = (
  mateStatus: (options?: {
    readonly refresh?: boolean;
    readonly local?: boolean;
  }) => Effect.Effect<MateStatusResult, ZeropsCliNotFound | ZeropsCliFailed>,
) => ({
  mateStatus,
});

describe("ZeropsMateUpdate (MU-3: absent, never fabricated)", () => {
  it.effect("holds nothing outside a Zerops project — mateStatus is never called", () =>
    Effect.gen(function* () {
      let called = false;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => {
            called = true;
            return Effect.succeed(STATUS_RESULT);
          }),
          isZeropsEnvironment: false,
        }),
      );
      expect(yield* service.current).toBeUndefined();
      expect(called).toBe(false);
    }),
  );

  it.effect("holds the mapped status once started inside a Zerops project", () =>
    Effect.gen(function* () {
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => Effect.succeed(STATUS_RESULT)),
          isZeropsEnvironment: true,
        }),
      );
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
    }),
  );

  it.effect("clears to absent when zcp is not found", () =>
    Effect.gen(function* () {
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => Effect.fail(new ZeropsCliNotFound({ command: "zcp" }))),
          isZeropsEnvironment: true,
        }),
      );
      expect(yield* service.current).toBeUndefined();
    }),
  );

  it.effect("keeps the last good answer through a transient failure", () =>
    Effect.gen(function* () {
      let call = 0;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => {
            call += 1;
            return call === 1
              ? Effect.succeed(STATUS_RESULT)
              : Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "timed out" }));
          }),
          isZeropsEnvironment: true,
        }),
      );
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
      yield* service.check;
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
    }),
  );

  it.effect("check re-reads the manifest with --refresh, updates and returns the new value", () =>
    Effect.gen(function* () {
      let installed = "0.8.0";
      let sawRefresh = false;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli((options) => {
            sawRefresh = options?.refresh === true;
            return Effect.succeed({
              ...STATUS_RESULT,
              installed,
              updateAvailable: installed !== "0.8.1",
            });
          }),
          isZeropsEnvironment: true,
        }),
      );
      installed = "0.8.1";
      const result = yield* service.check;
      expect(sawRefresh).toBe(true);
      expect(result?.available).toBe(false);
      expect((yield* service.current)?.available).toBe(false);
    }),
  );

  it.effect("check keeps the previous value when zcp fails", () =>
    Effect.gen(function* () {
      let call = 0;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => {
            call += 1;
            return call === 1
              ? Effect.succeed(STATUS_RESULT)
              : Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "timed out" }));
          }),
          isZeropsEnvironment: true,
        }),
      );
      const result = yield* service.check;
      expect(result).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
      expect(yield* service.current).toEqual(result);
    }),
  );
});

describe("ZeropsMateUpdate's update line, followed", () => {
  // The Mate's link to HQ sends the line again whenever it moves (step A).
  it.effect("publishes a changed update line to whoever follows it", () =>
    Effect.gen(function* () {
      let latest = "0.8.1";
      const service = yield* make({
        cli: stubCli(() => Effect.succeed({ ...STATUS_RESULT, latest })),
        isZeropsEnvironment: true,
      });
      const heard = yield* service.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      latest = "0.8.2";
      yield* service.check;
      const lines = yield* Fiber.join(heard);
      expect(Array.from(lines).map((line) => line?.latest)).toEqual(["0.8.1", "0.8.2"]);
    }).pipe(Effect.scoped),
  );
});

it.effect.each([
  { failure: "initial read", warning: "zerops mate update: local status read failed" },
])("logs a $failure failure without fabricating an update", ({ warning }) => {
  const messages: Array<unknown> = [];
  const logger = Logger.make(({ message }) => {
    messages.push(message);
  });
  return Effect.gen(function* () {
    const service = yield* make({
      isZeropsEnvironment: true,
      cli: stubCli(() => Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "timed out" }))),
    });
    expect(messages.flat()).toContain(warning);
    expect((yield* service.current)?.latest).toBe(undefined);
  }).pipe(Effect.scoped, Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
});

describe("a Mate that only a restart gets current", () => {
  const BEHIND: MateStatusResult = {
    installed: "0.15.200",
    latest: "0.15.200",
    contract: 1,
    updateAvailable: false,
    checkedAt: "2026-10-27T00:00:00Z",
    updater: { protocol: 1, phase: "idle", runningVersion: "0.15.200" },
    zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
    restartNeeded: true,
    why: "zcp 9.226.0 is out; only a restart installs it",
  };

  it.effect("the update line relays zcp's own reading and why only a restart gets it current", () =>
    Effect.gen(function* () {
      const service = yield* make({
        cli: stubCli(() => Effect.succeed(BEHIND)),
        isZeropsEnvironment: true,
      });
      expect(yield* service.current).toMatchObject({
        zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
        restart: { needed: true, why: "zcp 9.226.0 is out; only a restart installs it" },
      });
    }).pipe(Effect.scoped),
  );
});
