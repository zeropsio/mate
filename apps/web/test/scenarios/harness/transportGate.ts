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
  const sockets = new Set<NodeNet.Socket>();
  const peers = new Set<WebSocket>();
  const requests: string[] = [];

  const server = NodeHttp.createServer((req, res) => {
    const upstream = NodeHttp.request(
      new URL(strip(req.url ?? "/"), target()),
      { method: req.method, headers: req.headers },
      (answer) => {
        requests.push(`${req.method} ${req.url} ${answer.statusCode}`);
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
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
        peers.add(client).add(upstream);
        client.on("message", (data, isBinary) => {
          for (const envelope of envelopes(data, isBinary))
            if (envelope._tag === "Request" && typeof envelope.tag === "string") {
              requests.push(`RPC ${envelope.tag}`);
              unanswered.set(String(envelope.id), envelope.tag);
              for (const hold of holds)
                if (hold.open && hold.match(envelope.tag)) {
                  hold.ids.add(String(envelope.id));
                  hold.first();
                }
            }
          upstream.send(data, { binary: isBinary });
        });
        upstream.on("message", (data, isBinary) => {
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
          const answered = answers.map((envelope) => String(envelope.requestId));
          const hold = [...holds].find((hold) => answered.some((id) => hold.ids.has(id)));
          if (hold?.open) hold.queue.push(deliver);
          else deliver();
        });
        const close = () => {
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
    close: async () => {
      for (const peer of peers) peer.terminate();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      wss.close();
    },
  };
}
