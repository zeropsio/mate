/**
 * spec-mate.md §2.9 MU-2: `zerops.mate.update` is offered only inside a
 * Zerops project with `zcp` on PATH; a failing `zcp mate update` is a
 * successful RPC carrying its JSON, never a transport error.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ZeropsCliFailed, ZeropsCliNotFound } from "./ZeropsCli.ts";
import { runZeropsMateCheckUpdate, runZeropsMateUpdate } from "./registerZeropsRpc.ts";

const stubMateUpdate = (result: Effect.Effect<any, ZeropsCliNotFound | ZeropsCliFailed>) => ({
  markAgentOAuth: () => Effect.die("not used"),
  mateStatus: () => Effect.die("not used"),
  mateUpdate: () => result,
});

const stubMateUpdateService = (
  refresh: Effect.Effect<void> = Effect.void,
  check: Effect.Effect<any> = Effect.die("not used"),
) => ({
  current: Effect.succeed(undefined),
  refresh,
  check,
});

describe("runZeropsMateUpdate", () => {
  it.effect(
    "fails with EnvironmentAuthorizationError outside a Zerops project, without calling zcp",
    () =>
      Effect.gen(function* () {
        let called = false;
        const error = yield* Effect.flip(
          runZeropsMateUpdate({
            zeropsCli: stubMateUpdate(
              Effect.sync(() => {
                called = true;
                return { action: "none", from: "0.8.0", to: "0.8.0", restarted: false };
              }),
            ),
            zeropsMateUpdate: stubMateUpdateService(),
            isZeropsEnvironment: false,
            serverVersion: "0.8.0",
          }),
        );
        expect(error._tag).toBe("EnvironmentAuthorizationError");
        expect(called).toBe(false);
      }),
  );

  it.effect("maps a missing zcp binary to ZeropsMateUpdateError, not an authorization error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runZeropsMateUpdate({
          zeropsCli: stubMateUpdate(Effect.fail(new ZeropsCliNotFound({ command: "zcp" }))),
          zeropsMateUpdate: stubMateUpdateService(),
          isZeropsEnvironment: true,
          serverVersion: "0.8.0",
        }),
      );
      expect(error._tag).toBe("ZeropsMateUpdateError");
      expect((error as { reason?: string }).reason).toBe("zcp-not-found");
    }),
  );

  it.effect("maps a zcp spawn/parse failure to ZeropsMateUpdateError with reason zcp-failed", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runZeropsMateUpdate({
          zeropsCli: stubMateUpdate(
            Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "not json" })),
          ),
          zeropsMateUpdate: stubMateUpdateService(),
          isZeropsEnvironment: true,
          serverVersion: "0.8.0",
        }),
      );
      expect(error._tag).toBe("ZeropsMateUpdateError");
      expect((error as { reason?: string }).reason).toBe("zcp-failed");
    }),
  );

  it.effect("maps a timed-out zcp run to ZeropsMateUpdateError with reason timed-out", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runZeropsMateUpdate({
          zeropsCli: stubMateUpdate(
            Effect.fail(
              new ZeropsCliFailed({
                command: "zcp",
                reason: "Process zcp mate update timed out after 300000ms",
              }),
            ),
          ),
          zeropsMateUpdate: stubMateUpdateService(),
          isZeropsEnvironment: true,
          serverVersion: "0.8.0",
        }),
      );
      expect(error._tag).toBe("ZeropsMateUpdateError");
      expect((error as { reason?: string }).reason).toBe("timed-out");
    }),
  );

  it.effect("succeeds with the CLI's JSON even when the update itself failed (MU-2)", () =>
    Effect.gen(function* () {
      const result = yield* runZeropsMateUpdate({
        zeropsCli: stubMateUpdate(
          Effect.succeed({
            action: "none",
            from: "0.8.0",
            to: "0.8.0",
            restarted: false,
            error: "manifest unreachable",
          }),
        ),
        zeropsMateUpdate: stubMateUpdateService(),
        isZeropsEnvironment: true,
        serverVersion: "0.8.0",
      });
      expect(result).toEqual({
        action: "none",
        from: "0.8.0",
        to: "0.8.0",
        restarted: false,
        error: "manifest unreachable",
        serverVersion: "0.8.0",
      });
    }),
  );

  it.effect("refreshes ZeropsMateUpdate after a successful update, not otherwise", () =>
    Effect.gen(function* () {
      let refreshCount = 0;
      const refresh = Effect.sync(() => {
        refreshCount += 1;
      });

      yield* runZeropsMateUpdate({
        zeropsCli: stubMateUpdate(
          Effect.succeed({ action: "none", from: "0.8.0", to: "0.8.0", restarted: false }),
        ),
        zeropsMateUpdate: stubMateUpdateService(refresh),
        isZeropsEnvironment: true,
        serverVersion: "0.8.0",
      });
      expect(refreshCount).toBe(0);

      yield* runZeropsMateUpdate({
        zeropsCli: stubMateUpdate(
          Effect.succeed({ action: "updated", from: "0.8.0", to: "0.8.1", restarted: true }),
        ),
        zeropsMateUpdate: stubMateUpdateService(refresh),
        isZeropsEnvironment: true,
        serverVersion: "0.8.0",
      });
      expect(refreshCount).toBe(1);
    }),
  );
});

describe("runZeropsMateCheckUpdate", () => {
  it.effect("fails with EnvironmentAuthorizationError outside a Zerops project", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runZeropsMateCheckUpdate({
          zeropsMateUpdate: stubMateUpdateService(Effect.void, Effect.die("not used")),
          isZeropsEnvironment: false,
        }),
      );
      expect(error._tag).toBe("EnvironmentAuthorizationError");
    }),
  );

  it.effect("returns the checked value inside a Zerops project", () =>
    Effect.gen(function* () {
      const result = yield* runZeropsMateCheckUpdate({
        zeropsMateUpdate: stubMateUpdateService(
          Effect.void,
          Effect.succeed({
            installed: "0.8.0",
            latest: "0.8.1",
            available: true,
            checkedAt: "2026-09-09T00:00:00Z",
          }),
        ),
        isZeropsEnvironment: true,
      });
      expect(result).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
    }),
  );

  it.effect("maps an undefined check result to null", () =>
    Effect.gen(function* () {
      const result = yield* runZeropsMateCheckUpdate({
        zeropsMateUpdate: stubMateUpdateService(Effect.void, Effect.succeed(undefined)),
        isZeropsEnvironment: true,
      });
      expect(result).toBeNull();
    }),
  );
});
