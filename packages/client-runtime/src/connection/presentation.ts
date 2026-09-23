import type { ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import type { SupervisorConnectionState } from "./model.ts";

export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";

export interface EnvironmentConnectionPresentation {
  readonly phase: EnvironmentConnectionPhase;
  readonly error: string | null;
  readonly traceId: string | null;
}

export interface EnvironmentPresentation {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverConfig: ServerConfig | null;
}

export function presentConnectionState(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  switch (state.phase) {
    case "available":
      return { phase: "available", error: null, traceId: null };
    case "offline":
      return { phase: "offline", error: null, traceId: null };
    case "connecting":
      return {
        phase: state.attempt <= 1 && state.lastFailure === null ? "connecting" : "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
    case "connected":
      return { phase: "connected", error: null, traceId: null };
    case "backoff":
      return {
        phase: "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
    case "blocked":
      return {
        phase: "error",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
  }
}

export function connectionStatusText(connection: EnvironmentConnectionPresentation): string {
  switch (connection.phase) {
    case "available":
      return "Available";
    case "offline":
      return "Offline";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return connection.error
        ? `Failed to connect. Reconnecting... Reason: ${connection.error}`
        : "Reconnecting...";
    case "connected":
      return "Connected";
    case "error":
      return connection.error
        ? `Connection failed. Reason: ${connection.error}`
        : "Connection failed";
  }
}

export function connectionStatusTitle(connection: EnvironmentConnectionPresentation): string {
  if (connection.phase === "reconnecting" && connection.error) {
    return "Failed to connect. Reconnecting...";
  }
  return connectionStatusText({ ...connection, error: null });
}

export interface ConnectionBannerCopy {
  readonly title: string;
  readonly description: string | null;
  /** The banner's one verb; the component renders it exactly once. */
  readonly action: string;
}

/**
 * What a banner over a conversation says about its connection: the cause
 * class alone — the network, the Mate not answering, the Mate refusing —
 * named after the Mate. The failure's own detail names hosts, URLs and error
 * classes; it stays on the presentation for diagnostics and never reaches
 * this copy. Without a known Mate the copy names no one: the environment's
 * label is a host name. A connected environment has no banner.
 */
export function connectionBannerCopy(
  connection: EnvironmentConnectionPresentation,
  mateName: string | null,
): ConnectionBannerCopy | null {
  const subject = mateName ?? "It";
  const to = mateName === null ? "" : ` to ${mateName}`;
  switch (connection.phase) {
    case "connected":
      return null;
    case "available":
      return { title: `Not connected${to}`, description: null, action: "Connect" };
    case "offline":
      return {
        title: "You're offline",
        description: `${subject} reconnects when your network is back.`,
        action: "Try now",
      };
    case "connecting":
      return { title: `Connecting${to}…`, description: null, action: "Try now" };
    case "reconnecting":
      return {
        title: `Reconnecting${to}…`,
        description:
          connection.error === null ? null : `${subject} isn't answering. It may be restarting.`,
        action: "Try now",
      };
    case "error":
      return {
        title: `Couldn't connect${to}`,
        description: `${subject} refused the connection.`,
        action: "Try again",
      };
  }
}

export function presentEnvironmentConnection(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  return presentConnectionState(state);
}

export function connectionCatalogDisplayUrl(entry: ConnectionCatalogEntry): string | null {
  switch (entry.target._tag) {
    case "PrimaryConnectionTarget":
      return entry.target.httpBaseUrl;
    case "RelayConnectionTarget":
      return null;
    case "BearerConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "BearerConnectionProfile"
        ? entry.profile.value.httpBaseUrl
        : null;
    case "SshConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "SshConnectionProfile"
        ? `${entry.profile.value.target.username}@${entry.profile.value.target.hostname}`
        : null;
  }
}
