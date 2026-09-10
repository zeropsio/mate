/**
 * spec-mate.md §2.9 invariants:
 * - MU-2: a failing `zcp mate update` is a successful RPC carrying its JSON.
 * - MU-3: the descriptor's `update` field is absent, never fabricated, when
 *   `zcp` cannot be run.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

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
  }) => Effect.Effect<MateStatusResult, ZeropsCliNotFound | ZeropsCliFailed>,
) => ({
  markAgentOAuth: () => Effect.die("not used"),
  mateStatus,
  mateUpdate: () => Effect.die("not used"),
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
          refreshInterval: Duration.hours(1),
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
          refreshInterval: Duration.hours(1),
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
          refreshInterval: Duration.hours(1),
        }),
      );
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
      yield* service.refresh;
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
    }),
  );

  it.effect(
    "refresh updates the held answer on demand (used after a successful update — MU-2)",
    () =>
      Effect.gen(function* () {
        let installed = "0.8.0";
        const service = yield* Effect.scoped(
          make({
            cli: stubCli(() =>
              Effect.succeed({
                ...STATUS_RESULT,
                installed,
                updateAvailable: installed !== "0.8.1",
              }),
            ),
            isZeropsEnvironment: true,
            refreshInterval: Duration.hours(1),
          }),
        );
        expect((yield* service.current)?.available).toBe(true);
        installed = "0.8.1";
        yield* service.refresh;
        expect((yield* service.current)?.available).toBe(false);
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
          refreshInterval: Duration.hours(1),
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
          refreshInterval: Duration.hours(1),
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
