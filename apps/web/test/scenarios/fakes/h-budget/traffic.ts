// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off preferSchemaOverJson:off -- loopback-only transport instrumentation.
import * as NodeEvents from "node:events";
import { WebSocket, type RawData } from "ws";
import { HQ_STREAM_SEGMENT_CLOSE } from "@t3tools/shared/hqStream";
import { deadline, serve } from "../../harness/http.ts";
import { settled } from "./activity.ts";
import type { Page } from "puppeteer-core";

const bytesOf = (data: RawData) =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

/** A scope's catchup end names its scope (a Mate's project id), never a fact. */
const scopeReady = (bytes: Buffer) => bytes.includes('"type":"scope-ready"');

/** Menu sentinels identify state without depending on HQ's frame types or heartbeat cadence. */
const carriesMenu = (bytes: Buffer) =>
  !scopeReady(bytes) && ["Shop", "Ada", "Bea"].some((name) => bytes.includes(name));

/** Observe real HQ bytes without replacing its responses. */
export async function observeTraffic(origin: string) {
  const events = new NodeEvents.EventEmitter();
  const stateEvents = new NodeEvents.EventEmitter();
  const links = new Map<WebSocket, WebSocket>();
  const segments: {
    open: boolean;
    firstDataMs: number | null;
    downBytes: number;
    stateBytes: number;
    frames: number;
    pendingScopes: Set<string>;
    subscribed: boolean;
  }[] = [];
  const server = await serve(
    async (request) => {
      const response = await fetch(new URL(request.url.pathname + request.url.search, origin), {
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
      return {
        status: response.status,
        bytes: Buffer.from(await response.arrayBuffer()),
        headers: Object.fromEntries(response.headers),
      };
    },
    (client, url) => {
      const openedAt = performance.now();
      const segment = {
        open: false,
        firstDataMs: null as number | null,
        downBytes: 0,
        stateBytes: 0,
        frames: 0,
        pendingScopes: new Set<string>(),
        subscribed: false,
      };
      segments.push(segment);
      const upstream = new WebSocket(
        new URL(url.pathname + url.search, origin.replace(/^http/u, "ws")),
      );
      links.set(client, upstream);
      const queued: { bytes: Buffer; binary: boolean }[] = [];
      client.on("message", (data, binary) => {
        const bytes = bytesOf(data);
        const request = JSON.parse(bytes.toString()) as {
          type?: string;
          scopes?: { scope: unknown }[];
        };
        if (request.type === "subscribe") {
          segment.subscribed = true;
          for (const { scope } of request.scopes ?? [])
            segment.pendingScopes.add(JSON.stringify(scope));
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary });
        else queued.push({ bytes, binary });
      });
      upstream.on("open", () => {
        segment.open = true;
        events.emit("open");
        for (const frame of queued) upstream.send(frame.bytes, { binary: frame.binary });
      });
      upstream.on("message", (data, binary) => {
        const bytes = bytesOf(data);
        if (scopeReady(bytes)) {
          const ready = JSON.parse(bytes.toString()) as { scope: unknown };
          segment.pendingScopes.delete(JSON.stringify(ready.scope));
          stateEvents.emit("activity");
        }
        if (bytes.includes("Shop")) segment.firstDataMs ??= performance.now() - openedAt;
        if (carriesMenu(bytes)) {
          segment.stateBytes += bytes.length;
          stateEvents.emit("activity");
        }
        segment.downBytes += bytes.length;
        segment.frames++;
        if (client.readyState === WebSocket.OPEN) client.send(bytes, { binary });
        events.emit("data");
      });
      upstream.on("close", (code, reason) => {
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
  );
  return {
    ...server,
    segments,
    stateSettled: () =>
      settled(
        stateEvents,
        () => {
          const segment = segments.at(-1);
          return segment?.subscribed === true && segment.pendingScopes.size === 0;
        },
        "HQ subscribed scopes caught up (scope-ready receipts)",
      ),
    async opened(count: number) {
      const ready = () => segments.filter((segment) => segment.open).length >= count;
      if (ready()) return;
      let check = () => {};
      try {
        await deadline(
          new Promise<void>((resolve) => {
            check = () => {
              if (ready()) resolve();
            };
            events.on("open", check);
            check();
          }),
          `${count} HQ socket opens`,
        );
      } finally {
        events.off("open", check);
      }
    },
    async firstData(count: number) {
      const ready = () =>
        segments.filter((segment) => segment.firstDataMs !== null).length >= count;
      if (ready()) return;
      let check = () => {};
      try {
        await deadline(
          new Promise<void>((resolve) => {
            check = () => {
              if (ready()) resolve();
            };
            events.on("data", check);
            check();
          }),
          `${count} HQ segments with first data`,
        );
      } finally {
        events.off("data", check);
      }
    },
    endSegment() {
      if (links.size !== 1) throw new Error(`Expected one HQ link, got ${links.size}`);
      // The same transport ending Core emits at 100 s, without waiting on its native clock.
      for (const client of links.keys())
        client.close(HQ_STREAM_SEGMENT_CLOSE.code, HQ_STREAM_SEGMENT_CLOSE.reason);
    },
  };
}

export function percentile(values: number[], fraction: number) {
  if (values.length === 0) throw new Error("A percentile needs samples");
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

/** Observe each tab independently, so another tab cannot hide duplicate HQ connections. */
export async function observeTabConnections(pages: Page[], origin: string) {
  const socketOrigin = origin.replace(/^http/u, "ws");
  const records = await Promise.all(
    pages.map(async (page) => {
      const session = await page.createCDPSession();
      const record = { count: 0, session };
      session.on("Network.webSocketCreated", ({ url }) => {
        if (new URL(url).origin === socketOrigin) record.count++;
      });
      await session.send("Network.enable");
      return record;
    }),
  );
  return {
    counts: () => records.map(({ count }) => count),
    close: async () => {
      await Promise.all(records.map(({ session }) => session.detach()));
    },
  };
}
