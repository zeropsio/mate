// @effect-diagnostics nodeBuiltinImport:off -- readiness diagnostics exercise a stalled real HTTP peer.
import * as NodeHttp from "node:http";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";
import {
  type Call,
  type ReadinessStep,
  READINESS_HEADER,
  makeHttpCall,
  untilHealth,
} from "./httpCall.ts";

it.effect(
  "when HQ setup readiness times out its error names the stalled request step with timestamps",
  () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const server = NodeHttp.createServer(() => Deferred.doneUnsafe(entered, Effect.void));
      const agent = new NodeHttp.Agent({ keepAlive: true });
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          agent.destroy();
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }),
      );
      yield* Effect.promise(
        () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
      );
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("fake server has no port");
      const fiber = yield* Effect.forkScoped(
        untilHealth(makeHttpCall(`127.0.0.1:${address.port}`, agent), "active"),
      );
      yield* Deferred.await(entered);
      yield* TestClock.adjust("9999 millis");
      assert.isUndefined(fiber.pollUnsafe());
      yield* TestClock.adjust("1 millis");
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = String(exit.cause);
        assert.include(error, "stalled step: response headers");
        assert.match(error, /connect @ \d+ms/);
        assert.match(error, /request written @ \d+ms/);
        assert.match(error, /started \d{4}-\d{2}-\d{2}T/);
        assert.include(error, "SQL/handler: unobserved");
      }
    }),
);

it.effect.each(["body", "SQL", "SQL/handler"] as const)(
  "HQ setup readiness names a stalled %s from its request receipts",
  (stalled) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const observers = new Map<string, (step: ReadinessStep) => void>();
      const server = NodeHttp.createServer((request, response) => {
        if (stalled === "body") {
          response.writeHead(200, { "content-type": "application/json" });
          response.flushHeaders();
        } else {
          const id = request.headers[READINESS_HEADER];
          assert.isString(id);
          const observe = observers.get(String(id));
          assert.isDefined(observe);
          observe?.("handler");
          observe?.("SQL");
          if (stalled === "SQL/handler") observe?.("SQL complete");
          Deferred.doneUnsafe(entered, Effect.void);
        }
      });
      const agent = new NodeHttp.Agent({ keepAlive: true });
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          agent.destroy();
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }),
      );
      yield* Effect.promise(
        () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
      );
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("fake server has no port");
      const httpCall = makeHttpCall(`127.0.0.1:${address.port}`, agent, observers);
      const call: Call = (method, path, options) =>
        httpCall(method, path, {
          ...options,
          onReadinessStep: (step) => {
            options?.onReadinessStep?.(step);
            if (stalled === "body" && step === "response headers")
              Deferred.doneUnsafe(entered, Effect.void);
          },
        });
      const fiber = yield* Effect.forkScoped(untilHealth(call, "active"));
      yield* Deferred.await(entered);
      yield* TestClock.adjust("10 seconds");
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = String(exit.cause);
        assert.include(error, `stalled step: ${stalled};`);
        assert.match(error, /request written @ \d+ms/);
        if (stalled === "body") assert.match(error, /response headers @ \d+ms/);
        else {
          assert.match(error, /handler @ \d+ms/);
          assert.match(error, /SQL @ \d+ms/);
        }
        if (stalled === "SQL/handler") assert.match(error, /SQL complete @ \d+ms/);
      }
    }),
);

it.effect(
  "HQ setup readiness diagnostics produce no output on success and preserve the fifty-millisecond retry schedule",
  () =>
    Effect.gen(function* () {
      const first = yield* Deferred.make<void>();
      let requests = 0;
      const server = NodeHttp.createServer((_request, response) => {
        requests++;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(requests === 1 ? '{"state":"standby"}' : '{"state":"active"}');
      });
      const agent = new NodeHttp.Agent({ keepAlive: true });
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          agent.destroy();
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }),
      );
      yield* Effect.promise(
        () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
      );
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("fake server has no port");
      const httpCall = makeHttpCall(`127.0.0.1:${address.port}`, agent);
      const call: Call = (method, path, options) =>
        httpCall(method, path, {
          ...options,
          onReadinessStep: (step) => {
            options?.onReadinessStep?.(step);
            if (step === "body" && requests === 1) Deferred.doneUnsafe(first, Effect.void);
          },
        });
      const output = [
        vi.spyOn(console, "log"),
        vi.spyOn(console, "error"),
        vi.spyOn(console, "warn"),
      ];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => output.forEach((spy) => spy.mockRestore())),
      );
      const fiber = yield* Effect.forkScoped(untilHealth(call, "active"));
      yield* Deferred.await(first);
      yield* TestClock.adjust("49 millis");
      assert.equal(requests, 1);
      yield* TestClock.adjust("1 millis");
      const response = yield* Fiber.join(fiber);
      assert.deepEqual(response.body, { state: "active" });
      assert.equal(requests, 2);
      for (const spy of output) assert.equal(spy.mock.calls.length, 0);
    }),
);
