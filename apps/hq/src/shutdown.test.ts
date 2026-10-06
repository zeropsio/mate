// @effect-diagnostics nodeBuiltinImport:off -- exercise a peer leaving during a real Core upgrade.
import * as NodeNet from "node:net";
import * as NodeHttp from "node:http";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { overviewOf } from "../test/harness/overviews.ts";
import {
  enrollMate,
  setUpMate,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

describe("Core shutdown after a renderer leaves", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const endpoint of ["/api/structure/ws", "/api/mate/link"]) {
      it.effect(
        `finishes after a renderer closes and ${endpoint} loses its peer before upgrading`,
        () =>
          Effect.gen(function* () {
            const server = NodeHttp.createServer();
            const core = yield* startCore(true, { httpServer: server });
            yield* untilHealth(core.call, "active");
            const owner = yield* setUpMate(core.call, "P_MATE");
            const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
            const minted = yield* core.call("POST", "/api/mate/link-ticket", {
              headers: { authorization: `Mate ${credential}` },
            });
            const link = yield* core.socket(
              `/api/mate/link?ticket=${(minted.body as { ticket: string }).ticket}`,
            );
            yield* link.take("state");
            yield* link.send({ type: "overview", full: true, overview: overviewOf() });
            const client = yield* core.socket(
              `/api/structure/ws?ticket=${yield* ticketFor(core.call, owner)}`,
            );
            yield* client.send({ type: "subscribe", scopes: [{ scope: { kind: "navigation" } }] });
            yield* client.take("scope-ready");
            yield* client.close;
            assert.strictEqual(yield* client.closedWith, 1005);
            const ticket =
              endpoint === "/api/structure/ws"
                ? yield* ticketFor(core.call, owner)
                : (
                    (yield* core.call("POST", "/api/mate/link-ticket", {
                      headers: { authorization: `Mate ${credential}` },
                    })).body as { ticket: string }
                  ).ticket;
            // Wait for Core's receipt of the FIN, not an elapsed delay or a client-side flush alone.
            const peerEnded = new Promise<void>((resolve) =>
              server.once("upgrade", (_request, socket) => socket.once("end", resolve)),
            );
            const port = Number(new URL(core.origin).port);
            yield* Effect.promise(
              () =>
                new Promise<void>((resolve, reject) => {
                  const socket = NodeNet.createConnection({ host: "127.0.0.1", port });
                  socket.once("error", reject);
                  socket.once("close", () => resolve());
                  socket.on("data", () => {});
                  socket.once("connect", () =>
                    socket.end(
                      `GET ${endpoint}?ticket=${ticket} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: YWJjZGVmZ2hpamtsbW5vcA==\r\n\r\n`,
                      () => socket.destroy(),
                    ),
                  );
                }),
            );
            yield* Effect.promise(() => peerEnded).pipe(Effect.timeout(Duration.seconds(2)));
            // The test must fail within the bound even if a regression makes a finalizer uninterruptible.
            const stopping = yield* Effect.forkDetach(core.stop);
            yield* Fiber.join(stopping).pipe(Effect.timeout(Duration.seconds(2)));
          }),
      );
    }
  });
});
