import * as NodeEvents from "node:events";
import { WebSocket, type RawData } from "ws";
import { deadline, serve } from "../harness/http.ts";

const bytesOf = (data: RawData) =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

export interface MateRefusal {
  readonly kind: "link" | "ticket";
  readonly reason: string;
}

/** A controllable, endpoint-agnostic network in front of REAL Core. */
export async function hqConnection(coreOrigin: string, host: "127.0.0.1" | "::1" = "127.0.0.1") {
  let down = false;
  let mapFrame = (frame: string) => frame;
  let received = false;
  const links = new Map<WebSocket, WebSocket>();
  const framedSockets = new WeakSet<WebSocket>();
  const events = new NodeEvents.EventEmitter();
  const mateRefusals: MateRefusal[] = [];
  let linkRefusal: MateRefusal | undefined;
  const refused = (receipt: MateRefusal) => {
    if (receipt.kind === "link") linkRefusal = receipt;
    mateRefusals.push(receipt);
    events.emit("mate-refused", receipt);
  };
  const counters = {
    httpRequests: 0,
    httpUpBytes: 0,
    httpDownBytes: 0,
    wsOpens: 0,
    wsUpFrames: 0,
    wsDownFrames: 0,
    wsUpBytes: 0,
    wsDownBytes: 0,
  };
  /** Requests that crossed to Core, by `METHOD /path`. */
  const requests = new Map<string, number>();
  const ready = () => {
    received = true;
    events.emit("ready");
  };
  const server = await serve(
    async (request) => {
      counters.httpRequests++;
      counters.httpUpBytes += request.rawBody?.length ?? 0;
      if (down) {
        const body = { error: "scenario_network_down" };
        counters.httpDownBytes += Buffer.byteLength(JSON.stringify(body));
        return { status: 503, body };
      }
      const route = `${request.method} ${request.url.pathname}`;
      requests.set(route, (requests.get(route) ?? 0) + 1);
      const response = await fetch(new URL(request.url.pathname + request.url.search, coreOrigin), {
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).flatMap(([key, value]) =>
            value === undefined || key === "host" || key === "content-length"
              ? []
              : [[key, Array.isArray(value) ? value.join(", ") : value]],
          ),
        ),
        ...(["GET", "HEAD", "OPTIONS"].includes(request.method)
          ? {}
          : { body: new Uint8Array(request.rawBody ?? []).buffer }),
        redirect: "manual",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      counters.httpDownBytes += bytes.length;
      ready();
      return { status: response.status, bytes, headers: Object.fromEntries(response.headers) };
    },
    (client, url) => {
      if (down) {
        client.close(1011, "scenario outage");
        return;
      }
      const upstream = new WebSocket(
        new URL(url.pathname + url.search, coreOrigin.replace(/^http/u, "ws")),
      );
      links.set(client, upstream);
      const queued: { bytes: Buffer; binary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        const frame = bytesOf(data);
        if (url.pathname === "/api/mate/link" && !isBinary) {
          try {
            const message: unknown = JSON.parse(frame.toString());
            if (
              typeof message === "object" &&
              message !== null &&
              "type" in message &&
              message.type === "ticket_refused" &&
              "reason" in message &&
              typeof message.reason === "string"
            )
              refused({ kind: "ticket", reason: message.reason });
          } catch {
            // The proxy forwards bytes unchanged, including frames it does not understand.
          }
        }
        counters.wsUpFrames++;
        counters.wsUpBytes += frame.length;
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame, { binary: isBinary });
        else queued.push({ bytes: frame, binary: isBinary });
      });
      upstream.on("open", () => {
        counters.wsOpens++;
        for (const frame of queued) upstream.send(frame.bytes, { binary: frame.binary });
      });
      upstream.on("message", (data, isBinary) => {
        const frame = isBinary ? bytesOf(data) : Buffer.from(mapFrame(bytesOf(data).toString()));
        if (url.pathname === "/api/mate/link" && !isBinary) {
          try {
            const message: unknown = JSON.parse(frame.toString());
            if (
              typeof message === "object" &&
              message !== null &&
              "type" in message &&
              message.type === "state"
            )
              linkRefusal = undefined;
          } catch {
            // This proxy does not interpret other frames.
          }
        }
        counters.wsDownFrames++;
        counters.wsDownBytes += frame.length;
        if (client.readyState === WebSocket.OPEN) {
          client.send(frame, { binary: isBinary });
          framedSockets.add(client);
          events.emit("socket-frame");
        }
        ready();
      });
      upstream.on("close", (code, reason) => {
        if (
          url.pathname === "/api/mate/link" &&
          (code === 4401 ||
            code === 4403 ||
            (code === 1011 && reason.toString() === "the key could not be resolved"))
        )
          refused({ kind: "link", reason: `${code} ${reason.toString()}`.trim() });
        if (client.readyState === WebSocket.OPEN)
          client.close(code === 1006 ? 1011 : code === 1005 ? 1000 : code, reason);
        links.delete(client);
      });
      upstream.on("error", () => client.close(1011));
      client.on("close", () => {
        upstream.close();
        links.delete(client);
      });
    },
    host,
  );
  return {
    ...server,
    links,
    /** Begin a receipt wait before the action whose refusal it must observe. */
    mateRefusalCursor: () => mateRefusals.length,
    watchMateRefusal(since: number) {
      let listener: ((receipt: MateRefusal) => void) | undefined;
      const promise = new Promise<MateRefusal>((resolve) => {
        const prior = linkRefusal ?? mateRefusals[since];
        if (prior !== undefined) resolve(prior);
        else {
          listener = (receipt) => resolve(receipt);
          events.on("mate-refused", listener);
        }
      });
      return {
        promise,
        cancel: () => {
          if (listener !== undefined) events.off("mate-refused", listener);
        },
      };
    },
    counters,
    requests,
    /** Transforms downstream text frames, for source protocol variants in area drivers. */
    mapFrames: (transform: (frame: string) => string) => {
      mapFrame = transform;
    },
    async ready() {
      if (received) return;
      await deadline(
        new Promise<void>((resolve) => events.once("ready", resolve)),
        "HQ transport response or first frame",
      );
    },
    async socketReady() {
      if (
        [...links.keys()].some(
          (socket) => socket.readyState === WebSocket.OPEN && framedSockets.has(socket),
        )
      )
        return;
      await deadline(
        new Promise<void>((resolve) => events.once("socket-frame", resolve)),
        "HQ socket's first forwarded frame",
      );
    },
    drops() {
      down = true;
      for (const [client, upstream] of links) {
        client.close(1011, "scenario outage");
        upstream.close();
      }
    },
    returns() {
      down = false;
    },
  };
}

/** Race an open against the Mate's own refusal, retaining the reason. */
export async function untilMateOpens<A>(
  work: Promise<A>,
  link: Awaited<ReturnType<typeof hqConnection>>,
  name: string,
  cursor: number,
): Promise<A> {
  const watch = link.watchMateRefusal(cursor);
  try {
    return await Promise.race([
      work,
      watch.promise.then((receipt) => {
        throw new Error(`Mate ${name} ${receipt.kind} refused: ${receipt.reason}`);
      }),
    ]);
  } finally {
    watch.cancel();
  }
}
