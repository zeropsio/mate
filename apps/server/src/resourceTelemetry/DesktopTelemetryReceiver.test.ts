// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { assert, describe, expect } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  type DesktopTelemetryReceiverHealth,
  make,
  initialDesktopTelemetryContactAt,
  isDesktopTelemetryContactStale,
  recordDesktopTelemetrySampleHealth,
  requireDesktopTelemetryWriteProgress,
  resolveDesktopTelemetrySnapshotStaleAfterMs,
  writeAllToFileDescriptor,
} from "./DesktopTelemetryReceiver.ts";

describe("DesktopTelemetryReceiver", () => {
  it.effect("a stale desktop ends at its own instant; no periodic scan finds it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-desktop-telemetry-",
        });
        const sampledAtUnixMs = 1_000;
        const sample = NodePath.join(baseDir, "telemetry.ndjson");
        NodeFS.writeFileSync(
          sample,
          `${JSON.stringify({
            version: 1,
            type: "desktopTelemetry",
            sequence: 1,
            sampledAtUnixMs,
            electronPid: 100,
            power: {
              source: "electron-main",
              idle: "false",
              idleSeconds: 0,
              locked: "false",
              suspended: false,
              onBattery: "false",
              lowPowerMode: "unknown",
              thermalState: "nominal",
              stale: false,
              updatedAt: DateTime.formatIso(DateTime.makeUnsafe(sampledAtUnixMs)),
            },
            speedLimitPercent: null,
            electronProcesses: [],
          })}\n`,
        );
        const config = yield* ServerConfig.pipe(
          Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
        );
        const receiver = yield* make().pipe(
          Effect.provideService(ServerConfig, {
            ...config,
            desktopTelemetryFd: NodeFS.openSync(sample, "r"),
          }),
          Effect.provide(ServerSettingsService.layerTest()),
        );
        const subscribed = yield* receiver.subscribe;
        if (Option.isNone(subscribed.latest)) yield* Stream.runHead(subscribed.changes);
        // The default intervals (30 s active, 120 s idle) make a sample stale 150 s after it.
        const staleAt =
          sampledAtUnixMs + resolveDesktopTelemetrySnapshotStaleAfterMs(30_000, 120_000);

        yield* TestClock.adjust(staleAt - 1);
        expect(Option.getOrThrow(yield* receiver.latest).power.stale).toBe(false);
        yield* TestClock.adjust(1);
        expect(Option.getOrThrow(yield* receiver.latest).power.stale).toBe(true);
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );

  it("degrades a hello-only stream after the first-sample deadline", () => {
    expect(isDesktopTelemetryContactStale(Option.some(1_000), 90_999)).toBe(false);
    expect(isDesktopTelemetryContactStale(Option.some(1_000), 91_000)).toBe(true);
    expect(isDesktopTelemetryContactStale(Option.none(), 1_000_000)).toBe(false);
  });

  it("starts the stale deadline as soon as a telemetry descriptor is opened", () => {
    expect(initialDesktopTelemetryContactAt(7, 1_000)).toEqual(Option.some(1_000));
    expect(initialDesktopTelemetryContactAt(undefined, 1_000)).toEqual(Option.none());
  });

  it("keeps the snapshot deadline beyond the configured idle polling interval", () => {
    expect(resolveDesktopTelemetrySnapshotStaleAfterMs(30_000, 120_000)).toBe(150_000);
    expect(resolveDesktopTelemetrySnapshotStaleAfterMs(60_000, 600_000)).toBe(630_000);
    expect(resolveDesktopTelemetrySnapshotStaleAfterMs(1_000, 1_000)).toBe(90_000);
  });

  it.effect("publishes the latest sample timestamp while health remains healthy", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initialSample = DateTime.makeUnsafe(1_000);
        const nextSample = DateTime.makeUnsafe(2_000);
        const health = yield* Ref.make<DesktopTelemetryReceiverHealth>({
          status: "healthy",
          lastSampleAt: Option.some(initialSample),
          lastError: Option.none<string>(),
        });
        const healthChanges = yield* PubSub.sliding<DesktopTelemetryReceiverHealth>(4);
        const subscription = yield* PubSub.subscribe(healthChanges);

        yield* recordDesktopTelemetrySampleHealth(health, healthChanges, nextSample);
        const published = yield* PubSub.take(subscription);

        expect(DateTime.toEpochMillis(Option.getOrThrow(published.lastSampleAt))).toBe(2_000);
      }),
    ),
  );

  it.effect("writes control messages through the asynchronous descriptor path", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const directory = NodeFS.mkdtempSync(
          NodePath.join(NodeOS.tmpdir(), "t3-desktop-telemetry-control-test-"),
        );
        const path = NodePath.join(directory, "control.ndjson");
        return {
          directory,
          path,
          fd: NodeFS.openSync(path, "w"),
        };
      }),
      ({ fd, path }) =>
        Effect.gen(function* () {
          const payload = Buffer.from('{"type":"setDiagnosticsDemand","enabled":true}\n');
          yield* writeAllToFileDescriptor(fd, payload);
          NodeFS.fsyncSync(fd);

          assert.equal(NodeFS.readFileSync(path, "utf8"), payload.toString("utf8"));
        }),
      ({ directory, fd }) =>
        Effect.sync(() => {
          NodeFS.closeSync(fd);
          NodeFS.rmSync(directory, { recursive: true, force: true });
        }),
    ),
  );

  it.effect("models a zero-byte control write as a stalled descriptor", () =>
    Effect.gen(function* () {
      const error = yield* requireDesktopTelemetryWriteProgress(7, 42, 0).pipe(Effect.flip);

      expect(error._tag).toBe("DesktopTelemetryControlStalled");
      expect(error.fd).toBe(7);
      expect(error.remainingBytes).toBe(42);
      expect(error.message).toBe(
        "Desktop telemetry control stalled on fd 7 with 42 bytes remaining.",
      );
      yield* requireDesktopTelemetryWriteProgress(7, 42, 1);
    }),
  );
});
