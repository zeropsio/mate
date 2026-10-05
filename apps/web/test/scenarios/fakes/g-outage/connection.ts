// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- loopback network impairment of real Core, never a replacement HQ.
import { WebSocket } from "ws";
import { serve, deadline } from "../../harness/http.ts";

type Frame = Record<string, unknown>;

/** Forwards real HQ, with explicit loss/corruption at the network boundary. */
export async function outageConnection(upstreamOrigin: string) {
  const structureClients = new Set<WebSocket>();
  const lastSnapshots = new Map<WebSocket, Frame>();
  const pendingPongs: (() => void)[] = [];
  let factsSilent = false;
  const server = await serve(
    async (request) => {
      const response = await fetch(
        new URL(request.url.pathname + request.url.search, upstreamOrigin),
        {
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
        },
      );
      return {
        status: response.status,
        bytes: Buffer.from(await response.arrayBuffer()),
        headers: Object.fromEntries(response.headers),
      };
    },
    (client, url) => {
      const isStructure = url.pathname === "/api/structure/ws";
      if (isStructure) structureClients.add(client);
      const upstream = new WebSocket(
        new URL(url.pathname + url.search, upstreamOrigin.replace(/^http/u, "ws")),
      );
      const queued: string[] = [];
      client.on("message", (raw) => {
        const frame = String(raw);
        if (isStructure && JSON.parse(frame).type === "pong") pendingPongs.shift()?.();
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
        else queued.push(frame);
      });
      upstream.on("open", () => {
        for (const frame of queued) upstream.send(frame);
      });
      upstream.on("message", (raw) => {
        const frame = String(raw);
        const parsed = JSON.parse(frame) as Frame;
        if (isStructure && parsed.type === "snapshot") lastSnapshots.set(client, parsed);
        if (isStructure && factsSilent && parsed.type !== "ping") return;
        if (client.readyState === WebSocket.OPEN) client.send(frame);
      });
      upstream.on("close", (code) => {
        if (client.readyState === WebSocket.OPEN)
          client.close(code === 1006 ? 1011 : code === 1005 ? 1000 : code);
      });
      upstream.on("error", () => client.close(1011));
      client.on("close", () => {
        structureClients.delete(client);
        lastSnapshots.delete(client);
        upstream.close();
      });
    },
  );
  return {
    ...server,
    silenceFacts() {
      factsSilent = true;
    },
    corruptMate(projectId: string) {
      for (const [client, snapshot] of lastSnapshots) {
        const mates = snapshot.mates as Record<string, unknown>;
        if (!mates?.[projectId]) throw new Error(`Real HQ snapshot has no Mate ${projectId}`);
        client.send(
          JSON.stringify({
            ...snapshot,
            mates: { ...mates, [projectId]: { presence: "corrupt" } },
          }),
        );
      }
      if (lastSnapshots.size === 0)
        throw new Error("Wait for the real HQ snapshot before corruption");
    },
    async ping() {
      if (structureClients.size !== 1)
        throw new Error("Heartbeat control requires exactly one structure stream");
      await deadline(
        new Promise<void>((resolve) => {
          pendingPongs.push(resolve);
          for (const client of structureClients) client.send(JSON.stringify({ type: "ping" }));
        }),
        "browser acknowledged HQ heartbeat",
      );
    },
  };
}
