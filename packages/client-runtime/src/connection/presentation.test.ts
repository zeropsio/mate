import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { BearerConnectionProfile, type ConnectionCatalogEntry } from "./catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  type SupervisorConnectionState,
} from "./model.ts";
import {
  connectionBannerCopy,
  connectionCatalogDisplayUrl,
  connectionStatusText,
  connectionStatusTitle,
  presentEnvironmentConnection,
  presentConnectionState,
} from "./presentation.ts";

const TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  connectionId: "connection-1",
});

const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: TARGET.connectionId,
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "https://environment.example.test",
      wsBaseUrl: "wss://environment.example.test",
    }),
  ),
};

function supervisorState(overrides: Partial<SupervisorConnectionState>): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase: "connecting",
    stage: "preparing",
    attempt: 1,
    generation: 0,
    lastFailure: null,
    retryAt: null,
    ...overrides,
  };
}

describe("connection presentation", () => {
  it("preserves profile display information without exposing credentials", () => {
    expect(connectionCatalogDisplayUrl(ENTRY)).toBe("https://environment.example.test");
  });

  it("distinguishes initial connection, reconnect, and retry errors", () => {
    expect(presentConnectionState(supervisorState({ phase: "connecting", attempt: 1 }))).toEqual({
      phase: "connecting",
      error: null,
      traceId: null,
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "connecting",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Socket closed.",
            traceId: "trace-previous",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Socket closed.",
      traceId: "trace-previous",
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "backoff",
          attempt: 2,
          retryAt: 1,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
            traceId: "trace-1",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Disconnected.",
      traceId: "trace-1",
    });
  });

  it("preserves the latest failure while the next attempt is active", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connecting",
          stage: "opening",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Relay connection timed out.",
            traceId: "trace-retry",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Relay connection timed out.",
      traceId: "trace-retry",
    });
  });

  it("combines reconnect progress with the latest failure", () => {
    const connection = {
      phase: "reconnecting",
      error: "Relay request timed out.",
      traceId: "trace-retry",
    } as const;
    expect(connectionStatusText(connection)).toBe(
      "Failed to connect. Reconnecting... Reason: Relay request timed out.",
    );
    expect(connectionStatusTitle(connection)).toBe("Failed to connect. Reconnecting...");
  });

  it("presents the supervisor's offline state without consulting shell state", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          network: "offline",
          phase: "offline",
          stage: null,
        }),
      ),
    ).toEqual({
      phase: "offline",
      error: null,
      traceId: null,
    });
  });

  it("presents a connected supervisor snapshot as connected", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connected",
          stage: null,
          generation: 1,
        }),
      ),
    ).toEqual({
      phase: "connected",
      error: null,
      traceId: null,
    });
  });

  describe("banner copy names the cause, never the transport", () => {
    // What a zcp restart put on screen: the environment's host label, a URL
    // and a raw transport error class (gate CD, zcp-restart/03-during-2.png).
    const RAW_DETAIL =
      "Failed to fetch remote environment endpoint https://zcp-30db-8080.prg1.zerops.app/mate/.well-known/t3/environment (HttpClientError: Transport error (GET https://zcp-30db-8080.prg1.zerops.app/mate/.well-known/t3/environment)).";
    const LEAKS = [
      /https?:\/\//,
      /\b[a-z0-9-]+(\.[a-z0-9-]+){2,}\b/i,
      /\b[A-Z][A-Za-z]*Error\b/,
      /node-id-1/,
      /Reason:/,
    ];
    const transient = (reason: ConnectionTransientError["reason"]) =>
      new ConnectionTransientError({ reason, detail: RAW_DETAIL, traceId: "trace-1" });
    const blocked = (reason: ConnectionBlockedError["reason"]) =>
      new ConnectionBlockedError({ reason, detail: RAW_DETAIL, traceId: "trace-1" });

    const cases: ReadonlyArray<{
      readonly name: string;
      readonly state: SupervisorConnectionState;
      readonly title: string;
      readonly description: string | null;
      readonly action: string;
    }> = [
      ...(
        [
          "network",
          "timeout",
          "transport",
          "endpoint-unavailable",
          "relay-unavailable",
          "remote-unavailable",
        ] as const
      ).flatMap((reason) => [
        {
          name: `backoff after ${reason}`,
          state: supervisorState({
            phase: "backoff",
            attempt: 2,
            retryAt: 1,
            lastFailure: transient(reason),
          }),
          title: "Reconnecting to Wren…",
          description: "Wren isn't answering. It may be restarting.",
          action: "Try now",
        },
        {
          name: `next attempt after ${reason}`,
          state: supervisorState({
            phase: "connecting",
            attempt: 2,
            lastFailure: transient(reason),
          }),
          title: "Reconnecting to Wren…",
          description: "Wren isn't answering. It may be restarting.",
          action: "Try now",
        },
      ]),
      ...(
        ["authentication", "configuration", "permission", "read-only", "unsupported"] as const
      ).map((reason) => ({
        name: `blocked by ${reason}`,
        state: supervisorState({ phase: "blocked", lastFailure: blocked(reason) }),
        title: "Couldn't connect to Wren",
        description: "Wren refused the connection.",
        action: "Try again",
      })),
      {
        name: "offline",
        state: supervisorState({ network: "offline", phase: "offline", stage: null }),
        title: "You're offline",
        description: "Wren reconnects when your network is back.",
        action: "Try now",
      },
      {
        name: "first attempt",
        state: supervisorState({ phase: "connecting", attempt: 1 }),
        title: "Connecting to Wren…",
        description: null,
        action: "Try now",
      },
      {
        name: "not asked to connect",
        state: supervisorState({ desired: false, phase: "available", stage: null, attempt: 0 }),
        title: "Not connected to Wren",
        description: null,
        action: "Connect",
      },
    ];

    it.each(cases)("$name", ({ state, title, description, action }) => {
      const copy = connectionBannerCopy(presentConnectionState(state), "Wren");
      expect(copy).toEqual({ title, description, action });
      const rendered = [copy?.title, copy?.description, copy?.action].join("\n");
      for (const leak of LEAKS) {
        expect(rendered).not.toMatch(leak);
      }
    });

    it("has no banner for a connected Mate", () => {
      expect(
        connectionBannerCopy(
          presentConnectionState(supervisorState({ phase: "connected", stage: null })),
          "Wren",
        ),
      ).toBeNull();
    });

    it("keeps the raw failure for diagnostics", () => {
      expect(
        presentConnectionState(
          supervisorState({ phase: "backoff", attempt: 2, lastFailure: transient("network") }),
        ),
      ).toMatchObject({ error: RAW_DETAIL, traceId: "trace-1" });
    });

    it("names no one when the Mate is not known", () => {
      expect(
        connectionBannerCopy(
          presentConnectionState(
            supervisorState({ phase: "backoff", attempt: 2, lastFailure: transient("network") }),
          ),
          null,
        ),
      ).toEqual({
        title: "Reconnecting…",
        description: "It isn't answering. It may be restarting.",
        action: "Try now",
      });
      expect(
        connectionBannerCopy(
          presentConnectionState(
            supervisorState({ phase: "blocked", lastFailure: blocked("authentication") }),
          ),
          null,
        ),
      ).toEqual({
        title: "Couldn't connect",
        description: "It refused the connection.",
        action: "Try again",
      });
    });
  });

  it("preserves an explicitly available environment while offline", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          desired: false,
          network: "offline",
          phase: "available",
          stage: null,
          attempt: 0,
        }),
      ),
    ).toEqual({
      phase: "available",
      error: null,
      traceId: null,
    });
  });
});
