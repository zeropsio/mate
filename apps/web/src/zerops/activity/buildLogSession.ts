/**
 * The engine behind `useBuildLog` — resolves log access (through the
 * caller's `resolveAccess`, so the module-scope per-project cache lives in
 * the hook), backfills over HTTP, then appends live lines over a WebSocket
 * while `live` is on, buffering incoming lines and publishing at most every
 * 100ms.
 *
 * A plain class with injectable `fetch`/`WebSocket`/clock/timer, mirroring
 * `projectActivityPoller.ts`'s test seam — driven directly with fakes in
 * tests rather than through the React hook.
 */
import {
  buildLogUrls,
  mergeBuildLogLines,
  readBuildLogItems,
  withStreamFrom,
  type BuildLogLine,
  type BuildLogQuery,
} from "@t3tools/client-runtime/zerops/activity/buildLog";

export type BuildLogStatus = "idle" | "loading" | "live" | "ended" | "error";

export interface BuildLogSnapshot {
  readonly lines: ReadonlyArray<BuildLogLine>;
  readonly status: BuildLogStatus;
}

interface MinimalFetchResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

type FetchImpl = (url: string) => Promise<MinimalFetchResponse>;

interface MinimalWebSocket {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: () => void): void;
  close(): void;
}

type WebSocketCtor = new (url: string) => MinimalWebSocket;

export interface BuildLogSessionOptions {
  readonly resolveAccess: () => Promise<{ readonly url: string }>;
  readonly query: BuildLogQuery;
  readonly limit?: number;
  readonly fetchImpl?: FetchImpl;
  readonly WebSocketCtor?: WebSocketCtor;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

const FLUSH_INTERVAL_MS = 100;
const DEFAULT_LIMIT = 500;

function parseMessageData(data: unknown): unknown {
  if (typeof data !== "string") {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

const globalFetch: FetchImpl | undefined =
  typeof fetch === "function" ? (url) => fetch(url) : undefined;
const globalWebSocketCtor =
  typeof WebSocket === "function" ? (WebSocket as unknown as WebSocketCtor) : undefined;

export class BuildLogSession {
  readonly #resolveAccess: () => Promise<{ readonly url: string }>;
  readonly #query: BuildLogQuery;
  readonly #limit: number;
  readonly #fetchImpl: FetchImpl | undefined;
  readonly #WebSocketCtor: WebSocketCtor | undefined;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;

  readonly #listeners = new Set<() => void>();
  #snapshot: BuildLogSnapshot = { lines: [], status: "idle" };
  #live = false;
  #started = false;
  #disposed = false;
  #socket: MinimalWebSocket | undefined;
  #wsUrl: string | undefined;
  /** The newest line's id seen so far (backfill or stream) — reconnect asks `from` this, not a timestamp. */
  #latestLineId: string | undefined;
  #pending: BuildLogLine[] = [];
  #flushHandle: unknown;
  /**
   * True while the current socket is itself a one-shot reopen after a
   * server-side close — reset back to false on proof of life (a message),
   * so a later close gets its own fresh reopen instead of an immediate
   * give-up.
   */
  #reopening = false;

  constructor(options: BuildLogSessionOptions) {
    this.#resolveAccess = options.resolveAccess;
    this.#query = options.query;
    this.#limit = options.limit ?? DEFAULT_LIMIT;
    this.#fetchImpl = options.fetchImpl ?? globalFetch;
    this.#WebSocketCtor = options.WebSocketCtor ?? globalWebSocketCtor;
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  }

  getSnapshot(): BuildLogSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Idempotent — a second `start` only updates the live flag. */
  start(live: boolean): void {
    this.#live = live;
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#publish({ lines: [], status: "loading" });
    void this.#backfill();
  }

  setLive(live: boolean): void {
    if (this.#live === live) {
      return;
    }
    this.#live = live;
    if (!live) {
      this.#closeSocket();
      if (this.#snapshot.status === "live") {
        this.#publish({ ...this.#snapshot, status: "ended" });
      }
      return;
    }
    if (this.#snapshot.status === "ended") {
      this.#openSocket();
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#closeSocket();
    if (this.#flushHandle !== undefined) {
      this.#clearTimer(this.#flushHandle);
      this.#flushHandle = undefined;
    }
    this.#listeners.clear();
  }

  #publish(next: BuildLogSnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  async #backfill(): Promise<void> {
    if (this.#fetchImpl === undefined) {
      this.#publish({ ...this.#snapshot, status: "error" });
      return;
    }
    try {
      const access = await this.#resolveAccess();
      const urls = buildLogUrls(access, this.#query, this.#limit);
      this.#wsUrl = urls.ws;
      const response = await this.#fetchImpl(urls.http);
      if (this.#disposed) {
        return;
      }
      if (!response.ok) {
        this.#publish({ ...this.#snapshot, status: "error" });
        return;
      }
      const body = await response.json();
      if (this.#disposed) {
        return;
      }
      const lines = mergeBuildLogLines([], readBuildLogItems(body));
      this.#latestLineId = lines.at(-1)?.id;
      if (this.#live) {
        this.#publish({ lines, status: "live" });
        this.#openSocket();
      } else {
        this.#publish({ lines, status: "ended" });
      }
    } catch {
      if (!this.#disposed) {
        this.#publish({ ...this.#snapshot, status: "error" });
      }
    }
  }

  #openSocket(): void {
    if (
      this.#WebSocketCtor === undefined ||
      this.#wsUrl === undefined ||
      this.#socket !== undefined
    ) {
      return;
    }
    // The newest line seen so far (backfill or stream) becomes `from` on
    // (re)connect — live-verified against the log backend to be an item id,
    // not a timestamp, matching the GUI's own reconnect.
    const url =
      this.#latestLineId === undefined
        ? this.#wsUrl
        : withStreamFrom(this.#wsUrl, this.#latestLineId);
    let socket: MinimalWebSocket;
    try {
      // A malformed url (or a host/scheme the runtime refuses) throws
      // synchronously here — typically a SyntaxError whose own message
      // embeds the url, which for this session is a signed access url.
      // Caught at the source (this is called both from the initial open and
      // from the close handler's reopen, and only the former sits inside an
      // enclosing try/catch) so it is reported the same way any other
      // stream failure is, and the url never propagates in a thrown error.
      socket = new this.#WebSocketCtor(url);
    } catch {
      if (!this.#disposed) {
        this.#publish({ ...this.#snapshot, status: "error" });
      }
      return;
    }
    socket.addEventListener("message", (event) => {
      // Proof of life — a later close gets its own fresh one-shot reopen.
      this.#reopening = false;
      const items = readBuildLogItems(parseMessageData(event.data));
      if (items.length === 0) {
        return;
      }
      this.#pending.push(...items);
      this.#scheduleFlush();
    });
    socket.addEventListener("error", () => {
      this.#publish({ ...this.#snapshot, status: "error" });
    });
    socket.addEventListener("close", () => {
      if (this.#socket !== socket) {
        return; // superseded by a newer socket already.
      }
      this.#socket = undefined;
      if (this.#disposed || !this.#live) {
        // Our own close (setLive(false)/dispose already published its status).
        return;
      }
      // Server-side close (e.g. the Zerops L7 idle-kills a WebSocket after
      // 60s) while we still want to be live — reopen once. If the reopened
      // socket also closes without ever proving itself, give up.
      if (this.#reopening) {
        this.#reopening = false;
        this.#publish({ ...this.#snapshot, status: "ended" });
        return;
      }
      this.#reopening = true;
      this.#openSocket();
    });
    this.#socket = socket;
  }

  #closeSocket(): void {
    this.#socket?.close();
    this.#socket = undefined;
  }

  #scheduleFlush(): void {
    if (this.#flushHandle !== undefined) {
      return;
    }
    this.#flushHandle = this.#setTimer(() => {
      this.#flushHandle = undefined;
      if (this.#pending.length === 0) {
        return;
      }
      const lines = mergeBuildLogLines(this.#snapshot.lines, this.#pending);
      this.#pending = [];
      this.#latestLineId = lines.at(-1)?.id ?? this.#latestLineId;
      // Keep whatever status already holds — a message can be buffered just
      // before `setLive(false)` or an error closes things down, and this
      // flush firing afterwards must not force the status back to `live`
      // with no socket behind it.
      this.#publish({ ...this.#snapshot, lines });
    }, FLUSH_INTERVAL_MS);
  }
}
