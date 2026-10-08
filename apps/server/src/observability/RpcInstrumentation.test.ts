import { assert, describe, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  GitManagerError,
  ThreadFileWritesError,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as RpcTest from "effect/rpc/RpcTest";
import * as TestClock from "effect/testing/TestClock";

import { RPC_REQUIRED_SCOPES, rpcScopeAuthorizationLayer } from "../auth/RpcAuthorization.ts";
import { rpcInstrumentationLayer } from "./RpcInstrumentation.ts";

type WsRpcMethod = keyof typeof RPC_REQUIRED_SCOPES;

/** The server group narrowed to `tags`, so a test only implements the handlers it calls. */
const groupOf = <const Tags extends ReadonlyArray<WsRpcMethod>>(...tags: Tags) =>
  WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<WsRpcMethod, Tags[number]> =>
        !(tags as ReadonlyArray<string>).includes(tag),
    ),
  );

/** The middleware ws.ts installs for a connection with `scopes`. */
const connectionMiddleware = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  Layer.merge(rpcScopeAuthorizationLayer(scopes), rpcInstrumentationLayer);
const readOnlyConnection = connectionMiddleware([AuthOrchestrationReadScope]);
const threadId = ThreadId.make("thread-instrumented");
const rpcSpanDefaults = { "rpc.transport": "websocket", "rpc.system": "effect-rpc" };

/** Runs a test with a fresh metric registry and a tracer that keeps every span it ends. */
const withTelemetry = <A, E, R>(
  test: (ended: ReadonlyArray<Tracer.NativeSpan>) => Effect.Effect<A, E, R>,
) => {
  const ended: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        ended.push(span);
      };
      return span;
    },
  });
  return test(ended).pipe(
    Effect.scoped,
    Effect.withTracer(tracer),
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
};

const rpcSpans = (ended: ReadonlyArray<Tracer.NativeSpan>) =>
  ended.filter((span) => span.name.startsWith("ws.rpc."));

// RpcTest keeps Effect's own RpcServer/RpcClient spans, which ws.ts turns off with
// `disableTracing: true`. Everything else comes from the middleware or the handlers.
const appSpans = (ended: ReadonlyArray<Tracer.NativeSpan>) =>
  ended.filter((span) => !/^Rpc(Server|Client)\./.test(span.name));

const exitTag = (span: Tracer.NativeSpan | undefined) =>
  span?.status._tag === "Ended" ? span.status.exit._tag : undefined;

const parentSpanId = (span: Tracer.NativeSpan | undefined) =>
  span?.parent._tag === "Some" ? span.parent.value.spanId : undefined;

const requestCount = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  method: string,
  outcome: string,
) =>
  snapshots.find(
    (snapshot): snapshot is Extract<Metric.Metric.Snapshot, { readonly type: "Counter" }> =>
      snapshot.type === "Counter" &&
      snapshot.id === "t3_rpc_requests_total" &&
      snapshot.attributes?.["method"] === method &&
      snapshot.attributes?.["outcome"] === outcome,
  )?.state;

const requestDuration = (snapshots: ReadonlyArray<Metric.Metric.Snapshot>, method: string) =>
  snapshots.find(
    (snapshot): snapshot is Extract<Metric.Metric.Snapshot, { readonly type: "Histogram" }> =>
      snapshot.type === "Histogram" &&
      snapshot.id === "t3_rpc_request_duration" &&
      snapshot.attributes?.["method"] === method,
  )?.state;

describe("RpcInstrumentation", () => {
  it.effect("records one span and request metric per call, including rejected calls", () =>
    withTelemetry((ended) =>
      Effect.gen(function* () {
        const group = groupOf(
          WS_METHODS.serverProbe,
          WS_METHODS.threadsFileWrites,
          WS_METHODS.serverRetryResourceTelemetry,
          WS_METHODS.subscribeZeropsHealth,
          WS_METHODS.subscribeVcsStatus,
          WS_METHODS.serverGetSettings,
        );
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.serverProbe, () =>
                Effect.succeed({}).pipe(Effect.withSpan("serverProbe.child")),
              ),
              group.toLayerHandler(WS_METHODS.threadsFileWrites, () =>
                Effect.annotateCurrentSpan({ "thread.id": threadId }).pipe(
                  Effect.andThen(new ThreadFileWritesError({ reason: "unavailable" })),
                ),
              ),
              group.toLayerHandler(WS_METHODS.serverRetryResourceTelemetry, () =>
                Effect.die("authorization let a rejected call through"),
              ),
              group.toLayerHandler(WS_METHODS.subscribeZeropsHealth, () => Stream.empty),
              group.toLayerHandler(WS_METHODS.subscribeVcsStatus, () =>
                Stream.fail(
                  new GitManagerError({ operation: "status", cwd: "/repo", detail: "failed" }),
                ),
              ),
              group.toLayerHandler(WS_METHODS.serverGetSettings, () => Effect.die("broken")),
              readOnlyConnection,
            ),
          ),
        );

        assert.deepStrictEqual(yield* client[WS_METHODS.serverProbe]({}), {});
        const listError = yield* client[WS_METHODS.threadsFileWrites]({
          threadId,
          toolCallIds: [],
        }).pipe(Effect.flip);
        assert.equal(listError._tag, "ThreadFileWritesError");
        // Retrying telemetry needs operate scope, so the handler must not run.
        const rejection = yield* client[WS_METHODS.serverRetryResourceTelemetry]({}).pipe(
          Effect.flip,
        );
        assert.equal(rejection._tag, "EnvironmentAuthorizationError");
        const health = yield* Stream.runCollect(client[WS_METHODS.subscribeZeropsHealth]({}));
        assert.deepStrictEqual(Array.from(health), []);
        const subscribeError = yield* Stream.runDrain(
          client[WS_METHODS.subscribeVcsStatus]({ cwd: "/repo" }),
        ).pipe(Effect.flip);
        assert.equal(subscribeError._tag, "GitManagerError");
        const settingsExit = yield* Effect.exit(client[WS_METHODS.serverGetSettings]({}));
        assert.isTrue(Exit.hasDies(settingsExit));

        assert.deepStrictEqual(
          rpcSpans(ended).map((span) => [span.name, Object.fromEntries(span.attributes)]),
          [
            [
              `ws.rpc.${WS_METHODS.serverProbe}`,
              {
                ...rpcSpanDefaults,
                "rpc.method": WS_METHODS.serverProbe,
                "rpc.aggregate": "server",
              },
            ],
            [
              `ws.rpc.${WS_METHODS.threadsFileWrites}`,
              {
                ...rpcSpanDefaults,
                "rpc.method": WS_METHODS.threadsFileWrites,
                "rpc.aggregate": "orchestration",
                "thread.id": threadId,
              },
            ],
            [
              `ws.rpc.${WS_METHODS.serverRetryResourceTelemetry}`,
              {
                ...rpcSpanDefaults,
                "rpc.method": WS_METHODS.serverRetryResourceTelemetry,
                "rpc.aggregate": "server",
              },
            ],
            [
              `ws.rpc.${WS_METHODS.subscribeZeropsHealth}`,
              {
                ...rpcSpanDefaults,
                "rpc.method": WS_METHODS.subscribeZeropsHealth,
                "rpc.aggregate": "zerops",
              },
            ],
            [
              `ws.rpc.${WS_METHODS.subscribeVcsStatus}`,
              {
                ...rpcSpanDefaults,
                "rpc.method": WS_METHODS.subscribeVcsStatus,
                "rpc.aggregate": "vcs",
              },
            ],
            [
              `ws.rpc.${WS_METHODS.serverGetSettings}`,
              {
                ...rpcSpanDefaults,
                "rpc.method": WS_METHODS.serverGetSettings,
                "rpc.aggregate": "server",
              },
            ],
          ],
        );
        assert.deepStrictEqual(rpcSpans(ended).map(exitTag), [
          "Success",
          "Failure",
          "Failure",
          "Success",
          "Failure",
          "Failure",
        ]);
        const probeSpan = rpcSpans(ended)[0];
        const child = ended.find((span) => span.name === "serverProbe.child");
        assert.equal(parentSpanId(child), probeSpan?.spanId);

        const snapshots = yield* Metric.snapshot;
        assert.deepStrictEqual(
          [
            requestCount(snapshots, WS_METHODS.serverProbe, "success"),
            requestCount(snapshots, WS_METHODS.threadsFileWrites, "failure"),
            requestCount(snapshots, WS_METHODS.serverRetryResourceTelemetry, "failure"),
            requestCount(snapshots, WS_METHODS.subscribeZeropsHealth, "success"),
            requestCount(snapshots, WS_METHODS.subscribeVcsStatus, "failure"),
            requestCount(snapshots, WS_METHODS.serverGetSettings, "failure"),
          ].map((state) => state?.count),
          [1, 1, 1, 1, 1, 1],
        );
        for (const method of group.requests.keys()) {
          assert.equal(requestDuration(snapshots, method)?.count, 1);
        }
      }),
    ),
  );

  it.effect("keeps a stream's span and duration open until the subscription is interrupted", () =>
    withTelemetry((ended) =>
      Effect.gen(function* () {
        const waiting = yield* Deferred.make<void>();
        const group = groupOf(WS_METHODS.subscribeVcsStatus);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.subscribeVcsStatus, () =>
                Stream.fromEffect(
                  Deferred.succeed(waiting, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.withSpan("status.wait"),
                  ),
                ),
              ),
              readOnlyConnection,
            ),
          ),
        );

        // Wall and monotonic time disagree before the call starts, so a duration that mixes
        // the two clocks is caught.
        yield* TestClock.adjust(Duration.seconds(1));
        yield* TestClock.setTime(0);
        const consumer = yield* Stream.runDrain(
          client[WS_METHODS.subscribeVcsStatus]({ cwd: "/repo" }),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(waiting);
        yield* TestClock.adjust(Duration.millis(250));
        // A backward wall-clock correction must not shorten the measured duration.
        yield* TestClock.setTime(0);
        assert.deepStrictEqual(appSpans(ended), []);

        // The client waits for the server to stop the call, which ends the RPC span.
        yield* Fiber.interrupt(consumer);

        const [rpcSpan] = rpcSpans(ended);
        assert.equal(rpcSpan?.name, `ws.rpc.${WS_METHODS.subscribeVcsStatus}`);
        assert.equal(exitTag(rpcSpan), "Failure");
        const waitSpan = ended.find((span) => span.name === "status.wait");
        assert.equal(parentSpanId(waitSpan), rpcSpan?.spanId);

        const snapshots = yield* Metric.snapshot;
        assert.equal(requestCount(snapshots, WS_METHODS.subscribeVcsStatus, "interrupt")?.count, 1);
        const duration = requestDuration(snapshots, WS_METHODS.subscribeVcsStatus);
        assert.equal(duration?.count, 1);
        assert.equal(duration?.sum, 250);
      }),
    ),
  );

  it.effect("records metrics but no spans for methods with tracing disabled", () =>
    withTelemetry((ended) =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.serverSignalProcess);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.serverSignalProcess, (input) =>
                Effect.succeed({
                  pid: input.pid,
                  signal: input.signal,
                  signaled: true,
                  message: Option.none(),
                }).pipe(Effect.withSpan("signalProcess.child")),
              ),
              connectionMiddleware([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]),
            ),
          ),
        );

        const input = { pid: 4242, startTimeMs: 0, signal: "SIGINT" } as const;
        assert.equal((yield* client[WS_METHODS.serverSignalProcess](input)).signaled, true);

        assert.deepStrictEqual(appSpans(ended), []);
        const snapshots = yield* Metric.snapshot;
        assert.equal(requestCount(snapshots, WS_METHODS.serverSignalProcess, "success")?.count, 1);
      }),
    ),
  );
  it.effect("records success metrics for unary RPC handlers", () =>
    withTelemetry(() =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.serverProbe);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
              readOnlyConnection,
            ),
          ),
        );

        assert.deepStrictEqual(yield* client[WS_METHODS.serverProbe]({}), {});

        const snapshots = yield* Metric.snapshot;
        assert.equal(requestCount(snapshots, WS_METHODS.serverProbe, "success")?.count, 1);
        assert.equal(requestDuration(snapshots, WS_METHODS.serverProbe)?.count, 1);
      }),
    ),
  );

  it.effect("records failure outcomes for unary RPC handlers", () =>
    withTelemetry(() =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.threadsFileWrites);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.threadsFileWrites, () =>
                Effect.fail(new ThreadFileWritesError({ reason: "unavailable" })),
              ),
              readOnlyConnection,
            ),
          ),
        );

        const error = yield* client[WS_METHODS.threadsFileWrites]({
          threadId,
          toolCallIds: [],
        }).pipe(Effect.flip);
        assert.equal(error._tag, "ThreadFileWritesError");

        const snapshots = yield* Metric.snapshot;
        assert.equal(requestCount(snapshots, WS_METHODS.threadsFileWrites, "failure")?.count, 1);
      }),
    ),
  );

  it.effect("records subscription activation metrics for stream RPC handlers", () =>
    withTelemetry(() =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.subscribeZeropsHealth);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.subscribeZeropsHealth, () => Stream.empty),
              readOnlyConnection,
            ),
          ),
        );

        yield* Stream.runDrain(client[WS_METHODS.subscribeZeropsHealth]({}));

        const snapshots = yield* Metric.snapshot;
        assert.equal(
          requestCount(snapshots, WS_METHODS.subscribeZeropsHealth, "success")?.count,
          1,
        );
        assert.equal(requestDuration(snapshots, WS_METHODS.subscribeZeropsHealth)?.count, 1);
      }),
    ),
  );

  it.effect("records failure outcomes for direct stream RPC handlers during consumption", () =>
    withTelemetry(() =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.subscribeVcsStatus);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.subscribeVcsStatus, () =>
                Stream.fail(
                  new GitManagerError({ operation: "status", cwd: "/repo", detail: "failed" }),
                ),
              ),
              readOnlyConnection,
            ),
          ),
        );

        const error = yield* Stream.runDrain(
          client[WS_METHODS.subscribeVcsStatus]({ cwd: "/repo" }),
        ).pipe(Effect.flip);
        assert.equal(error._tag, "GitManagerError");

        const snapshots = yield* Metric.snapshot;
        assert.equal(requestCount(snapshots, WS_METHODS.subscribeVcsStatus, "failure")?.count, 1);
      }),
    ),
  );

  it.effect("records direct stream durations from nanosecond clock readings", () =>
    withTelemetry(() =>
      Effect.gen(function* () {
        const duration = Duration.nanos(1_500_000n);
        const group = groupOf(WS_METHODS.subscribeZeropsHealth);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.subscribeZeropsHealth, () =>
                Stream.fromEffect(Effect.sleep(duration)).pipe(Stream.drain),
              ),
              readOnlyConnection,
            ),
          ),
        );

        const fiber = yield* Stream.runDrain(client[WS_METHODS.subscribeZeropsHealth]({})).pipe(
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust(duration);
        yield* Fiber.join(fiber);

        const snapshots = yield* Metric.snapshot;
        const recorded = requestDuration(snapshots, WS_METHODS.subscribeZeropsHealth);
        assert.equal(recorded?.count, 1);
        assert.equal(recorded?.sum, 1.5);
      }),
    ),
  );

  it.effect("records failure outcomes when a stream RPC effect produces a failing stream", () =>
    withTelemetry(() =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.subscribeVcsStatus);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.subscribeVcsStatus, () =>
                Stream.unwrap(
                  Effect.succeed(
                    Stream.fail(
                      new GitManagerError({ operation: "status", cwd: "/repo", detail: "failed" }),
                    ),
                  ),
                ),
              ),
              readOnlyConnection,
            ),
          ),
        );

        yield* Stream.runDrain(client[WS_METHODS.subscribeVcsStatus]({ cwd: "/repo" })).pipe(
          Effect.flip,
        );

        const snapshots = yield* Metric.snapshot;
        assert.equal(requestCount(snapshots, WS_METHODS.subscribeVcsStatus, "failure")?.count, 1);
      }),
    ),
  );

  it.effect("records spans for traced stream RPC handlers", () =>
    withTelemetry((ended) =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.subscribeZeropsHealth);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.subscribeZeropsHealth, () =>
                Stream.fromEffect(Effect.void.pipe(Effect.withSpan("health.child"))).pipe(
                  Stream.drain,
                ),
              ),
              readOnlyConnection,
            ),
          ),
        );

        yield* Stream.runDrain(client[WS_METHODS.subscribeZeropsHealth]({}));

        const [rpcSpan] = rpcSpans(ended);
        assert.equal(rpcSpan?.name, `ws.rpc.${WS_METHODS.subscribeZeropsHealth}`);
        assert.equal(rpcSpan?.attributes.get("rpc.aggregate"), "zerops");
        const child = ended.find((span) => span.name === "health.child");
        assert.equal(parentSpanId(child), rpcSpan?.spanId);
      }),
    ),
  );

  it.effect("does not create spans for disabled unary RPC handlers", () =>
    withTelemetry((ended) =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.serverGetProcessDiagnostics);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.serverGetProcessDiagnostics, () =>
                Effect.die("diagnostics are not under test").pipe(
                  Effect.withSpan("diagnostics.child"),
                ),
              ),
              readOnlyConnection,
            ),
          ),
        );

        yield* Effect.exit(client[WS_METHODS.serverGetProcessDiagnostics]({}));

        assert.deepStrictEqual(appSpans(ended), []);
      }),
    ),
  );
});
