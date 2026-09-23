import { describe, expect, it } from "@effect/vitest";

import { buildZeropsContainerUrl, zeropsRegionFromPublicZone } from "./containerAddress.ts";

describe("zeropsRegionFromPublicZone", () => {
  it("reads the region out of a project's publicZone, not just prg1", () => {
    expect(zeropsRegionFromPublicZone("fte2334ab.prg1-zerops.zone")).toBe("prg1");
    expect(zeropsRegionFromPublicZone("abc123.fra1-zerops.zone")).toBe("fra1");
    expect(zeropsRegionFromPublicZone("abc123.us-east-1-zerops.zone")).toBe("us-east-1");
  });

  it("returns null for a zone that does not match the shape", () => {
    expect(zeropsRegionFromPublicZone("example.com")).toBeNull();
    expect(zeropsRegionFromPublicZone("")).toBeNull();
  });
});

describe("buildZeropsContainerUrl", () => {
  it("composes the container origin from service, subdomain host, port and region", () => {
    expect(buildZeropsContainerUrl("zcp", "24cb", 8080, "prg1")).toBe(
      "https://zcp-24cb-8080.prg1.zerops.app",
    );
  });
});
