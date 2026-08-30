import type { ZeropsProject } from "./api.ts";
import { describe, expect, it } from "vite-plus/test";

import {
  newestProvisioningCandidate,
  shouldAutoEnterProvisioning,
} from "./autoEnterProvisioning.ts";
import type { ZeropsCandidate } from "./candidates.ts";

function project(overrides: Partial<ZeropsProject> & { readonly id: string }): ZeropsProject {
  return { name: "p", status: "CREATING", ...overrides };
}

function candidate(
  overrides: Partial<ZeropsCandidate> & { readonly project: ZeropsProject },
): ZeropsCandidate {
  return { key: overrides.project.id, group: "provisioning", ...overrides };
}

describe("shouldAutoEnterProvisioning", () => {
  it("is true when nothing is connected or ready, but something is on its way in", () => {
    const candidates: ZeropsCandidate[] = [
      candidate({ project: project({ id: "p1" }), group: "provisioning" }),
    ];

    expect(shouldAutoEnterProvisioning(candidates)).toBe(true);
  });

  it("is false once anything is connected", () => {
    const candidates: ZeropsCandidate[] = [
      candidate({ project: project({ id: "p1" }), group: "connected" }),
      candidate({ project: project({ id: "p2" }), group: "provisioning" }),
    ];

    expect(shouldAutoEnterProvisioning(candidates)).toBe(false);
  });

  it("is false once anything is ready to connect", () => {
    const candidates: ZeropsCandidate[] = [
      candidate({ project: project({ id: "p1" }), group: "ready" }),
      candidate({ project: project({ id: "p2" }), group: "provisioning" }),
    ];

    expect(shouldAutoEnterProvisioning(candidates)).toBe(false);
  });

  it("is false when there is nothing provisioning, however unavailable everything else is", () => {
    const candidates: ZeropsCandidate[] = [
      candidate({ project: project({ id: "p1" }), group: "unavailable" }),
    ];

    expect(shouldAutoEnterProvisioning(candidates)).toBe(false);
  });

  it("is false for an empty candidate list", () => {
    expect(shouldAutoEnterProvisioning([])).toBe(false);
  });
});

describe("newestProvisioningCandidate", () => {
  it("follows the newest project, which is the one a claim just handed over", () => {
    const older = candidate({
      project: project({ id: "old", created: "2020-01-01T00:00:00Z" }),
    });
    const newer = candidate({
      project: project({ id: "new", created: "2026-08-28T00:00:00Z" }),
    });

    expect(newestProvisioningCandidate([older, newer])?.project.id).toBe("new");
  });

  it("is undefined when nothing is provisioning", () => {
    const ready = candidate({ project: project({ id: "p1" }), group: "ready" });

    expect(newestProvisioningCandidate([ready])).toBeUndefined();
  });
});
