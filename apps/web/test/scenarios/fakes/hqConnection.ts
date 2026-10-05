import * as NodeEvents from "node:events";
import { WebSocket } from "ws";
import { deadline, serve } from "../harness/http.ts";

/** A controllable network in front of REAL Core. Every body and frame comes from Core. */
export async function hqConnection(coreOrigin: string) {
  let down = false;
  const links = new Map<WebSocket, WebSocket>();
  const events = new NodeEvents.EventEmitter();
  let structures = 0;
  const server = await serve(
    async (request) => {
      if (down) return { status: 503, body: { error: "scenario_network_down" } };
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
          : { body: JSON.stringify(request.body) }),
        redirect: "manual",
      });
      return {
        status: response.status,
        bytes: Buffer.from(await response.arrayBuffer()),
        headers: Object.fromEntries(response.headers),
      };
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
      const queued: Buffer[] = [];
      client.on("message", (data) =>
        upstream.readyState === WebSocket.OPEN
          ? upstream.send(data.toString())
          : queued.push(Buffer.from(data.toString())),
      );
      upstream.on("open", () => {
        for (const frame of queued) upstream.send(frame);
      });
      upstream.on("message", (data) => {
        if (client.readyState === WebSocket.OPEN) client.send(data.toString());
        if (url.pathname === "/api/structure/ws") {
          structures++;
          events.emit("structure");
        }
      });
      upstream.on("close", (code) => {
        if (client.readyState === WebSocket.OPEN) client.close(code === 1006 ? 1011 : code);
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
    async ready() {
      if (structures) return;
      await deadline(
        new Promise<void>((resolve) => events.once("structure", resolve)),
        "HQ structure stream",
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
