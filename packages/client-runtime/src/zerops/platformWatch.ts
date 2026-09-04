/**
 * The platform websocket protocol: a pure state machine over an injected
 * socket factory and timers, no network of its own.
 *
 * Verified protocol (`docs/internals/zerops/verified.md` "platform websocket
 * from a browser origin", cross-checked against `frontend-legacy`'s own
 * client — `libs/zef/src/websocket/*`, `apps/zerops/src/modules/core/
 * {process-base,service-stack-base}/*.effect.ts`, `apps/zerops/src/modules/
 * app/app.effect.ts`):
 * 1. `client.exchangeWebSocketToken()` (`POST /web-socket/login`) trades the
 *    account's access token for a short-lived `webSocketToken`.
 * 2. Connect `wss://<api host>/api/rest/public/web-socket/<receiverId>/<webSocketToken>`.
 *    The server greets with `{"type":"SocketSuccess"}`.
 * 3. Once greeted, four `client.subscribeProjectSearch` calls route pushes to
 *    this receiver: ServiceStack list, Process list, ServiceStack update,
 *    Process update — in that order. The Process **list** subscription alone
 *    is re-issued every 160s on the same receiver, matching
 *    `process-base.effect.ts`'s `timer(0, 160000)` (subscription expiry,
 *    kept quiet — never a `changed` signal); the other three are one-shot
 *    per connection, matching `service-stack-base.effect.ts` and the Process
 *    **update** subscription there, neither of which is ever re-issued.
 * 4. `{"type":"ping"}` every 15s starting immediately on connect
 *    (`websocket.effect.ts`'s `timer(0, 15000)`); each ping opens its own 8s
 *    deadline for a `{"type":"pong"}` reply — only a pong satisfies it, no
 *    other message does. A deadline that elapses declares the socket dead.
 * 5. On death: close, reconnect immediately with a fresh login and a fresh
 *    `receiverId` (`app.effect.ts`'s `_onZefWsClosed$`, no delay), and
 *    re-subscribe all four. If THAT reconnect attempt itself fails (the
 *    login call, the greeting, or a subscribe call), back off from there —
 *    1s doubling to 30s — before trying again.
 *
 * **A push is a signal, never data**: an inbound `{"type":"search",
 * "subscriptionName":…, "data":{…}}` message is decoded no further than
 * `type` and `subscriptionName` — `data` is never read, and `changed` never
 * carries it. `useProjectTopology.ts` is the caller that turns `changed` into
 * a debounced re-read through the one REST decoder that already exists
 * (`topology.ts`).
 */
import { DEFAULT_ZEROPS_API_BASE } from "./api.ts";

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;
const PROCESS_LIST_RESUBSCRIBE_MS = 160_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

const PUBLIC_WS_PATH = "/api/rest/public/web-socket";

export type PlatformWatchEvent =
  | { readonly type: "connected" }
  | { readonly type: "changed"; readonly subscriptionName: string }
  | { readonly type: "disconnected" };

/**
 * The shape a real `WebSocket` already satisfies (assignable handlers, not
 * `addEventListener`), so `makeSocket: (url) => new WebSocket(url)` works
 * unmodified in the browser; tests inject a fake.
 */
export interface PlatformWatchSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface PlatformWatchClient {
  exchangeWebSocketToken(): Promise<{ readonly webSocketToken: string }>;
  subscribeProjectSearch(
    entity: "service-stack" | "process",
    options: {
      readonly orgId: string;
      readonly projectId: string;
      readonly receiverId: string;
      readonly mode: "list" | "update";
    },
  ): Promise<unknown>;
}

export interface PlatformWatchTimers {
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface OpenPlatformWatchOptions {
  readonly client: PlatformWatchClient;
  readonly apiBase?: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly makeSocket: (url: string) => PlatformWatchSocket;
  /**
   * Injected rather than defaulted here: this is a plain module, not an
   * Effect one, and `packages/client-runtime` is meant to stay
   * runtime-agnostic (Effect's timer preference lint rule fires on a bare
   * `setTimeout` inside this package). The real caller
   * (`apps/web/src/zerops/useProjectTopology.ts`) supplies the ordinary
   * `setTimeout`/`clearTimeout` pair; tests supply fake ones.
   */
  readonly timers: PlatformWatchTimers;
  /**
   * Injected for the same reason: a bare `crypto.randomUUID()` inside this
   * package also trips the lint rule. The real caller passes
   * `() => crypto.randomUUID()`; tests supply a deterministic generator.
   */
  readonly makeReceiverId: () => string;
}

export interface PlatformWatchEvents {
  subscribe(listener: (event: PlatformWatchEvent) => void): () => void;
}

export interface PlatformWatch {
  readonly events: PlatformWatchEvents;
  close(): void;
}

function wsUrl(apiBase: string, receiverId: string, webSocketToken: string): string {
  const wsBase = apiBase.replace(/\/+$/, "").replace(/^http/i, "ws");
  return `${wsBase}${PUBLIC_WS_PATH}/${receiverId}/${webSocketToken}`;
}

function readMessage(data: string): { readonly type?: string; readonly subscriptionName?: string } {
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return {
        ...(typeof record.type === "string" ? { type: record.type } : {}),
        ...(typeof record.subscriptionName === "string"
          ? { subscriptionName: record.subscriptionName }
          : {}),
      };
    }
  } catch {
    // A frame that is not JSON carries no signal this watch understands.
  }
  return {};
}

/**
 * Opens (and keeps open) the platform push channel for one project.
 * `events.subscribe` may gain listeners at any time; `close()` tears
 * everything down and the watch never reconnects again after that.
 */
export function openPlatformWatch(options: OpenPlatformWatchOptions): PlatformWatch {
  const apiBase = options.apiBase ?? DEFAULT_ZEROPS_API_BASE;
  const { timers, makeReceiverId } = options;

  const listeners = new Set<(event: PlatformWatchEvent) => void>();
  let closed = false;
  let socket: PlatformWatchSocket | undefined;
  let pingHandle: unknown;
  /** The current ping's 8s "did a pong answer it" deadline — cleared by a pong, never by any other message. */
  let pongDeadlineHandle: unknown;
  let resubscribeHandle: unknown;
  let reconnectHandle: unknown;
  let backoffMs = BACKOFF_START_MS;
  /** Bumped on every (re)connect attempt so a stale attempt's async work is a no-op once superseded. */
  let generation = 0;

  const emit = (event: PlatformWatchEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const clearHandle = (handle: unknown): undefined => {
    if (handle !== undefined) timers.clearTimer(handle);
    return undefined;
  };

  const clearAllTimers = (): void => {
    pingHandle = clearHandle(pingHandle);
    pongDeadlineHandle = clearHandle(pongDeadlineHandle);
    resubscribeHandle = clearHandle(resubscribeHandle);
    reconnectHandle = clearHandle(reconnectHandle);
  };

  const teardownSocket = (): void => {
    if (socket !== undefined) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socket = undefined;
    }
    pingHandle = clearHandle(pingHandle);
    pongDeadlineHandle = clearHandle(pongDeadlineHandle);
    resubscribeHandle = clearHandle(resubscribeHandle);
  };

  /** Backed-off retry — only for a reconnect ATTEMPT that itself failed (login, greeting, or a subscribe call). */
  const scheduleReconnect = (myGeneration: number): void => {
    if (closed || myGeneration !== generation) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    reconnectHandle = timers.setTimer(() => {
      reconnectHandle = undefined;
      void connect();
    }, delay);
  };

  /** A connection that WAS up just died (pong timeout, or the socket itself closed/errored) — try again right away. */
  const goDead = (myGeneration: number): void => {
    if (closed || myGeneration !== generation) return;
    teardownSocket();
    emit({ type: "disconnected" });
    reconnectHandle = timers.setTimer(() => {
      reconnectHandle = undefined;
      void connect();
    }, 0);
  };

  const startHeartbeat = (myGeneration: number): void => {
    const tick = (): void => {
      if (closed || myGeneration !== generation || socket === undefined) return;
      socket.send(JSON.stringify({ type: "ping" }));
      pongDeadlineHandle = clearHandle(pongDeadlineHandle);
      pongDeadlineHandle = timers.setTimer(() => goDead(myGeneration), PONG_TIMEOUT_MS);
      pingHandle = timers.setTimer(tick, PING_INTERVAL_MS);
    };
    tick();
  };

  /** Keeps the Process list subscription's server-side registration from expiring — never a `changed` signal. */
  const startProcessListResubscribe = (myGeneration: number, receiverId: string): void => {
    const tick = (): void => {
      if (closed || myGeneration !== generation) return;
      void options.client
        .subscribeProjectSearch("process", {
          orgId: options.orgId,
          projectId: options.projectId,
          receiverId,
          mode: "list",
        })
        .catch(() => {
          // A missed refresh is not fatal — the subscription lapses at worst,
          // and the next ping/pong cycle is what actually judges the socket.
        });
      resubscribeHandle = timers.setTimer(tick, PROCESS_LIST_RESUBSCRIBE_MS);
    };
    resubscribeHandle = timers.setTimer(tick, PROCESS_LIST_RESUBSCRIBE_MS);
  };

  const onMessage = (myGeneration: number, data: string): void => {
    if (closed || myGeneration !== generation) return;
    const message = readMessage(data);
    if (message.type === "pong") {
      pongDeadlineHandle = clearHandle(pongDeadlineHandle);
      return;
    }
    if (message.type === "search" && message.subscriptionName !== undefined) {
      emit({ type: "changed", subscriptionName: message.subscriptionName });
    }
  };

  async function connect(): Promise<void> {
    if (closed) return;
    const myGeneration = generation;

    let webSocketToken: string;
    try {
      ({ webSocketToken } = await options.client.exchangeWebSocketToken());
    } catch {
      scheduleReconnect(myGeneration);
      return;
    }
    if (closed || myGeneration !== generation) return;

    const receiverId = makeReceiverId();
    const url = wsUrl(apiBase, receiverId, webSocketToken);
    const nextSocket = options.makeSocket(url);
    socket = nextSocket;

    await new Promise<void>((resolve) => {
      nextSocket.onopen = () => resolve();
      nextSocket.onerror = () => resolve();
    });
    if (closed || myGeneration !== generation) return;

    const greeting = await new Promise<{ readonly type?: string } | undefined>((resolve) => {
      let settled = false;
      nextSocket.onmessage = (event) => {
        if (settled) return;
        settled = true;
        resolve(readMessage(event.data));
      };
      nextSocket.onclose = () => {
        if (settled) return;
        settled = true;
        resolve(undefined);
      };
    });
    if (closed || myGeneration !== generation) return;
    if (greeting?.type !== "SocketSuccess") {
      teardownSocket();
      scheduleReconnect(myGeneration);
      return;
    }

    try {
      // Membership (list) for both entities, then status (update) for both —
      // matches the measured protocol's own grouping, not an entity-major one.
      for (const mode of ["list", "update"] as const) {
        for (const entity of ["service-stack", "process"] as const) {
          await options.client.subscribeProjectSearch(entity, {
            orgId: options.orgId,
            projectId: options.projectId,
            receiverId,
            mode,
          });
        }
      }
    } catch {
      if (closed || myGeneration !== generation) return;
      teardownSocket();
      scheduleReconnect(myGeneration);
      return;
    }
    if (closed || myGeneration !== generation) return;

    nextSocket.onmessage = (event) => onMessage(myGeneration, event.data);
    nextSocket.onclose = () => goDead(myGeneration);
    nextSocket.onerror = () => goDead(myGeneration);

    backoffMs = BACKOFF_START_MS;
    startHeartbeat(myGeneration);
    startProcessListResubscribe(myGeneration, receiverId);
    emit({ type: "connected" });
  }

  void connect();

  return {
    events: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    close() {
      if (closed) return;
      closed = true;
      generation += 1;
      clearAllTimers();
      teardownSocket();
      listeners.clear();
    },
  };
}
