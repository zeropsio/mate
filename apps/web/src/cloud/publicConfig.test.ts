import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveCloudPublicConfig, resolveRelayTracingConfig } from "./publicConfig.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cloud public config", () => {
  it("reads a secure relay URL", () => {
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "");
    expect(resolveCloudPublicConfig().relayUrl).toBeNull();

    vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
    expect(resolveCloudPublicConfig().relayUrl).toBe("https://relay.example.test");
  });

  it("rejects an insecure relay URL", () => {
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "http://relay.example.test");

    expect(resolveCloudPublicConfig().relayUrl).toBeNull();
  });

  it("requires a complete secure relay tracing configuration", () => {
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://traces.example.test/v1/traces");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "relay-traces");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "");
    expect(resolveRelayTracingConfig()).toBeNull();

    vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "public-ingest-token");
    expect(resolveRelayTracingConfig()).toEqual({
      tracesUrl: "https://traces.example.test/v1/traces",
      tracesDataset: "relay-traces",
      tracesToken: "public-ingest-token",
    });
  });
});
