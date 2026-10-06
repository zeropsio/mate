// @effect-diagnostics nodeBuiltinImport:off -- real HTTP sockets are the black-box test boundary.
import { remainingTestBudget, waitBudget } from "./waits.ts";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

export interface WireRequest {
  method: string;
  url: URL;
  headers: NodeHttp.IncomingHttpHeaders;
  body: Record<string, unknown>;
  rawBody?: Buffer;
}
export interface WireResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  html?: string;
  bytes?: Buffer;
}
export type HttpHandler = (
  request: WireRequest,
) => Promise<WireResponse | undefined> | WireResponse | undefined;

export async function serve(handler: HttpHandler, upgrade?: (socket: WebSocket, url: URL) => void) {
  const sockets = new Set<NodeNet.Socket>();
  const ws = new WebSocketServer({ noServer: true });
  const server = NodeHttp.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks);
      const raw = rawBody.toString();
      const body = raw
        ? req.headers["content-type"]?.includes("application/x-www-form-urlencoded")
          ? Object.fromEntries(new URLSearchParams(raw))
          : req.headers["content-type"]?.includes("application/json")
            ? (JSON.parse(raw) as Record<string, unknown>)
            : {}
        : {};
      const result = await handler({
        method: req.method ?? "GET",
        url: new URL(req.url ?? "/", "http://localhost"),
        headers: req.headers,
        body,
        rawBody,
      });
      res.writeHead(result?.status ?? (result ? 200 : 404), {
        "content-type": result?.html ? "text/html" : "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        ...result?.headers,
      });
      res.end(
        result?.bytes ??
          result?.html ??
          JSON.stringify(result?.body ?? { error: "unhandled fake endpoint", path: req.url }),
      );
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    if (!upgrade) {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head, (client) =>
      upgrade(client, new URL(req.url ?? "/", "http://localhost")),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`,
    close: async () => {
      for (const client of ws.clients) client.terminate();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      ws.close();
    },
  };
}

/** A deadline, never a delay used to guess when work finished. */
export async function deadline<A>(
  promise: Promise<A>,
  what: string,
  timeout = waitBudget(),
): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${what}`)),
          Math.min(timeout, remainingTestBudget()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
