// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- loopback transport latency, not simulated HQ state.
import { WebSocket } from "ws";
import { deadline, serve } from "../../harness/http.ts";

/** Delay actual Core frames containing application details; summary-only frames still pass. */
export async function applicationDetailsGate(origin: string) {
  let appId: string | undefined;
  let held = false;
  let notify = () => {};
  const arrived = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const pending: (() => void)[] = [];
  const upstreams = new Set<WebSocket>();
  const server = await serve(
    async (request) => {
      const response = await fetch(new URL(request.url.pathname + request.url.search, origin), {
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).flatMap(([key, value]) =>
            value === undefined || ["host", "content-length"].includes(key)
              ? []
              : [[key, Array.isArray(value) ? value.join(", ") : value]],
          ),
        ),
        ...(["GET", "HEAD", "OPTIONS"].includes(request.method)
          ? {}
          : { body: new Uint8Array(request.rawBody ?? []).buffer }),
        redirect: "manual",
      });
      return {
        status: response.status,
        bytes: Buffer.from(await response.arrayBuffer()),
        headers: Object.fromEntries(response.headers),
      };
    },
    (client, url) => {
      const upstream = new WebSocket(
        new URL(url.pathname + url.search, origin.replace(/^http/u, "ws")),
      );
      upstreams.add(upstream);
      const outgoing: (() => void)[] = [];
      client.on("message", (data, binary) => {
        const send = () => upstream.send(data, { binary });
        if (upstream.readyState === WebSocket.OPEN) send();
        else outgoing.push(send);
      });
      upstream.on("open", () => {
        for (const send of outgoing.splice(0)) send();
      });
      upstream.on("message", (data, binary) => {
        const send = () => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
        };
        const frame = JSON.parse(String(data)) as {
          appReads?: Record<string, unknown>;
          type?: string;
          appId?: string;
          read?: unknown;
        };
        const detail =
          appId !== undefined &&
          (frame.appReads?.[appId] !== undefined ||
            (frame.type === "release-revision" &&
              frame.appId === appId &&
              frame.read !== undefined));
        if (detail) {
          held = true;
          pending.push(send);
          notify();
        } else send();
      });
      upstream.on("error", () => client.close(1011));
      upstream.on("close", () => {
        upstreams.delete(upstream);
        if (client.readyState === WebSocket.OPEN) client.close(1011);
      });
      client.on("close", () => upstream.close());
    },
  );
  const release = () => {
    appId = undefined;
    for (const send of pending.splice(0)) send();
  };
  return {
    origin: server.origin,
    hold: (id: string) => {
      appId = id;
    },
    waitForHeld: () =>
      held ? Promise.resolve() : deadline(arrived, "real HQ application detail frame held"),
    release,
    close: async () => {
      release();
      for (const upstream of upstreams) upstream.terminate();
      await server.close();
    },
  };
}
