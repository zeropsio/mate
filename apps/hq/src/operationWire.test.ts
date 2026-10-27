import { assert, describe, it } from "@effect/vitest";
import * as TestClock from "effect/testing/TestClock";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { makeOperationWire } from "./operationWire.ts";

class TestSocket extends EventTarget {
  closed = false;
  send(_data: string) {
    this.dispatchEvent(new MessageEvent("message", { data: '{"type":"pong"}' }));
  }
  close() {
    this.closed = true;
  }
}
const credential = Redacted.make("test-org-secret");
describe("HQ operation receiver transport", () => {
  it.live(
    "uses the org credential, preserves frames queued during registration, and closes with its scope",
    () =>
      Effect.gen(function* () {
        const calls: Array<string> = [];
        let socket: TestSocket | undefined;
        const wire = makeOperationWire({
          baseUrl: "https://api.test/api/rest/public",
          credential,
          fetch: async (url, init) => {
            calls.push(String(url));
            assert.strictEqual(
              new Headers(init?.headers).get("Authorization"),
              "Bearer test-org-secret",
            );
            return new Response('{"webSocketToken":"ticket"}');
          },
          makeSocket: (url) => {
            assert.match(url, /^wss:\/\/api.test\/api\/rest\/public\/web-socket\/[^/]+\/ticket$/u);
            socket = new TestSocket();
            queueMicrotask(() =>
              socket?.dispatchEvent(
                new MessageEvent("message", { data: '{"type":"SocketSuccess"}' }),
              ),
            );
            return socket as unknown as WebSocket;
          },
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const link = yield* wire.open;
            socket?.dispatchEvent(new MessageEvent("message", { data: '{"data":{"update":[]}}' }));
            const frame = yield* Stream.runHead(link.frames);
            assert.strictEqual(frame._tag, "Some");
          }),
        );
        assert.isTrue(socket?.closed);
        assert.deepStrictEqual(calls, ["https://api.test/api/rest/public/web-socket/login"]);
      }),
  );
  it.live("classifies revocation once without disclosing credentials", () =>
    Effect.gen(function* () {
      let calls = 0;
      const wire = makeOperationWire({
        baseUrl: "https://api.test",
        credential,
        fetch: async () => {
          calls++;
          return new Response("test-org-secret", { status: 401 });
        },
      });
      const error = yield* wire.open.pipe(Effect.flip, Effect.scoped);
      assert.strictEqual(error._tag, "ZeropsRefused");
      assert.strictEqual(calls, 1);
      assert.notInclude(String(error), "test-org-secret");
    }),
  );
  it.effect("detects a revoked credential on a quiet receiver even while pongs continue", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let revoked = false;
        const calls: string[] = [];
        const wire = makeOperationWire({
          baseUrl: "https://api.test",
          credential,
          fetch: async (url) => {
            calls.push(String(url));
            return revoked
              ? new Response("forbidden", { status: 403 })
              : new Response('{"webSocketToken":"ticket"}');
          },
          makeSocket: () => {
            const socket = new TestSocket();
            queueMicrotask(() =>
              socket.dispatchEvent(
                new MessageEvent("message", { data: '{"type":"SocketSuccess"}' }),
              ),
            );
            return socket as unknown as WebSocket;
          },
        });
        const link = yield* wire.open;
        const ended = yield* Stream.runHead(link.frames).pipe(Effect.flip, Effect.forkChild);
        revoked = true;
        yield* TestClock.adjust(61_000);
        assert.isDefined(ended.pollUnsafe(), "a credential refusal must end the quiet follow");
        const error = yield* Fiber.join(ended);
        assert.strictEqual(error._tag, "ZeropsRefused");
        assert.include(calls, "https://api.test/user/info");
      }),
    ),
  );
  it.live("retains the owner's Retry-After on a transient registration failure", () =>
    Effect.gen(function* () {
      const wire = makeOperationWire({
        baseUrl: "https://api.test",
        credential,
        fetch: async () => new Response("busy", { status: 429, headers: { "Retry-After": "3" } }),
      });
      const error = yield* wire.open.pipe(Effect.flip, Effect.scoped);
      assert.strictEqual(error._tag, "ZeropsUnavailable");
      assert.strictEqual("retryAfterMs" in error ? error.retryAfterMs : undefined, 3000);
    }),
  );
});
