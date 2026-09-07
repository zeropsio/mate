import { describe, expect, it } from "vite-plus/test";

import { shouldForgetZeropsEnvironment } from "./deadEnvironment";

const ACCOUNT = new Set(["org-a", "org-b"]);
const ACTIVE_PROJECTS = new Set(["p1"]);

describe("shouldForgetZeropsEnvironment", () => {
  it.each([
    {
      label: "a project that is still there",
      ref: { orgId: "org-a", projectId: "p1" },
      expected: false,
    },
    {
      label: "a project the active organization no longer has",
      ref: { orgId: "org-a", projectId: "gone" },
      expected: true,
    },
    {
      label: "another organization of this same account, whose projects were never read",
      ref: { orgId: "org-b", projectId: "gone" },
      expected: false,
    },
    {
      label: "an organization this account does not belong to — a previous account's container",
      ref: { orgId: "someone-elses-org", projectId: "p1" },
      expected: true,
    },
    { label: "an environment whose project was never learned", ref: undefined, expected: false },
  ])("$label → $expected", ({ ref, expected }) => {
    expect(
      shouldForgetZeropsEnvironment({
        ...(ref === undefined ? { ref: undefined } : { ref }),
        activeOrgId: "org-a",
        accountOrgIds: ACCOUNT,
        knownProjectIds: ACTIVE_PROJECTS,
      }),
    ).toBe(expected);
  });

  it("forgets a foreign account's container even when its project id collides with one of ours", () => {
    // The ids are opaque and per-account; matching one proves nothing about
    // reachability, and the old rule reached this case through `orgId ===
    // activeOrgId` and left it registered forever.
    expect(
      shouldForgetZeropsEnvironment({
        ref: { orgId: "someone-elses-org", projectId: "p1" },
        activeOrgId: "org-a",
        accountOrgIds: ACCOUNT,
        knownProjectIds: ACTIVE_PROJECTS,
      }),
    ).toBe(true);
  });

  it("keeps everything while the account has no organizations to judge against", () => {
    // An empty account set is "not read yet", not "member of nothing": reaping
    // on it would forget every environment the moment a read stalls.
    expect(
      shouldForgetZeropsEnvironment({
        ref: { orgId: "org-a", projectId: "gone" },
        activeOrgId: "org-a",
        accountOrgIds: new Set(),
        knownProjectIds: ACTIVE_PROJECTS,
      }),
    ).toBe(false);
  });
});
