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
  #pending: BuildLogLine[] = [];
  #flushHandle: unknown;

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
    const socket = new this.#WebSocketCtor(this.#wsUrl);
    socket.addEventListener("message", (event) => {
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
      if (this.#socket === socket) {
        this.#socket = undefined;
      }
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
      this.#publish({ lines, status: "live" });
    }, FLUSH_INTERVAL_MS);
  }
}
