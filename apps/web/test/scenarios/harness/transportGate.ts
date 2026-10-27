// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- a loopback byte proxy reading request envelopes.
/**
 * The container's reverse proxy for a real scenario Mate: strips the published `/mate` prefix, as
 * zcp's does, and forwards HTTP bodies and WebSocket frames byte for byte. A case can hold the
 * Mate's answers to one kind of request — chosen by the client's request envelope (`_tag:
 * "Request"`, its `tag`) — and release them later: delayed loading is a held real frame, never a
 * fake reply. A case can also wait for the Mate's answer to one: its receipt.
 */
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";

interface Envelope {
  readonly _tag?: unknown;
  readonly id?: unknown;
  readonly requestId?: unknown;
  readonly tag?: unknown;
}

export interface HeldReads {
  /** Settles once the first matching request's answers are held. */
  readonly held: Promise<void>;
  /** Delivers every held answer in order and stops holding. */
  readonly release: () => void;
}

export interface TransportFrame {
  readonly bytes: Uint8Array;
  readonly isBinary: boolean;
  readonly connection: number;
}
export interface HeldFrames extends HeldReads {
  /** Copies of the captured bytes; inspecting them cannot change replay. */
  readonly frames: ReadonlyArray<TransportFrame>;
  /** The next captured frame after this call. */
  readonly next: () => Promise<void>;
  /** Delivers a held frame to its original connection, once. */
  readonly deliver: (index: number) => void;
  /** Replays the exact captured bytes to a live connection (latest by default). */
  readonly replay: (index: number, connection?: number) => void;
}

const bytesOf = (data: RawData) =>
  Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(data))
      : Buffer.from(data);

const envelopes = (data: RawData, isBinary: boolean): Envelope[] => {
  if (isBinary) return [];
  try {
    const parsed = JSON.parse(String(data)) as unknown;
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (entry): entry is Envelope => typeof entry === "object" && entry !== null,
    );
  } catch {
    return [];
  }
};

export async function transportGate(target: () => string, prefix = "/mate") {
  const strip = (path: string) =>
    path === prefix ? "/" : path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
  const holds = new Set<{
    match: (tag: string) => boolean;
    ids: Set<string>;
    queue: (() => void)[];
    open: boolean;
    first: () => void;
  }>();
  // Requests the Mate has not answered yet, by id, and who waits for an answer to one kind.
  const unanswered = new Map<string, string>();
  const waiters = new Set<{ match: (tag: string) => boolean; answer: (exit: unknown) => void }>();
  let disconnected = false;
  let connectionCount = 0;
  const connections = new Map<number, WebSocket>();
  const httpHolds = new Set<{
    match: (path: string) => boolean;
    queue: (() => void)[];
    first: () => void;
  }>();
  const frameHolds = new Set<{
    capture: (frame: TransportFrame, client: WebSocket) => boolean;
  }>();
  const sockets = new Set<NodeNet.Socket>();
  const peers = new Set<WebSocket>();
  const requests: string[] = [];

  const server = NodeHttp.createServer((req, res) => {
    if (disconnected) {
      res.writeHead(503);
      res.end();
      return;
    }
    const upstream = NodeHttp.request(
      new URL(strip(req.url ?? "/"), target()),
      { method: req.method, headers: req.headers },
      (answer) => {
        requests.push(`${req.method} ${req.url} ${answer.statusCode}`);
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        const hold = [...httpHolds].find((hold) => hold.match(req.url ?? "/"));
        if (hold) {
          answer.pause();
          hold.queue.push(() => {
            if (!res.destroyed) answer.pipe(res);
          });
          hold.first();
        } else answer.pipe(res);
        res.once("close", () => answer.destroy());
      },
    );
    upstream.on("error", () => res.destroy());
    res.once("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (disconnected) {
      socket.destroy();
      return;
    }
    const url = new URL(strip(req.url ?? "/"), target());
    url.protocol = "ws:";
    requests.push(`WS ${req.url}`);
    const { host: _host, ...headers } = req.headers;
    const upstream = new WebSocket(url, {
      headers: Object.fromEntries(
        Object.entries(headers).filter(([name]) => !name.startsWith("sec-websocket")),
      ) as Record<string, string>,
      perMessageDeflate: false,
    });
    upstream.once("error", () => socket.destroy());
    upstream.once("open", () =>
      wss.handleUpgrade(req, socket, head, (client) => {
        const connection = ++connectionCount;
        connections.set(connection, client);
        peers.add(client).add(upstream);
        client.on("message", (data, isBinary) => {
          for (const envelope of envelopes(data, isBinary))
            if (envelope._tag === "Request" && typeof envelope.tag === "string") {
              requests.push(`RPC ${envelope.tag}`);
              unanswered.set(String(envelope.id), envelope.tag);
              for (const hold of holds)
                if (hold.open && hold.match(envelope.tag)) {
                  hold.ids.add(String(envelope.id));
                }
            }
          upstream.send(data, { binary: isBinary });
        });
        upstream.on("message", (data, isBinary) => {
          const frame = { bytes: bytesOf(data), isBinary, connection };
          const deliver = () =>
            client.readyState === WebSocket.OPEN && client.send(data, { binary: isBinary });
          const answers = envelopes(data, isBinary);
          for (const envelope of answers) {
            if (envelope._tag !== "Exit") continue;
            if (JSON.stringify(envelope).includes('"Failure"'))
              requests.push(`RPC failed ${JSON.stringify(envelope).slice(0, 400)}`);
            const tag = unanswered.get(String(envelope.requestId));
            if (tag === undefined) continue;
            unanswered.delete(String(envelope.requestId));
            for (const waiter of waiters)
              if (waiter.match(tag)) {
                waiters.delete(waiter);
                waiter.answer(envelope);
              }
          }
          if ([...frameHolds].some((hold) => hold.capture(frame, client))) return;
          const answered = answers.map((envelope) => String(envelope.requestId));
          const hold = [...holds].find((hold) => answered.some((id) => hold.ids.has(id)));
          if (hold?.open) {
            hold.queue.push(deliver);
            hold.first();
          } else deliver();
        });
        const close = () => {
          connections.delete(connection);
          peers.delete(client);
          peers.delete(upstream);
          client.close();
          upstream.close();
        };
        client.on("close", close);
        upstream.on("close", close);
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    /** What the browser asked the Mate, with each answer's status, for failure messages. */
    requests: requests as ReadonlyArray<string>,
    get openedConnections() {
      return connectionCount;
    },
    origin: `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`,
    /** Holds the Mate's answers to requests whose RPC tag matches, until released. */
    hold: (match: (tag: string) => boolean): HeldReads => {
      const first = Promise.withResolvers<void>();
      const hold = {
        match,
        ids: new Set<string>(),
        queue: [] as (() => void)[],
        open: true,
        first: first.resolve,
      };
      holds.add(hold);
      return {
        held: first.promise,
        release: () => {
          hold.open = false;
          for (const deliver of hold.queue.splice(0)) deliver();
          holds.delete(hold);
        },
      };
    },
    /** Settles with the Mate's exit for the next request whose RPC tag matches, once it answers. */
    answered: (match: (tag: string) => boolean): Promise<unknown> =>
      new Promise((answer) => waiters.add({ match, answer })),
    /** Holds complete HTTP responses at the byte boundary, including asset bodies. */
    holdHttp: (match: (path: string) => boolean): HeldReads => {
      const first = Promise.withResolvers<void>();
      const hold = { match, queue: [] as (() => void)[], first: first.resolve };
      httpHolds.add(hold);
      return {
        held: first.promise,
        release: () => {
          httpHolds.delete(hold);
          for (const deliver of hold.queue.splice(0)) deliver();
        },
      };
    },
    /** Capture whole source frames. No frame is parsed, split, retagged or synthesized. */
    holdFrames: (match: (frame: TransportFrame) => boolean): HeldFrames => {
      const first = Promise.withResolvers<void>();
      const captured: Array<{ frame: TransportFrame; client: WebSocket }> = [];
      const pending = new Set<number>();
      let waiters: Array<() => void> = [];
      const send = (index: number, client: WebSocket | undefined) => {
        const entry = captured[index];
        if (!entry) throw new RangeError("No captured frame at " + index);
        if (client?.readyState === WebSocket.OPEN)
          client.send(entry.frame.bytes, { binary: entry.frame.isBinary });
      };
      const deliver = (index: number) => {
        if (pending.delete(index)) send(index, captured[index]?.client);
      };
      const hold = {
        capture: (frame: TransportFrame, client: WebSocket) => {
          if (!match(frame)) return false;
          pending.add(captured.length);
          captured.push({ frame, client });
          first.resolve();
          const ready = waiters;
          waiters = [];
          for (const resolve of ready) resolve();
          return true;
        },
      };
      frameHolds.add(hold);
      return {
        held: first.promise,
        get frames() {
          return captured.map(({ frame }) => ({ ...frame, bytes: Buffer.from(frame.bytes) }));
        },
        next: () => new Promise<void>((resolve) => waiters.push(resolve)),
        deliver,
        replay: (index, connection) =>
          send(
            index,
            connection === undefined
              ? [...connections.values()].at(-1)
              : connections.get(connection),
          ),
        release: () => {
          frameHolds.delete(hold);
          for (const index of pending) deliver(index);
        },
      };
    },
    /** Keeps the listening gate, but refuses new transport and drops current WS connections. */
    disconnect: () => {
      disconnected = true;
      for (const peer of peers) peer.terminate();
    },
    reconnect: () => {
      disconnected = false;
    },
    close: async () => {
      for (const peer of peers) peer.terminate();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      wss.close();
    },
  };
}
