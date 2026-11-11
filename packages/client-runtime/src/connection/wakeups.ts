import type { PlatformSignal } from "../zerops/knowledge/signals.ts";

import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

export type ConnectionWakeup =
  | "application-visible"
  | "application-active"
  | "application-active-probe"
  | "application-active-reconnect"
  | "credentials-changed";

/**
 * The connection wakeup a tab signal stands for, or `null` when it means
 * nothing to the connection layer. Every visible return releases a failed Mate's
 * retry wait. Probes and resubscriptions still follow the account's coalesced
 * wake (DESIGN §6.4), so a short tab switch leaves a healthy link alone.
 */
export function connectionWakeupForSignal(signal: PlatformSignal): ConnectionWakeup | null {
  switch (signal.type) {
    case "restored":
      // A back/forward cache restore comes back with a socket the browser
      // already killed: replace the lease instead of probing it.
      return "application-active-reconnect";
    case "wake":
      // The restore's own wake follows its `restored`, which already replaced the lease.
      return signal.visible && signal.cause !== "pageshow" ? "application-active" : null;
    case "visibility":
      return signal.hidden ? null : "application-visible";
    case "network":
      return null;
  }
}

export function isApplicationActiveWakeup(reason: ConnectionWakeup): boolean {
  return (
    reason === "application-active" ||
    reason === "application-active-probe" ||
    reason === "application-active-reconnect"
  );
}

// A long resume replaces the session, and the new session subscribes on its own.
export function shouldResubscribeAfterWakeup(reason: ConnectionWakeup): boolean {
  return reason === "application-active" || reason === "application-active-probe";
}

export class ConnectionWakeups extends Context.Service<
  ConnectionWakeups,
  {
    readonly changes: Stream.Stream<ConnectionWakeup>;
  }
>()("@t3tools/client-runtime/connection/wakeups/ConnectionWakeups") {}

const make = (service: ConnectionWakeups["Service"]) => ConnectionWakeups.of(service);

export const layer = (service: ConnectionWakeups["Service"]) =>
  Layer.succeed(ConnectionWakeups, make(service));
