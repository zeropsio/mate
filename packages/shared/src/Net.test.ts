import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import * as NetService from "./Net.ts";

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    createConnection: vi.fn(actual.createConnection),
    createServer: vi.fn(actual.createServer),
  };
});

const closeServer = (server: NodeNet.Server) =>
  Effect.sync(() => {
    try {
      server.close();
    } catch {
      // Ignore cleanup failures in tests.
    }
  });

const getPort = (server: NodeNet.Server): number => {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

const openServer = (host?: string): Effect.Effect<NodeNet.Server, NetService.NetError> =>
  Effect.callback<NodeNet.Server, NetService.NetError>((resume) => {
    const server = NodeNet.createServer();
    let settled = false;

    const settle = (effect: Effect.Effect<NodeNet.Server, NetService.NetError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    server.once("error", (cause) => {
      settle(
        Effect.fail(new NetService.NetError({ message: "Failed to open test server", cause })),
      );
    });

    if (host) {
      server.listen(0, host, () => settle(Effect.succeed(server)));
    } else {
      server.listen(0, () => settle(Effect.succeed(server)));
    }

    return closeServer(server);
  });

it.layer(NetService.layer)("NetService", (it) => {
  describe("Net helpers", () => {
    it.effect("reserveLoopbackPort returns a positive loopback port", () =>
      Effect.gen(function* () {
        const net = yield* NetService.NetService;
        const port = yield* net.reserveLoopbackPort();

        assert.ok(port > 0);
      }),
    );

    it.effect("isPortAvailableOnLoopback reports false for an occupied port", () =>
      Effect.acquireUseRelease(
        openServer("127.0.0.1"),
        (server) =>
          Effect.gen(function* () {
            const net = yield* NetService.NetService;
            const port = getPort(server);

            const available = yield* net.isPortAvailableOnLoopback(port);
            assert.equal(available, false);
          }),
        closeServer,
      ),
    );

    it.effect("findAvailablePort returns preferred when it is free", () =>
      Effect.scoped(
        Effect.gen(function* () {
          // Drive the socket boundary: a released ephemeral port can be claimed by another process.
          const createConnection = vi.mocked(NodeNet.createConnection);
          const createServer = vi.mocked(NodeNet.createServer);
          createConnection.mockImplementation(() => {
            const socket = new NodeEvents.EventEmitter();
            Object.assign(socket, {
              unref: () => socket,
              setTimeout: () => socket,
              destroy: () => socket,
            });
            queueMicrotask(() => socket.emit("error", new Error("connection refused")));
            return socket as unknown as NodeNet.Socket;
          });
          createServer.mockImplementation(() => {
            const server = new NodeEvents.EventEmitter();
            Object.assign(server, {
              unref: () => server,
              listen: () => {
                queueMicrotask(() => server.emit("listening"));
                return server;
              },
              close: (callback?: () => void) => {
                callback?.();
                return server;
              },
            });
            return server as unknown as NodeNet.Server;
          });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              createConnection.mockReset();
              createServer.mockReset();
            }),
          );

          const net = yield* NetService.NetService;
          const preferred = 12_345;
          const resolved = yield* net.findAvailablePort(preferred);
          assert.equal(resolved, preferred);
        }),
      ),
    );

    it.effect("findAvailablePort falls back when a wildcard listener occupies IPv4", () =>
      Effect.acquireUseRelease(
        openServer("0.0.0.0"),
        (server) =>
          Effect.gen(function* () {
            const net = yield* NetService.NetService;
            const preferred = getPort(server);

            const resolved = yield* net.findAvailablePort(preferred);
            assert.ok(resolved > 0);
            assert.notEqual(resolved, preferred);
          }),
        closeServer,
      ),
    );
  });
});
