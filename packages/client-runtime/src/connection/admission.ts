/**
 * The order a tab's sockets open in: the route's environment first.
 *
 * A browser opens one WebSocket at a time to an address (RFC 6455 §4.1 allows one connection in
 * CONNECTING per host), its TLS handshake included, and every Mate a Zerops region serves answers
 * at one address, the region's L7 balancer. The sockets a reload asks for therefore open one after
 * another in the order they were asked for, each on a fresh TLS connection: a WebSocket never
 * shares the HTTP/2 connection the tab's requests ride on. Measured 2026-09-30 on ten Mates: each
 * socket 0.9–1.8 s behind the one before it, the route's fourth or fifth, its conversation shown
 * at 7–15 s.
 *
 * The admission keeps the head of that queue for the route's environment. While the route's
 * socket is not open, any other environment's connection waits before it asks for its ticket —
 * until the route's attempt ends (opened or failed), the route changes, or {@link ROUTE_HOLD_MS}
 * passes, so a route whose Mate never answers holds nobody for longer than that.
 *
 * @module connection/admission
 */
import type { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";

/** How long the route's environment holds the others' sockets at most. */
export const ROUTE_HOLD_MS = 5_000;

export interface AdmissionTimers {
  /** Arms a timer; returns what disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

export interface ConnectionAdmission {
  /** The route's environment, whose socket opens before any other's; null when none. */
  readonly prefer: (environmentId: EnvironmentId | null) => void;
  /**
   * Resolves once this environment may open its socket. Rejects with the signal's reason when the
   * attempt ends first.
   */
  readonly admit: (environmentId: EnvironmentId, signal?: AbortSignal) => Promise<void>;
  /** An admitted attempt ended: `open` when its socket is up, and the route's releases the rest. */
  readonly settle: (environmentId: EnvironmentId, open: boolean) => void;
  /** A socket that settled open has closed. */
  readonly close: (environmentId: EnvironmentId) => void;
}

const systemTimers: AdmissionTimers = {
  setTimer: (delayMs, fire) => {
    // @effect-diagnostics-next-line globalTimers:off -- the admission's one timer port; plain promises, no Effect runtime.
    const handle = setTimeout(fire, delayMs);
    return () => clearTimeout(handle);
  },
};

export function makeConnectionAdmission(
  timers: AdmissionTimers = systemTimers,
): ConnectionAdmission {
  let preferred: EnvironmentId | null = null;
  let holding = false;
  let cancelHold: (() => void) | null = null;
  /** Open sockets per environment: a replacement opens beside the connection it replaces. */
  const open = new Map<EnvironmentId, number>();
  const waiting = new Set<() => void>();

  const release = () => {
    holding = false;
    cancelHold?.();
    cancelHold = null;
    const woken = [...waiting];
    waiting.clear();
    for (const wake of woken) wake();
  };

  return {
    prefer: (environmentId) => {
      if (environmentId === preferred) return;
      preferred = environmentId;
      if (environmentId === null || (open.get(environmentId) ?? 0) > 0) {
        release();
        return;
      }
      holding = true;
      cancelHold?.();
      cancelHold = timers.setTimer(ROUTE_HOLD_MS, release);
    },
    admit: (environmentId, signal) => {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (!holding || environmentId === preferred) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const abort = () => {
          waiting.delete(wake);
          reject(signal?.reason);
        };
        const wake = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        waiting.add(wake);
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
    settle: (environmentId, isOpen) => {
      if (isOpen) open.set(environmentId, (open.get(environmentId) ?? 0) + 1);
      if (environmentId === preferred && holding) release();
    },
    close: (environmentId) => {
      const count = (open.get(environmentId) ?? 0) - 1;
      if (count > 0) open.set(environmentId, count);
      else open.delete(environmentId);
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
