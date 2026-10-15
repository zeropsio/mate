import { describe, expect, it } from "vite-plus/test";

import { hqCreditUrl } from "./hqCredit";

describe("where credit is added", () => {
  it("is the organization's page in HQ, which adds credit to it", () => {
    expect(hqCreditUrl("org-acme")).toBe("https://hq.zerops.io/organizations/org-acme");
  });

  it("is on the HQ the build signs in at, where it names its own", () => {
    expect(hqCreditUrl("org-acme", "http://localhost:4300")).toBe(
      "http://localhost:4300/organizations/org-acme",
    );
  });
});
