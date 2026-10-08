import { assert, describe, it } from "@effect/vitest";
import { ProviderRuntimeEvent, type SpiEvent } from "@t3tools/contracts";
import { MateLinkDown, type MateLinkUp } from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import { ProviderRuntimeEventBusTest } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsOrgRead } from "../zerops/ZeropsOrgRead.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import { makeUsageLink } from "./UsageLink.ts";
import { makeUsageOutbox } from "./UsageOutbox.ts";

const event = Schema.decodeUnknownSync(ProviderRuntimeEvent)({
  eventId: "completion",
  provider: "codex",
  threadId: "mate-thread",
  createdAt: "2026-10-08T10:00:00.000Z",
  type: "turn.usage.completed",
  payload: {
    nativeThreadId: "native-thread",
    nativeTurnId: "turn",
    models: [
      {
        model: "gpt-5.6-sol",
        components: {
          uncachedInput: "20",
          cachedInput: "0",
          cacheCreation: "0",
          output: "10",
          reasoning: null,
          inclusiveTotal: "30",
        },
        nativeCost: null,
      },
    ],
    nativeCost: null,
    parentId: null,
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

describe("Mate usage on the existing HQ link", () => {
  it.effect(
    "completion capture is subscribed before the first turn and survives loss of its HQ acknowledgement",
    () =>
      Effect.gen(function* () {
        const hub = yield* PubSub.unbounded<SpiEvent>();
        const bus = yield* Layer.build(ProviderRuntimeEventBusTest.make(Stream.fromPubSub(hub)));
        const link = yield* makeUsageLink.pipe(Effect.provide(bus));
        // There is no connection or report consumer when the provider completes.
        yield* PubSub.publish(hub, event);
        const sent = yield* Queue.unbounded<MateLinkUp>();
        const lane = yield* link.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
        const running = yield* Effect.forkScoped(lane.run);
        if (state.type !== "state") throw new Error("Expected state fixture");
        yield* lane.state(state);
        const first = yield* Queue.take(sent);
        if (first.type !== "usage-facts") throw new Error("Expected immutable usage facts");
        assert.equal(first.facts.length, 1);
        assert.equal(first.facts[0]!.models[0]!.components.inclusiveTotal, "30");
        const reconnect = yield* link.open((frame) => Queue.offer(sent, frame).pipe(Effect.asVoid));
        yield* reconnect.state(state);
        const repeated = yield* Queue.take(sent);
        assert.deepEqual(repeated, first);
        yield* lane.receive({
          type: "usage-ack",
          batchId: first.batchId,
          accepted: first.facts.map(({ originId, factId }) => ({ originId, factId })),
        });
        const box = yield* makeUsageOutbox;
        assert.isDefined(yield* box.batch);
        yield* reconnect.receive({
          type: "usage-ack",
          batchId: first.batchId,
          accepted: first.facts.map(({ originId, factId }) => ({ originId, factId })),
        });
        assert.isUndefined(yield* box.batch);
        yield* Fiber.interrupt(running);
      }).pipe(
        Effect.provide(Sqlite.layer({ filename: ":memory:" })),
        Effect.provideService(ServerConfig, config),
        Effect.provideService(ZeropsOrgRead, org),
      ),
  );
});
