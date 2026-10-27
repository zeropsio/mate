/**
 * The order a tab's sockets open in: the route's environment first, and never behind another.
 *
 * A browser opens one WebSocket at a time to an address (RFC 6455 §4.1 allows one connection in
 * CONNECTING per host), its TLS handshake included, and every Mate a Zerops region serves answers
 * at one address, the region's L7 balancer. The lock is the browser profile's, shared by every tab
 * of it. Measured 2026-09-30: 0.9–1.8 s per socket on a VPN whose path MTU stalls a post-quantum
 * ClientHello, and an upgrade to a Mate whose container is going down held by the L7 for up to
 * 5 s before its 502 — each such attempt holding the lock, and everything behind it, for as long.
 *
 * An attempt is admitted for the part that takes the lock only: from creating its socket to the
 * socket opening or failing (the driver asks for its ticket before, and synchronizes after).
 * Whether an attempt is the route's is judged now, not when it was asked for:
 * - The route's attempt starts at once, queued or not, and every other attempt still connecting
 *   is told to give way (its ticket's `signal` aborts): closing a socket still CONNECTING frees
 *   the lock. A previous route's attempt is one of those others from the moment the route moves.
 * - While a route is named and its socket is not open, others wait: from the naming until its
 *   first attempt ends (or {@link ROUTE_FIRST_HOLD_MS}, a route whose exchange never finishes),
 *   and during every later attempt of its own — a reconnect included.
 * - Others connect one at a time, each given {@link OTHER_ATTEMPT_MS} from its start before it
 *   gives way, a route named or not: without one, a page opening every Mate of an organization
 *   would otherwise stack them all in the browser's queue, where the wait counts against each.
 *
 * A ticket the caller never claims (its wait was interrupted as the attempt started) ends by
 * itself once the caller's signal aborts, or after {@link UNCLAIMED_TICKET_MS}, and its signal
 * aborts so that no late claim opens a socket without a turn.
 *
 * @module connection/admission
 */
import type { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";

/** How long the route, named but not yet attempting (its exchange running), holds the others. */
export const ROUTE_FIRST_HOLD_MS = 15_000;
/** How long another environment's attempt may hold the lock before it gives way. */
export const OTHER_ATTEMPT_MS = 8_000;
/** A ticket nobody claimed is let go after this. */
export const UNCLAIMED_TICKET_MS = 1_000;

export interface AdmissionTimers {
  /** Arms a timer; returns what disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

/** One admitted attempt. */
export interface AdmissionTicket {
  /** Aborts when the attempt must give way: the route needs the lock, or its time ran out. */
  readonly signal: AbortSignal;
  /** The caller holds the ticket and will settle it. */
  readonly claim: () => void;
  /** The socket opened (`true`) or the attempt ended without it. Later calls are ignored. */
  readonly settle: (open: boolean) => void;
  /** A socket that settled open has closed. */
  readonly close: () => void;
}

export interface ConnectionAdmission {
  /** The route's environment, whose socket opens before any other's; null when none. */
  readonly prefer: (environmentId: EnvironmentId | null) => void;
  /**
   * A page's own claim on the environment it shows when its path names none (a Mate coming up):
   * first after the route's, and released by what this returns without touching the route's.
   */
  readonly hold: (environmentId: EnvironmentId) => () => void;
  /** The environment whose socket goes first now: the route's, else the latest hold's. */
  readonly preferred: () => EnvironmentId | null;
  /**
   * The platform says this environment's server is down (its container restarting, stopped…):
   * none of its attempts starts, one connecting gives way, and it holds nobody else, until what
   * this returns is called — by every caller that said so. A socket to a server that is down is
   * held by the balancer until its 502, the browser's lock with it.
   */
  readonly down: (environmentId: EnvironmentId) => () => void;
  /**
   * Resolves once this environment may create its socket. Rejects with the signal's reason when
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

interface Attempt {
  readonly environmentId: EnvironmentId;
  readonly controller: AbortController;
  /** Disarms its give-way timer; a route's attempt has none. */
  cancelTimer: (() => void) | null;
  /** Its time ran out: it gives way as soon as anyone else waits. */
  expired: boolean;
  settled: boolean;
}

export function makeConnectionAdmission(
  timers: AdmissionTimers = systemTimers,
): ConnectionAdmission {
  let preferred: EnvironmentId | null = null;
  /** The route's naming (`prefer`) and the pages' holds, latest last: `preferred` is their sum. */
  let named: EnvironmentId | null = null;
  const holds: Array<{ readonly environmentId: EnvironmentId }> = [];
  let awaitingFirst = false;
  let cancelFirstHold: (() => void) | null = null;
  /** Open sockets per environment: a replacement opens beside the connection it replaces. */
  const open = new Map<EnvironmentId, number>();
  /** Attempts holding the lock: admitted, their socket neither open nor failed yet. */
  const connecting = new Set<Attempt>();
  const waiting: Array<Waiter> = [];
  /** Environments the platform says are down, with how many callers say so. */
  const downs = new Map<EnvironmentId, number>();

  const isDown = (environmentId: EnvironmentId) => downs.has(environmentId);
  /** Waiters that may start once it is their turn. */
  const eligible = () => waiting.filter(({ environmentId }) => !isDown(environmentId));
  const isOpen = (environmentId: EnvironmentId) => (open.get(environmentId) ?? 0) > 0;
  const isRoute = (attempt: Attempt) => attempt.environmentId === preferred;
  const routeConnecting = () => [...connecting].some(isRoute);
  const othersConnecting = () => [...connecting].filter((attempt) => !isRoute(attempt));
  const holding = () =>
    preferred !== null &&
    !isDown(preferred) &&
    !isOpen(preferred) &&
    (awaitingFirst || routeConnecting());

  const endFirstHold = () => {
    awaitingFirst = false;
    cancelFirstHold?.();
    cancelFirstHold = null;
  };

  const giveWay = (attempt: Attempt, reason: string) => {
    attempt.cancelTimer?.();
    attempt.cancelTimer = null;
    connecting.delete(attempt);
    attempt.controller.abort(new Error(reason));
  };

  /** Someone else wants the lock: a route not yet open, or an attempt waiting its turn. */
  const contended = () =>
    eligible().length > 0 || (preferred !== null && !isDown(preferred) && !isOpen(preferred));

  /** Makes every attempt past its time give way, when someone else wants the lock. */
  const expireOthers = () => {
    if (!contended()) return;
    for (const attempt of connecting) {
      if (attempt.expired && !isRoute(attempt)) giveWay(attempt, "The attempt ran out of time.");
    }
  };

  /**
   * An attempt that is not the route's: given its time, then made to give way — only while
   * someone else wants the lock. A lone attempt keeps its supervisor's own limit.
   */
  const armOther = (attempt: Attempt) => {
    if (attempt.cancelTimer !== null || attempt.expired) return;
    attempt.cancelTimer = timers.setTimer(OTHER_ATTEMPT_MS, () => {
      attempt.cancelTimer = null;
      if (!connecting.has(attempt)) return;
      attempt.expired = true;
      expireOthers();
      pump();
    });
  };

  /** Re-judges every attempt against the route now named. */
  const rejudge = () => {
    // A replacement of the route's open socket makes nobody give way: the route is not waiting.
    const routeGoing = routeConnecting() && preferred !== null && !isOpen(preferred);
    for (const attempt of connecting) {
      if (isRoute(attempt)) {
        attempt.cancelTimer?.();
        attempt.cancelTimer = null;
      } else if (routeGoing) {
        giveWay(attempt, "The route's socket goes first.");
      } else {
        armOther(attempt);
      }
    }
  };

  /** Starts what may start: the route at once; others only when the route holds nothing. */
  function pump(): void {
    expireOthers();
    for (const waiter of eligible().filter(({ environmentId }) => environmentId === preferred)) {
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.start();
    }
    if (holding()) return;
    for (;;) {
      const next = eligible()[0];
      if (next === undefined || othersConnecting().length > 0) return;
      waiting.splice(waiting.indexOf(next), 1);
      next.start();
    }
  }

  const ticketFor = (attempt: Attempt, callerSignal: AbortSignal | undefined): AdmissionTicket => {
    let opened = false;
    let closed = false;
    let claimed = false;
    const settle = (isOpenNow: boolean) => {
      if (attempt.settled) return;
      attempt.settled = true;
      attempt.cancelTimer?.();
      attempt.cancelTimer = null;
      // Only the route's own attempt still holding the lock ends its hold: one already told to
      // give way that ends later — its Mate the route again by now — says nothing of the new one.
      if (connecting.delete(attempt) && isRoute(attempt)) endFirstHold();
      if (isOpenNow) {
        opened = true;
        open.set(attempt.environmentId, (open.get(attempt.environmentId) ?? 0) + 1);
      }
      pump();
    };
    // Until claimed, a caller that went away ends the attempt.
    const abandoned = () => {
      if (claimed) return;
      settle(false);
      // Let go, it can no longer be claimed into a socket that holds no turn.
      attempt.controller.abort(new Error("The ticket was never claimed."));
    };
    callerSignal?.addEventListener("abort", abandoned, { once: true });
    const cancelUnclaimed = timers.setTimer(UNCLAIMED_TICKET_MS, abandoned);
    return {
      signal: attempt.controller.signal,
      claim: () => {
        claimed = true;
        cancelUnclaimed();
        callerSignal?.removeEventListener("abort", abandoned);
      },
      settle,
      close: () => {
        if (!opened || closed) return;
        closed = true;
        const count = (open.get(attempt.environmentId) ?? 0) - 1;
        if (count > 0) open.set(attempt.environmentId, count);
        else open.delete(attempt.environmentId);
        pump();
      },
    };
  };

  const start = (environmentId: EnvironmentId, callerSignal: AbortSignal | undefined) => {
    const attempt: Attempt = {
      environmentId,
      controller: new AbortController(),
      cancelTimer: null,
      expired: false,
      settled: false,
    };
    connecting.add(attempt);
    if (environmentId === preferred) rejudge();
    else armOther(attempt);
    return ticketFor(attempt, callerSignal);
  };

  const setPreferred = (environmentId: EnvironmentId | null) => {
    if (environmentId === preferred) return;
    preferred = environmentId;
    endFirstHold();
    if (environmentId !== null && !isOpen(environmentId) && !routeConnecting()) {
      awaitingFirst = true;
      cancelFirstHold = timers.setTimer(ROUTE_FIRST_HOLD_MS, () => {
        awaitingFirst = false;
        cancelFirstHold = null;
        pump();
      });
    }
    rejudge();
    pump();
  };
  const settleClaims = () => setPreferred(named ?? holds.at(-1)?.environmentId ?? null);

  return {
    prefer: (environmentId) => {
      named = environmentId;
      settleClaims();
    },
    hold: (environmentId) => {
      const claim = { environmentId };
      holds.push(claim);
      settleClaims();
      return () => {
        const index = holds.indexOf(claim);
        if (index < 0) return;
        holds.splice(index, 1);
        settleClaims();
      };
    },
    preferred: () => preferred,
    down: (environmentId) => {
      downs.set(environmentId, (downs.get(environmentId) ?? 0) + 1);
      for (const attempt of connecting) {
        if (attempt.environmentId === environmentId) giveWay(attempt, "Its server is down.");
      }
      pump();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = (downs.get(environmentId) ?? 0) - 1;
        if (count > 0) downs.set(environmentId, count);
        else downs.delete(environmentId);
        pump();
      };
    },
    admit: (environmentId, signal) => {
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise<AdmissionTicket>((resolve, reject) => {
        const waiter: Waiter = {
          environmentId,
          start: () => {
            signal?.removeEventListener("abort", abort);
            resolve(start(environmentId, signal));
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

/** For a client with no browser connection lock (mobile): nobody ever waits or gives way. */
export const passThroughAdmission: ConnectionAdmission = {
  prefer: () => undefined,
  hold: () => () => undefined,
  preferred: () => null,
  down: () => () => undefined,
  admit: (_environmentId, signal) =>
    signal?.aborted
      ? Promise.reject(signal.reason)
      : Promise.resolve({
          signal: new AbortController().signal,
          claim: () => undefined,
          settle: () => undefined,
          close: () => undefined,
        }),
};

/**
 * What the connection driver asks before a socket. A pass-through unless a client provides the
 * browser's admission (the web provides {@link connectionAdmission}).
 */
export class ConnectionAdmissionRef extends Context.Reference<ConnectionAdmission>(
  "@t3tools/client-runtime/connection/admission/ConnectionAdmission",
  { defaultValue: () => passThroughAdmission },
) {}
