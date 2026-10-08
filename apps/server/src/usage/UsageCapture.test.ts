// @effect-diagnostics nodeBuiltinImport:off -- SQLite locks exercise real outbox migration recovery.
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderRuntimeEvent, type SpiEvent } from "@t3tools/contracts";
import { MateLinkDown, type MateLinkUp } from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ServerConfig } from "../config.ts";
import { ProviderRuntimeEventBusTest } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsOrgRead } from "../zerops/ZeropsOrgRead.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import { makeUsageCapture } from "./UsageCapture.ts";

const completion = Schema.decodeUnknownSync(ProviderRuntimeEvent)({
  eventId: "recovered-100",
  provider: "codex",
  threadId: "mate-thread",
  createdAt: "2026-10-08T10:00:00.000Z",
  type: "turn.usage.completed",
  payload: {
    nativeThreadId: "native-thread",
    nativeTurnId: "recovered-100",
    parentId: null,
    nativeCost: null,
    models: [
      {
        model: "codex",
        nativeCost: null,
        components: {
          uncachedInput: "100",
          cachedInput: "0",
          cacheCreation: "0",
          output: "0",
          reasoning: null,
          inclusiveTotal: "100",
        },
      },
    ],
  },
});
const state = Schema.decodeUnknownSync(MateLinkDown)({
  type: "state",
  mate: {
    projectId: "project",
    name: "Mate",
    face: "face",
    standupRequestedBy: null,
    closedOff: false,
    appId: null,
    appName: null,
    changes: [],
  },
  usage: { capture: 2, report: 1, mateId: "mate" },
});
const config = ServerConfig.of({
  zerops: resolveZeropsEnvironment({
    projectId: "project",
    apiHost: undefined,
    apiToken: undefined,
  }),
} as ServerConfig["Service"]);
const org = ZeropsOrgRead.of({
  project: () => Effect.succeed({ kind: "answered", status: 200, body: { clientId: "org" } }),
  members: () => Effect.succeed({ kind: "no-key" }),
});

describe("usage capture admission", () => {
  for (const failure of ["open", "migration"] as const)
    it.effect(
      `waits through a transient ${failure} failure, then captures the first 100-token turn`,
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "mate-usage-recovery-" });
          const filename = path.join(directory, "usage.sqlite");
          let blocker: NodeSqlite.DatabaseSync | undefined;
          if (failure === "open") yield* fs.makeDirectory(filename);
          else {
            blocker = yield* Effect.acquireRelease(
              Effect.sync(() => new NodeSqlite.DatabaseSync(filename)),
              (database) => Effect.sync(() => database.close()),
            );
            blocker.exec(
              "PRAGMA journal_mode=WAL; PRAGMA user_version=1; CREATE TABLE usage_snapshot(old TEXT); BEGIN IMMEDIATE",
            );
          }
          const hub = yield* PubSub.unbounded<SpiEvent>();
          const bus = yield* Layer.build(ProviderRuntimeEventBusTest.make(Stream.fromPubSub(hub)));
          const acquiring = yield* Effect.forkScoped(
            makeUsageCapture(filename).pipe(Effect.provide(bus)),
          );
          yield* TestClock.adjust("0 seconds");
          // No command admission may open with a missing usage subscription.
          assert.isUndefined(acquiring.pollUnsafe());
          if (failure === "open") yield* fs.remove(filename, { recursive: true });
          else blocker!.exec("COMMIT");
          yield* TestClock.adjust("1 second");
          const capture = yield* Fiber.join(acquiring);
          // The acquisition receipt guarantees capture is ready before the first provider event.
          yield* PubSub.publish(hub, completion);
          const sent = yield* Queue.unbounded<MateLinkUp>();
          const lane = yield* capture.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
          yield* Effect.forkScoped(lane.run);
          if (state.type !== "state") throw new Error("Expected state fixture");
          yield* lane.state(state);
          const frame = yield* Queue.take(sent);
          if (frame.type !== "usage-facts") throw new Error("Expected usage facts");
          assert.equal(frame.facts[0]!.models[0]!.components.inclusiveTotal, "100");
          yield* lane.receive({
            type: "usage-ack",
            batchId: frame.batchId,
            accepted: frame.facts.map(({ originId, factId }) => ({ originId, factId })),
          });
          yield* TestClock.adjust("0 seconds");
          const inspector = yield* Effect.acquireRelease(
            Effect.sync(() => new NodeSqlite.DatabaseSync(filename)),
            (database) => Effect.sync(() => database.close()),
          );
          assert.deepEqual(inspector.prepare("SELECT identity FROM usage_outbox").all(), []);
          assert.equal(inspector.prepare("PRAGMA user_version").get()?.user_version, 2);
          assert.deepEqual(
            inspector.prepare("SELECT name FROM sqlite_master WHERE name='usage_snapshot'").all(),
            [],
          );
        }).pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(ServerConfig, config),
          Effect.provideService(ZeropsOrgRead, org),
        ),
    );
});
