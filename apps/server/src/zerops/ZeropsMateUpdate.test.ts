// @effect-diagnostics nodeBuiltinImport:off
/**
 * spec-mate.md §2.9 invariants:
 * - MU-2: a failing `zcp mate update` is a successful RPC carrying its JSON.
 * - MU-3: the descriptor's `update` field is absent, never fabricated, when
 *   `zcp` cannot be run.
 */
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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

describe("ZeropsMateUpdate's update line, followed", () => {
  // The Mate's link to HQ sends the line again whenever it moves (step A).
  it.effect("publishes a changed update line to whoever follows it", () =>
    Effect.gen(function* () {
      let latest = "0.8.1";
      const service = yield* make({
        cli: stubCli(() => Effect.succeed({ ...STATUS_RESULT, latest })),
        isZeropsEnvironment: true,
        refreshInterval: Duration.hours(1),
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

describe("ZeropsMateUpdate hears zcp's own reads", () => {
  // zcp caches the release manifest it fetched (~/.zcp/mate/manifest.json, an
  // hour's TTL); a refresh by the Mate's agent, a shell or zcp's boot rewrites it.
  it.live(
    "a release zcp has already read reaches the app without waiting for the hourly check",
    () =>
      Effect.gen(function* () {
        const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-manifest-"));
        const manifestFile = NodePath.join(dir, "manifest.json");
        NodeFS.writeFileSync(manifestFile, JSON.stringify({ manifest: { version: "0.15.30" } }));
        let cached = "0.15.30";
        const reads: Array<{ readonly refresh?: boolean; readonly local?: boolean } | undefined> =
          [];
        const service = yield* make({
          cli: stubCli((options) => {
            reads.push(options);
            return Effect.succeed({ ...STATUS_RESULT, installed: "0.15.30", latest: cached });
          }),
          isZeropsEnvironment: true,
          refreshInterval: Duration.hours(1),
          manifestFile,
        });
        expect((yield* service.current)?.latest).toBe("0.15.30");

        cached = "0.15.31";
        reads.length = 0;
        NodeFS.writeFileSync(manifestFile, JSON.stringify({ manifest: { version: "0.15.31" } }));
        const heard = yield* service.changes.pipe(
          Stream.filter((line) => line?.latest === "0.15.31"),
          Stream.runHead,
          Effect.timeout(Duration.seconds(5)),
        );

        expect(heard._tag).toBe("Some");
        expect(reads.every((options) => options?.local === true)).toBe(true);
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }).pipe(Effect.scoped),
  );
});
