// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- loopback proxy to real Core.
import { WebSocket } from "ws";
import { deadline, serve, type HttpHandler } from "../../harness/http.ts";

/** Holds a person's merge before real Core sees it; never invents HQ state or permission. */
export class MergeGate {
  private release: (() => void) | undefined;
  private arrived: (() => void) | undefined;
  private receipt = Promise.resolve();
  private held = Promise.resolve();
  hold() {
    this.receipt = new Promise<void>((resolve) => {
      this.arrived = resolve;
    });
    this.held = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  async enter() {
    this.arrived?.();
    await this.held;
  }
  received() {
    return deadline(this.receipt, "Person pressed Merge", 15_000);
  }
  resume() {
    this.release?.();
    this.release = undefined;
  }
}

/** Buffers selected real HQ frames in order; other frames continue and no contents change. */
export class HqFrameHold {
  private holding = false;
  private frames: { client: WebSocket; frame: string }[] = [];
  private receipt = Promise.resolve();
  private arrived: (() => void) | undefined;
  private accepts: (frame: string) => boolean = () => true;
  hold(accepts: (frame: string) => boolean = () => true) {
    this.accepts = accepts;
    this.holding = true;
    this.receipt = new Promise<void>((resolve) => {
      this.arrived = resolve;
    });
  }
  forward(client: WebSocket, frame: string) {
    if (client.readyState !== WebSocket.OPEN) return;
    if (!this.holding || !this.accepts(frame)) {
      client.send(frame);
      return;
    }
    this.frames.push({ client, frame });
    this.arrived?.();
  }
  received() {
    return deadline(this.receipt, "HQ socket frame buffered", 15_000);
  }
  resume() {
    this.holding = false;
    for (const { client, frame } of this.frames) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
    this.frames = [];
  }
  forget(client: WebSocket) {
    this.frames = this.frames.filter((frame) => frame.client !== client);
  }
}

export async function changeTransport(origin: string, gate: MergeGate, frames = new HqFrameHold()) {
  const handle: HttpHandler = async (request) => {
    if (request.method === "POST" && request.url.pathname.endsWith("/merge")) await gate.enter();
    const response = await fetch(new URL(request.url.pathname + request.url.search, origin), {
      method: request.method,
      headers: Object.fromEntries(
        Object.entries(request.headers).flatMap(([key, value]) =>
          value === undefined || key === "host" || key === "content-length"
            ? []
            : [[key, Array.isArray(value) ? value.join(", ") : value]],
        ),
      ),
      ...(["GET", "HEAD"].includes(request.method)
        ? {}
        : { body: new Uint8Array(request.rawBody ?? []).buffer }),
      redirect: "manual",
    });
    return {
      status: response.status,
      bytes: Buffer.from(await response.arrayBuffer()),
      headers: Object.fromEntries(response.headers),
    };
  };
  const upstreams = new Set<WebSocket>();
  const server = await serve(handle, (client, url) => {
    const upstream = new WebSocket(
      new URL(url.pathname + url.search, origin.replace(/^http/u, "ws")),
    );
    upstreams.add(upstream);
    const pending: string[] = [];
    client.on("message", (frame) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(String(frame));
      else pending.push(String(frame));
    });
    upstream.on("open", () => {
      for (const frame of pending) upstream.send(frame);
    });
    upstream.on("message", (frame) => {
      frames.forward(client, String(frame));
    });
    upstream.on("error", () => client.close(1011));
    upstream.on("close", (code, reason) => {
      upstreams.delete(upstream);
      if (client.readyState === WebSocket.OPEN)
        client.close(code === 1006 ? 1011 : code === 1005 ? 1000 : code, String(reason));
    });
    client.on("close", () => {
      frames.forget(client);
      upstream.close();
    });
  });
  return {
    ...server,
    async close() {
      gate.resume();
      frames.resume();
      for (const socket of upstreams) socket.terminate();
      await server.close();
    },
  };
}
