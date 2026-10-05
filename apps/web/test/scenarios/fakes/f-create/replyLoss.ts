// @effect-diagnostics nodeBuiltinImport:off -- dropping a localhost HTTP response after upstream acceptance.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import { WebSocketServer } from "ws";
import type { ZeropsFake } from "../zerops.ts";
import type { CreationFake } from "./creation.ts";

/** The upstream receives the write; only its reply to this browser is lost. */
export async function replyLossProxy(platform: ZeropsFake, creation: CreationFake) {
  const sockets = new Set<NodeNet.Socket>();
  const websocket = new WebSocketServer({ noServer: true });
  const server = NodeHttp.createServer((incoming, outgoing) => {
    const upstream = NodeHttp.request(
      new URL(incoming.url ?? "/", platform.origin),
      {
        method: incoming.method,
        headers: incoming.headers,
      },
      (reply) => {
        if (
          creation.outcome === "lost" &&
          incoming.method === "POST" &&
          /\/client\/[^/]+\/project$/u.test(incoming.url ?? "")
        ) {
          reply.resume();
          outgoing.destroy();
          return;
        }
        outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(outgoing);
      },
    );
    upstream.on("error", () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    websocket.handleUpgrade(request, socket, head, (client) =>
      platform.socket(client, new URL(request.url ?? "/", "http://localhost")),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`,
    async close() {
      for (const client of websocket.clients) client.terminate();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      websocket.close();
    },
  };
}
