import * as NodeEvents from "node:events";
import { WebSocket, type RawData } from "ws";
import { deadline, serve } from "../harness/http.ts";

const bytesOf = (data: RawData) =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

/** A controllable, endpoint-agnostic network in front of REAL Core. */
export async function hqConnection(coreOrigin: string) {
  let down = false;
  let mapFrame = (frame: string) => frame;
  let received = false;
  const links = new Map<WebSocket, WebSocket>();
  const framedSockets = new WeakSet<WebSocket>();
  const events = new NodeEvents.EventEmitter();
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
        counters.wsDownFrames++;
        counters.wsDownBytes += frame.length;
        if (client.readyState === WebSocket.OPEN) {
          client.send(frame, { binary: isBinary });
          framedSockets.add(client);
          events.emit("socket-frame");
        }
        ready();
      });
      upstream.on("close", (code) => {
        if (client.readyState === WebSocket.OPEN)
          client.close(code === 1006 ? 1011 : code === 1005 ? 1000 : code);
        links.delete(client);
      });
      upstream.on("error", () => client.close(1011));
      client.on("close", () => {
        upstream.close();
        links.delete(client);
      });
    },
  );
  return {
    ...server,
    links,
    counters,
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
