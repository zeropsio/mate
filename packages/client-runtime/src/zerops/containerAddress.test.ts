import { describe, expect, it } from "@effect/vitest";

import {
  buildZeropsContainerUrl,
  zeropsSubdomainDomainFromPublicZone,
} from "./containerAddress.ts";

describe("zeropsSubdomainDomainFromPublicZone", () => {
  it("reads the region out of a project's publicZone, not just prg1", () => {
    expect(zeropsSubdomainDomainFromPublicZone("fte2334ab.prg1-zerops.zone")).toBe(
      "prg1.zerops.app",
    );
    expect(zeropsSubdomainDomainFromPublicZone("abc123.fra1-zerops.zone")).toBe("fra1.zerops.app");
    expect(zeropsSubdomainDomainFromPublicZone("abc123.us-east-1-zerops.zone")).toBe(
      "us-east-1.zerops.app",
    );
  });

  it("a project on the alpha platform answers under alpha's zerops.dev subdomains", () => {
    expect(
      zeropsSubdomainDomainFromPublicZone("tlcr9fgopfen53of3bav758ac40.alpha.dev-zerops.cloud"),
    ).toBe("app-alpha.zerops.dev");
  });

  it("returns null for a zone that does not match the shape", () => {
    expect(zeropsSubdomainDomainFromPublicZone("example.com")).toBeNull();
    expect(zeropsSubdomainDomainFromPublicZone("")).toBeNull();
  });
});

describe("buildZeropsContainerUrl", () => {
  it("composes the container origin from service, subdomain host, port and region", () => {
    expect(buildZeropsContainerUrl("zcp", "24cb", 8080, "prg1.zerops.app")).toBe(
      "https://zcp-24cb-8080.prg1.zerops.app",
    );
  });
});
