/**
 * The order a tab's sockets open in: the route's environment first, and never behind another.
 *
 * A browser opens one WebSocket at a time to an address (RFC 6455 §4.1 allows one connection in
 * CONNECTING per host), its TLS handshake included, and every Mate a Zerops region serves answers
 * at one address, the region's L7 balancer. The lock is the browser profile's, shared by every tab
 * of it. The sockets a page asks for therefore open one after another, each on a fresh TLS
 * connection: a WebSocket never shares the HTTP/2 connection the page's requests ride on.
 * Measured 2026-09-30: 0.9–1.8 s per socket on a VPN whose path MTU stalls a post-quantum
 * ClientHello, and an upgrade to a Mate whose container is going down held by the L7 for up to
 * 5 s before its 502 — each such attempt holding the lock, and everything behind it, for as long.
 *
 * So, while the route's socket is not open:
 * - from the moment the route is named until its first attempt ends (or {@link ROUTE_FIRST_HOLD_MS}
 *   passes, a route whose exchange never finishes), and during every later attempt of the route's
 *   own — a reconnect included — no other environment starts one;
 * - the moment the route starts an attempt, every other attempt still in flight is told to yield
 *   (its ticket's `signal` aborts): closing a socket still CONNECTING frees the lock at once.
 *
 * Other environments open one at a time, each given {@link OTHER_ATTEMPT_MS} before it yields, so
 * none of them keeps the lock from the rest either.
 *
 * @module connection/admission
 */
import type { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";

/** How long the route, named but not yet attempting (its exchange running), holds the others. */
export const ROUTE_FIRST_HOLD_MS = 15_000;
/** How long another environment's attempt may run before it yields to the rest. */
export const OTHER_ATTEMPT_MS = 8_000;

export interface AdmissionTimers {
  /** Arms a timer; returns what disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

/** One admitted attempt. */
export interface AdmissionTicket {
  /** Aborts when the attempt must give way: the route needs the lock, or its time ran out. */
  readonly signal: AbortSignal;
  /** The attempt ended: `open` when its socket is up. Later calls are ignored. */
  readonly settle: (open: boolean) => void;
  /** A socket that settled open has closed. */
  readonly close: () => void;
}

export interface ConnectionAdmission {
  /** The route's environment, whose socket opens before any other's; null when none. */
  readonly prefer: (environmentId: EnvironmentId | null) => void;
  /**
   * Resolves once this environment may start an attempt. Rejects with the signal's reason when
   * the caller gives up first.
   */
  readonly admit: (environmentId: EnvironmentId, signal?: AbortSignal) => Promise<AdmissionTicket>;
}

const systemTimers: AdmissionTimers = {
  setTimer: (delayMs, fire) => {
    // @effect-diagnostics-next-line globalTimers:off -- the admission's one timer port; plain promises, no Effect runtime.
    const handle = setTimeout(fire, delayMs);
    return () => clearTimeout(handle);
  },
};

interface Waiter {
  readonly environmentId: EnvironmentId;
  readonly start: () => void;
}

export function makeConnectionAdmission(
  timers: AdmissionTimers = systemTimers,
): ConnectionAdmission {
  let preferred: EnvironmentId | null = null;
  /** The route is named and its first attempt has not ended. */
  let awaitingFirst = false;
  let cancelFirstHold: (() => void) | null = null;
  /** The route's attempts in flight. */
  let routeAttempts = 0;
  /** Open sockets per environment: a replacement opens beside the connection it replaces. */
  const open = new Map<EnvironmentId, number>();
  /** Other environments' attempts in flight, each with what makes it yield. */
  const others = new Set<{ readonly controller: AbortController; cancelTimer: () => void }>();
  const waiting: Array<Waiter> = [];

  const isOpen = (environmentId: EnvironmentId) => (open.get(environmentId) ?? 0) > 0;
  const holding = () =>
    preferred !== null && !isOpen(preferred) && (awaitingFirst || routeAttempts > 0);

  /** Starts what may start: nothing while the route holds, else one other at a time. */
  const pump = () => {
    if (holding()) return;
    while (waiting.length > 0 && others.size === 0) waiting.shift()!.start();
  };

  const endFirstHold = () => {
    awaitingFirst = false;
    cancelFirstHold?.();
    cancelFirstHold = null;
  };

  const yieldOthers = () => {
    for (const other of others) {
      other.cancelTimer();
      other.controller.abort(new Error("The route's socket goes first."));
    }
    others.clear();
  };

  const ticketFor = (
    environmentId: EnvironmentId,
    controller: AbortController,
    onEnd: () => void,
  ): AdmissionTicket => {
    let settled = false;
    let opened = false;
    let closed = false;
    return {
      signal: controller.signal,
      settle: (isOpenNow) => {
        if (settled) return;
        settled = true;
        if (isOpenNow) {
          opened = true;
          open.set(environmentId, (open.get(environmentId) ?? 0) + 1);
        }
        onEnd();
        pump();
      },
      close: () => {
        if (!opened || closed) return;
        closed = true;
        const count = (open.get(environmentId) ?? 0) - 1;
        if (count > 0) open.set(environmentId, count);
        else open.delete(environmentId);
      },
    };
  };

  const admitRoute = (environmentId: EnvironmentId): AdmissionTicket => {
    routeAttempts += 1;
    yieldOthers();
    let ended = false;
    return ticketFor(environmentId, new AbortController(), () => {
      if (ended) return;
      ended = true;
      if (preferred === environmentId) {
        routeAttempts = Math.max(0, routeAttempts - 1);
        endFirstHold();
      }
    });
  };

  const admitOther = (environmentId: EnvironmentId): AdmissionTicket => {
    const controller = new AbortController();
    const entry: { readonly controller: AbortController; cancelTimer: () => void } = {
      controller,
      cancelTimer: () => undefined,
    };
    entry.cancelTimer = timers.setTimer(OTHER_ATTEMPT_MS, () => {
      others.delete(entry);
      controller.abort(new Error("The attempt ran out of time."));
      pump();
    });
    others.add(entry);
    return ticketFor(environmentId, controller, () => {
      entry.cancelTimer();
      others.delete(entry);
    });
  };

  return {
    prefer: (environmentId) => {
      if (environmentId === preferred) return;
      preferred = environmentId;
      routeAttempts = 0;
      endFirstHold();
      if (environmentId !== null && !isOpen(environmentId)) {
        awaitingFirst = true;
        cancelFirstHold = timers.setTimer(ROUTE_FIRST_HOLD_MS, () => {
          awaitingFirst = false;
          cancelFirstHold = null;
          pump();
        });
      }
      pump();
    },
    admit: (environmentId, signal) => {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (environmentId === preferred) return Promise.resolve(admitRoute(environmentId));
      return new Promise<AdmissionTicket>((resolve, reject) => {
        const waiter: Waiter = {
          environmentId,
          start: () => {
            signal?.removeEventListener("abort", abort);
            resolve(admitOther(environmentId));
          },
        };
        const abort = () => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", abort, { once: true });
        waiting.push(waiter);
        pump();
      });
    },
  };
}

/** The tab's one admission: the route's publisher and every connection attempt share it. */
export const connectionAdmission: ConnectionAdmission = makeConnectionAdmission();

/** What the connection driver asks before a socket; the tab's own admission unless provided. */
export class ConnectionAdmissionRef extends Context.Reference<ConnectionAdmission>(
  "@t3tools/client-runtime/connection/admission/ConnectionAdmission",
  { defaultValue: () => connectionAdmission },
) {}
