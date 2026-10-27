import { describe, expect, it } from "vite-plus/test";

import {
  classifyHostedHttpsCompatibility,
  createAdvertisedEndpoint,
  deriveWsBaseUrl,
  environmentEndpointUrl,
  normalizeHttpBaseUrl,
} from "./endpoint.ts";

const coreProvider = {
  id: "desktop-core",
  label: "Desktop",
  kind: "core",
  isAddon: false,
} as const;

describe("advertised endpoint helpers", () => {
  it("normalizes HTTP and WebSocket base URLs", () => {
    expect(normalizeHttpBaseUrl("https://example.com?x=1#hash")).toBe("https://example.com/");
    expect(normalizeHttpBaseUrl("wss://example.com")).toBe("https://example.com/");
    expect(deriveWsBaseUrl("https://example.com")).toBe("wss://example.com/");
    expect(deriveWsBaseUrl("http://127.0.0.1:3773")).toBe("ws://127.0.0.1:3773/");
  });

  // An endpoint may be reverse-proxied under a path prefix (Zerops serves the
  // server at <origin>/mate/), so the path is part of the base URL, not noise.
  it("keeps the path prefix an endpoint is served under", () => {
    expect(normalizeHttpBaseUrl("https://example.com/mate?x=1#hash")).toBe(
      "https://example.com/mate/",
    );
    expect(normalizeHttpBaseUrl("wss://example.com/mate/")).toBe("https://example.com/mate/");
    expect(deriveWsBaseUrl("https://example.com/mate")).toBe("wss://example.com/mate/");
  });

  it("marks HTTP endpoints as blocked from hosted HTTPS apps", () => {
    expect(classifyHostedHttpsCompatibility("http://192.168.1.44:3773")).toBe(
      "mixed-content-blocked",
    );
    expect(classifyHostedHttpsCompatibility("https://desktop.example.com", "compatible")).toBe(
      "compatible",
    );
  });

  it("creates provider-neutral endpoint records", () => {
    expect(
      createAdvertisedEndpoint({
        id: "lan:http://192.168.1.44:3773",
        label: "LAN",
        provider: coreProvider,
        httpBaseUrl: "http://192.168.1.44:3773",
        reachability: "lan",
        source: "desktop-core",
        isDefault: true,
      }),
    ).toEqual({
      id: "lan:http://192.168.1.44:3773",
      label: "LAN",
      provider: coreProvider,
      httpBaseUrl: "http://192.168.1.44:3773/",
      wsBaseUrl: "ws://192.168.1.44:3773/",
      reachability: "lan",
      compatibility: {
        hostedHttpsApp: "mixed-content-blocked",
        desktopApp: "compatible",
      },
      source: "desktop-core",
      status: "available",
      isDefault: true,
    });
  });
});

describe("environmentEndpointUrl", () => {
  it("resolves a route against an endpoint served at the origin root", () => {
    expect(environmentEndpointUrl("https://example.com/", "/api/auth/session")).toBe(
      "https://example.com/api/auth/session",
    );
  });

  it("joins the route onto the prefix instead of replacing the path", () => {
    expect(environmentEndpointUrl("https://example.com/mate/", "/api/auth/session")).toBe(
      "https://example.com/mate/api/auth/session",
    );
    expect(environmentEndpointUrl("https://example.com/mate", "/.well-known/t3/environment")).toBe(
      "https://example.com/mate/.well-known/t3/environment",
    );
    expect(environmentEndpointUrl("https://example.com/mate/", "/oauth/token")).toBe(
      "https://example.com/mate/oauth/token",
    );
  });

  it("drops a query and fragment carried by the base URL", () => {
    expect(environmentEndpointUrl("https://example.com/mate/?a=1#frag", "/api/auth/session")).toBe(
      "https://example.com/mate/api/auth/session",
    );
  });
});
