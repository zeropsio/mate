// @effect-diagnostics nodeBuiltinImport:off -- raw kernel files in an isolated container boundary.
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { MateHealth } from "@t3tools/contracts";
import { makeScriptedProvider } from "./scriptedProviderDriver.ts";
import { startScenarioMate } from "./scenarioMate.ts";
import { scriptedResourceSensor } from "./scriptedResourceSensor.ts";
it.live(
  "raw container sensor changes publish pressure and recovery through the real health projection",
  () =>
    Effect.gen(function* () {
      const sensor = yield* Effect.acquireRelease(Effect.promise(scriptedResourceSensor), (s) =>
        Effect.promise(s.remove),
      );
      const provider = yield* makeScriptedProvider();
      const mate = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startScenarioMate({
            projectId: "sensor",
            serviceId: "sensor",
            hostname: "zcp",
            zeropsApiBaseUrl: "http://127.0.0.1:9/api/rest/public",
            zeropsApiToken: "scenario-key",
            publicOrigin: "https://scenario.invalid",
            now: Date.now,
            drivers: [provider.driver],
            cgroupDirectories: [sensor.directory],
          }),
        ),
        (m) => Effect.promise(() => m.stop().then(m.remove)),
      );
      const frames = yield* Queue.unbounded<MateHealth>();
      yield* mate.attention.healthChanges.pipe(
        Stream.runForEach((h) => Queue.offer(frames, h)),
        Effect.forkScoped,
      );
      const first = yield* Queue.take(frames);
      expect(first.evidence).toMatchObject({
        status: "ok",
        memory: { current: 268435456, max: 2147483648 },
        pids: { current: 136, max: 2000 },
      });
      yield* Effect.promise(() =>
        sensor.write({
          "memory.pressure":
            "some avg10=60 avg60=40 avg300=40 total=300\nfull avg10=40 avg60=10 avg300=10 total=200\n",
        }),
      );
      let strained: MateHealth;
      do {
        strained = yield* Queue.take(frames);
      } while (strained.evidence.status !== "strained");
      expect(strained.evidence).toMatchObject({
        status: "strained",
        severity: "warning",
        resources: ["memory"],
      });
      expect(strained.source.revision).toBeGreaterThan(first.source.revision);
      expect(strained.source.environmentId).toBe(first.source.environmentId);
      yield* Effect.promise(() =>
        sensor.write({
          "memory.pressure":
            "some avg10=0 avg60=0 avg300=0 total=300\nfull avg10=0 avg60=0 avg300=0 total=200\n",
        }),
      );
      let recovered: MateHealth;
      do {
        recovered = yield* Queue.take(frames);
      } while (recovered.evidence.status !== "ok");
      expect(recovered.source.revision).toBeGreaterThan(strained.source.revision);
      expect(recovered.evidence.resources).toEqual([]);
    }),
);
