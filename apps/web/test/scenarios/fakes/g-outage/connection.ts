// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- loopback impairment of real Core.
import * as NodeEvents from "node:events";
import { WebSocket, type RawData } from "ws";
import { HQ_STREAM_SEGMENT_CLOSE } from "@t3tools/shared/hqStream";
import { serve, deadline } from "../../harness/http.ts";

type Frame = Record<string, unknown>;
const bytesOf = (raw: RawData) =>
  Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
const readFrame = (raw: RawData, binary: boolean): Frame | undefined => {
  if (binary) return undefined;
  try {
    return JSON.parse(bytesOf(raw).toString()) as Frame;
  } catch {
    return undefined;
  }
};

/** Forwards bytes unchanged; only explicit controls impair individual structure connections. */
export async function outageConnection(upstreamOrigin: string) {
  const events = new NodeEvents.EventEmitter();
  const structures = new Map<
    WebSocket,
    {
      upstream: WebSocket;
      serial: number;
      stalled: boolean;
      droppedDown: string[];
      droppedUp: number;
    }
  >();
  /** Each browser socket's last cursor of each Mate's attention scope HQ delivered, by project. */
  const attentionCursors = new Map<
    WebSocket,
    Map<string, { readonly incarnation: string; readonly revision: number }>
  >();
  const pendingPongs = new Map<WebSocket, (() => void)[]>();
  let serial = 0;
  let factsSilent = false;
  const waitFor = async <A>(read: () => A | undefined, what: string): Promise<A> => {
    let check = () => {};
    try {
      return await deadline(
        new Promise<A>((resolve) => {
          check = () => {
            const result = read();
            if (result !== undefined) resolve(result);
          };
          events.on("change", check);
          check();
        }),
        what,
      );
    } finally {
      events.off("change", check);
    }
  };
  const oneStructure = (after = 0) =>
    waitFor(() => {
      const open = [...structures].filter(
        ([client, link]) =>
          client.readyState === WebSocket.OPEN && link.upstream.readyState === WebSocket.OPEN,
      );
      return open.length === 1 && open[0]![1].serial > after ? open[0] : undefined;
    }, "exactly one ready HQ structure socket");
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
      const upstream = new WebSocket(
        new URL(url.pathname + url.search, upstreamOrigin.replace(/^http/u, "ws")),
      );
      const link = {
        upstream,
        serial: isStructure ? ++serial : 0,
        stalled: false,
        droppedDown: [] as string[],
        droppedUp: 0,
      };
      if (isStructure) structures.set(client, link);
      const queued: { bytes: Buffer; binary: boolean }[] = [];
      client.on("message", (raw, binary) => {
        if (link.stalled) {
          link.droppedUp++;
          events.emit("change");
          return;
        }
        if (isStructure && readFrame(raw, binary)?.type === "pong")
          pendingPongs.get(client)?.shift()?.();
        const bytes = bytesOf(raw);
        if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary });
        else queued.push({ bytes, binary });
      });
      upstream.on("open", () => {
        if (!link.stalled)
          for (const frame of queued) upstream.send(frame.bytes, { binary: frame.binary });
        events.emit("change");
      });
      upstream.on("message", (raw, binary) => {
        if (link.stalled) {
          link.droppedDown.push(bytesOf(raw).toString());
          events.emit("change");
          return;
        }
        const parsed = isStructure ? readFrame(raw, binary) : undefined;
        const scope = parsed?.scope as { kind?: unknown; projectId?: unknown } | undefined;
        if (
          (parsed?.type === "scope-reset" ||
            parsed?.type === "scope-values" ||
            parsed?.type === "scope-ready") &&
          scope?.kind === "attention" &&
          typeof scope.projectId === "string"
        ) {
          const cursors = attentionCursors.get(client) ?? new Map();
          cursors.set(scope.projectId, {
            incarnation: String(parsed.incarnation),
            revision: Number(parsed.revision),
          });
          attentionCursors.set(client, cursors);
        }
        if (isStructure && factsSilent && parsed?.type !== "ping") return;
        if (client.readyState === WebSocket.OPEN) client.send(bytesOf(raw), { binary });
      });
      upstream.on("close", (code) => {
        if (!link.stalled && client.readyState === WebSocket.OPEN)
          client.close(code === 1006 ? 1011 : code === 1005 ? 1000 : code);
        events.emit("change");
      });
      upstream.on("error", () => {
        if (!link.stalled) client.close(1011);
      });
      client.on("close", () => {
        structures.delete(client);
        attentionCursors.delete(client);
        pendingPongs.delete(client);
        upstream.close();
        events.emit("change");
      });
      events.emit("change");
    },
  );
  return {
    ...server,
    silenceFacts() {
      factsSilent = true;
    },
    async nextSegmentWithoutSnapshot() {
      const [client, link] = (await oneStructure())!;
      factsSilent = true;
      client.close(HQ_STREAM_SEGMENT_CLOSE.code, HQ_STREAM_SEGMENT_CLOSE.reason);
      await oneStructure(link.serial);
    },
    async stall() {
      const [client, link] = (await oneStructure())!;
      link.stalled = true;
      return {
        waitForDownstream: (text: string) =>
          waitFor(
            () => (link.droppedDown.some((frame) => frame.includes(text)) ? true : undefined),
            `stalled HQ frame containing ${text}`,
          ),
        waitForUpstream: () =>
          waitFor(() => (link.droppedUp > 0 ? true : undefined), "stalled browser frame"),
        get open() {
          return (
            client.readyState === WebSocket.OPEN && link.upstream.readyState === WebSocket.OPEN
          );
        },
      };
    },
    /** HQ's next delivery of a Mate's attention, its value one this build cannot read. */
    corruptMate(projectId: string) {
      let sent = 0;
      for (const [client, cursors] of attentionCursors) {
        const cursor = cursors.get(projectId);
        if (cursor === undefined) continue;
        const next = { ...cursor, revision: cursor.revision + 1 };
        cursors.set(projectId, next);
        client.send(
          JSON.stringify({
            type: "scope-values",
            scope: { kind: "attention", projectId },
            ...next,
            values: [{ key: projectId, value: { presence: "corrupt" } }],
            removals: [],
          }),
        );
        sent++;
      }
      if (sent === 0)
        throw new Error(`Wait for HQ's real attention of ${projectId} before corruption`);
    },
    async ping() {
      const [client] = (await oneStructure())!;
      await deadline(
        new Promise<void>((resolve) => {
          const pending = pendingPongs.get(client) ?? [];
          pending.push(resolve);
          pendingPongs.set(client, pending);
          client.send(JSON.stringify({ type: "ping" }));
        }),
        "browser acknowledged HQ heartbeat",
      );
    },
  };
}
