// @effect-diagnostics nodeBuiltinImport:off -- the daemon's native loopback port file.
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { ZeropsBrowserStreamEvent } from "@t3tools/contracts";
import { makeScriptedProvider } from "../../../../server/integration/scriptedProviderDriver.ts";
import { startScenarioMate } from "../../../../server/integration/scenarioMate.ts";
import { scriptedBrowserSource } from "../harness/scriptedBrowserSource.ts";
it.live(
  "daemon frames keep their own call identity, revision and bytes through the real browser relay",
  () =>
    Effect.gen(function* () {
      const provider = yield* makeScriptedProvider();
      const mate = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startScenarioMate({
            projectId: "browser",
            serviceId: "browser",
            hostname: "zcp",
            zeropsApiBaseUrl: "http://127.0.0.1:9/api/rest/public",
            zeropsApiToken: "scenario-key",
            publicOrigin: "https://scenario.invalid",
            now: Date.now,
            drivers: [provider.driver],
          }),
        ),
        (m) => Effect.promise(() => m.stop().then(m.remove)),
      );
      const source = yield* Effect.acquireRelease(
        Effect.promise(() => scriptedBrowserSource(mate.homeDir)),
        (s) => Effect.promise(s.close),
      );
      const frames = yield* Queue.unbounded<ZeropsBrowserStreamEvent>();
      const stream = yield* mate.browser.subscribe;
      yield* stream.pipe(
        Stream.runForEach((f) => Queue.offer(frames, f)),
        Effect.forkScoped,
      );
      yield* Effect.promise(() => source.connected);
      const evidence = {
        callId: "browser-native",
        threadId: "native-thread",
        turnId: "native-turn",
        revision: 2,
        completeness: "partial" as const,
      };
      source.frame({ data: "AAECA/8=", width: 900, height: 600, ...evidence });
      let frame: ZeropsBrowserStreamEvent;
      do {
        frame = yield* Queue.take(frames);
      } while (frame.type !== "frame");
      expect(frame).toMatchObject({
        type: "frame",
        data: "AAECA/8=",
        width: 900,
        height: 600,
        ...evidence,
      });
      source.frame({
        data: "/wMCAQA=",
        width: 901,
        height: 601,
        ...evidence,
        revision: 3,
        completeness: "complete",
      });
      do {
        frame = yield* Queue.take(frames);
      } while (frame.type !== "frame");
      expect(frame).toMatchObject({
        data: "/wMCAQA=",
        width: 901,
        height: 601,
        callId: evidence.callId,
        revision: 3,
        completeness: "complete",
      });
    }).pipe(Effect.timeout("15 seconds")),
);
