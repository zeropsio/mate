import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import type { ZeropsProject } from "./api.ts";
import { compareZeropsHostnames, rankZeropsCandidateForListing } from "./listingOrder.ts";

describe("compareZeropsHostnames", () => {
  it("orders numeric suffixes numerically, not lexically", () => {
    const names = ["db10", "db2", "db"];
    expect([...names].sort(compareZeropsHostnames)).toEqual(["db", "db2", "db10"]);
  });

  it("is case-insensitive", () => {
    expect(compareZeropsHostnames("Api", "api")).toBe(0);
  });

  it("is locale-aware for accented names", () => {
    expect(compareZeropsHostnames("cafe", "café")).not.toBeGreaterThan(0);
  });
});

function project(id: string, status = "ACTIVE"): ZeropsProject {
  return { id, name: id, status, tagList: [] };
}

function candidate(group: ZeropsCandidate["group"], status = "ACTIVE"): ZeropsCandidate {
  return { key: "k", project: project("p", status), group };
}

describe("rankZeropsCandidateForListing", () => {
  it("ranks connected and ready in tier 0", () => {
    expect(rankZeropsCandidateForListing(candidate("connected"))).toBe(0);
    expect(rankZeropsCandidateForListing(candidate("ready"))).toBe(0);
  });

  it("ranks provisioning in tier 1", () => {
    expect(rankZeropsCandidateForListing(candidate("provisioning"))).toBe(1);
  });

  it("ranks unavailable-but-ACTIVE in tier 2", () => {
    expect(rankZeropsCandidateForListing(candidate("unavailable", "ACTIVE"))).toBe(2);
  });

  it("ranks non-ACTIVE projects in tier 3, even if unavailable", () => {
    expect(rankZeropsCandidateForListing(candidate("unavailable", "STOPPED"))).toBe(3);
  });
});
